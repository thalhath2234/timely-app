package agent

import (
	"bytes"
	"encoding/binary"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// Auto's allowlist for terminal commands (owner decision 2026-11-15, plan
// 5.5b). Six review rounds kept finding commands that the critical list, a
// blocklist that parses shell, missed. So in Auto a terminal command, and
// text typed into a running command, runs without a card only when every
// simple command on the line is on the short list below and passes its
// argument rules. Anything the parser does not fully understand gets a card:
// unknown means card. The critical list still decides which cards can never
// be granted; this list only decides what Auto may skip the card for.

// AutoAsksReason is the card reason for a command Auto does not run on its own.
const AutoAsksReason = "Auto runs only simple read-only commands without asking"

// AutoSafeCommand reports whether Auto may run a command line without a card:
// every simple command is on the read-only list, passes its argument rules,
// and every path it reads (following existing symlinks) is inside the working
// folder and is not a secret or settings file. why says, in plain words, what
// made a line ask (empty when ok). scope.Cwd is the folder the line starts in;
// scope.CwdUnknown makes every relative or implicit path ask (text typed into
// a running command, whose folder Timely can't see).
func AutoSafeCommand(line string, scope HostScope) (ok bool, why string) {
	cmds, why := lexLine(line)
	if why != "" {
		return false, why
	}
	if len(cmds) == 0 {
		return false, "it is empty"
	}
	// A cd moves the rest of its and-or list only when everything before it
	// in the list ran (&& only) and what follows runs only if it worked (&&).
	// After the list ends, or after a || behind it, the folder is either the
	// old one or the new one, so a relative path asks from then on.
	listOr, cdInList := false, false
	for i, c := range cmds {
		prev := ";"
		if i > 0 {
			prev = cmds[i-1].op
		}
		switch prev {
		case ";":
			if cdInList {
				scope.Cwd, scope.CwdUnknown = "", true
			}
			listOr, cdInList = false, false
		case "||", "|":
			if cdInList && prev == "||" {
				scope.Cwd, scope.CwdUnknown = "", true
			}
			listOr = true
		}
		words, why := expandWords(c.words, scope)
		if why != "" {
			return false, why
		}
		if len(words) == 0 {
			return false, "it is empty"
		}
		if words[0] == "cd" {
			if listOr || (c.op != "&&" && c.op != "") {
				return false, "it changes folder in a way Timely can't follow"
			}
			// bash looks a bare name up through CDPATH before the current
			// folder, and Timely can't see that variable, so only ./x, ../x
			// and absolute targets (and ~, expanded above) are known.
			if len(words) == 2 && !cdPathFree(words[1]) {
				return false, "cd to a bare name may go through CDPATH (write ./" + words[1] + ")"
			}
			next, why := autoCd(words[1:], scope)
			if why != "" {
				return false, why
			}
			scope, cdInList = next, true
			continue
		}
		if why := autoSimple(words, scope); why != "" {
			return false, why
		}
	}
	return true, ""
}

// shCmd is one simple command and the operator after it (";", "&&", "||",
// "|", or "" at the end of the line).
type shCmd struct {
	words []shWord
	op    string
}

// shWord is one word as the shell will pass it, with the expansions the
// shell would still do: a ~ at its start and unquoted * or ? globs.
type shWord struct {
	text  string
	tilde bool // starts with an unquoted ~ (followed by / or nothing)
	glob  bool // has an unquoted * or ?
	// lit is set when a * or ? came quoted or escaped: mixed with an
	// unquoted one, Go's glob could not match what bash matches.
	lit bool
}

// lexLine splits a command line the way bash does, for the small grammar
// Auto accepts: words, single and double quotes, backslash escapes, and the
// separators ; && || | and new lines. Anything else (redirections, $,
// backticks, subshells, braces, background jobs, comments, history
// expansion) makes why non-empty: the parser fails closed.
func lexLine(line string) (cmds []shCmd, why string) {
	var (
		words []shWord
		cur   strings.Builder
		w     shWord
		inW   bool
	)
	endWord := func() {
		if inW {
			w.text = cur.String()
			words = append(words, w)
		}
		cur.Reset()
		w, inW = shWord{}, false
	}
	endCmd := func(op string) bool {
		endWord()
		if len(words) == 0 {
			return false
		}
		cmds = append(cmds, shCmd{words: words, op: op})
		words = nil
		return true
	}
	r := []rune(line)
	for i := 0; i < len(r); i++ {
		ch := r[i]
		atStart := !inW
		switch {
		case ch == ' ' || ch == '\t':
			endWord()
		case ch == '\n' || ch == ';':
			endWord()
			if len(words) == 0 {
				// blank lines and a trailing new line are fine; ;; and a
				// leading ; are not
				if ch == ';' {
					return nil, "it has a shell construct Timely can't read"
				}
				continue
			}
			endCmd(";")
		case ch == '&':
			if i+1 < len(r) && r[i+1] == '&' {
				if !endCmd("&&") {
					return nil, "it has a shell construct Timely can't read"
				}
				i++
				continue
			}
			return nil, "it runs something in the background or redirects output"
		case ch == '|':
			op := "|"
			if i+1 < len(r) && r[i+1] == '|' {
				op = "||"
				i++
			} else if i+1 < len(r) && r[i+1] == '&' {
				return nil, "it redirects output"
			}
			if !endCmd(op) {
				return nil, "it has a shell construct Timely can't read"
			}
		case ch == '>' || ch == '<':
			return nil, "it reads or writes a file through a redirection"
		case ch == '(' || ch == ')':
			return nil, "it uses a subshell or a function"
		case ch == '`' || ch == '$':
			return nil, "it uses a variable or runs a command inside the line"
		case ch == '{' || ch == '}':
			return nil, "it uses braces, which the shell expands"
		case ch == '[':
			return nil, "it uses a [ ] pattern"
		case ch == '#' && atStart:
			return nil, "it has a comment"
		case ch == '^' && atStart && len(words) == 0:
			return nil, "it has a shell construct Timely can't read"
		case ch == '!':
			// history expansion in an interactive shell; a lone ! word (find
			// . ! -name x) is a plain argument
			if !atStart || (i+1 < len(r) && r[i+1] != ' ' && r[i+1] != '\t' && r[i+1] != '\n') {
				return nil, "it uses ! history expansion"
			}
			inW = true
			cur.WriteRune(ch)
		case ch == '~':
			if atStart {
				if i+1 < len(r) && !strings.ContainsRune(" \t\n;|&/", r[i+1]) {
					return nil, "it names another user's home"
				}
				w.tilde = true
			} else if s := cur.String(); strings.HasSuffix(s, "=") || strings.HasSuffix(s, ":") {
				// bash expands ~ after = in a word that looks like an
				// assignment (a=~/x)
				return nil, "it uses ~ where the shell may expand it"
			}
			inW = true
			cur.WriteRune(ch)
		case ch == '*' || ch == '?':
			if ch == '*' && i+1 < len(r) && r[i+1] == '*' {
				return nil, "it uses a ** pattern"
			}
			inW, w.glob = true, true
			cur.WriteRune(ch)
		case ch == '\\':
			if i+1 >= len(r) || r[i+1] == '\n' || r[i+1] == '\r' {
				return nil, "it continues a line with \\"
			}
			i++
			inW = true
			w.lit = w.lit || r[i] == '*' || r[i] == '?'
			cur.WriteRune(r[i])
		case ch == '\'':
			j := i + 1
			for j < len(r) && r[j] != '\'' {
				j++
			}
			if j >= len(r) {
				return nil, "it has a quote that is not closed"
			}
			inW = true
			cur.WriteString(string(r[i+1 : j]))
			w.lit = w.lit || strings.ContainsAny(string(r[i+1:j]), "*?")
			i = j
		case ch == '"':
			inW = true
			j := i + 1
			for ; j < len(r) && r[j] != '"'; j++ {
				switch r[j] {
				case '$', '`':
					return nil, "it uses a variable or runs a command inside the line"
				case '!':
					return nil, "it uses ! history expansion"
				case '\\':
					if j+1 < len(r) && strings.ContainsRune("$`\"\\", r[j+1]) {
						j++
					} else if j+1 < len(r) && (r[j+1] == '\n' || r[j+1] == '\r') {
						return nil, "it continues a line with \\"
					}
				}
				if r[j] < 0x20 && r[j] != '\t' && r[j] != '\n' {
					return nil, "it has control characters"
				}
				w.lit = w.lit || r[j] == '*' || r[j] == '?'
				cur.WriteRune(r[j])
			}
			if j >= len(r) {
				return nil, "it has a quote that is not closed"
			}
			i = j
		case ch < 0x20 || ch == 0x7f:
			return nil, "it has control characters"
		default:
			inW = true
			cur.WriteRune(ch)
		}
	}
	endWord()
	if len(words) > 0 {
		cmds = append(cmds, shCmd{words: words})
	} else if len(cmds) > 0 && cmds[len(cmds)-1].op != ";" {
		return nil, "it ends with an operator"
	}
	if len(cmds) > 0 && cmds[len(cmds)-1].op == ";" {
		cmds[len(cmds)-1].op = ""
	}
	return cmds, ""
}

// maxGlob is how many files one pattern may match before Auto asks.
const maxGlob = 500

// expandWords does the shell's ~ and glob expansion on a command's words. A
// glob is expanded from the folder the command runs in; a match that starts
// with - would be read as an option (a file named --pre=x), so it asks.
func expandWords(in []shWord, scope HostScope) ([]string, string) {
	var out []string
	for _, w := range in {
		text := w.text
		if w.tilde {
			if scope.Home == "" {
				return nil, "it names the home, which Timely doesn't know here"
			}
			text = path.Join(scope.Home, text[1:])
		}
		if !w.glob {
			out = append(out, text)
			continue
		}
		if w.lit {
			return nil, "it mixes a quoted * or ? with a pattern"
		}
		pattern := text
		if !path.IsAbs(pattern) {
			base, ok := scope.base()
			if !ok {
				return nil, "it uses a pattern in a folder Timely can't see"
			}
			pattern = path.Join(base, pattern)
		}
		matches, err := filepath.Glob(filepath.FromSlash(pattern))
		if err != nil {
			return nil, "it uses a pattern Timely can't read"
		}
		if len(matches) > maxGlob {
			return nil, "its pattern matches too many files to check"
		}
		if len(matches) == 0 {
			out = append(out, text) // bash passes an unmatched pattern as it is
			continue
		}
		for _, m := range matches {
			m = filepath.ToSlash(m)
			if strings.HasPrefix(path.Base(m), "-") {
				return nil, "its pattern matches a file whose name looks like an option"
			}
			out = append(out, m)
		}
	}
	return out, ""
}

// autoSecret are files a read-only command must not print without a card:
// passwords, keys and sign-ins (critical item 5), beyond the critical list's
// own settings and secret file patterns.
var autoSecret = regexp.MustCompile(`(?i)(^|/)(\.env(\.[^/]*)?|id_[a-z0-9]+(\.pub)?|[^/]*\.(pem|key|p12|pfx|kdbx|keystore|jks)|\.netrc|\.git-credentials|credentials(\.json)?|\.pgpass|\.npmrc|\.pypirc|\.htpasswd|secrets?\.(json|ya?ml|toml)|token(s)?\.json|\.ssh|\.gnupg|\.aws|\.docker|\.kube|\.hermes|\.password-store)(/|$)`)

// autoExample are .env files that hold no secrets by convention.
var autoExample = regexp.MustCompile(`(?i)(^|/)\.env\.(example|sample|template|dist)$`)

func secretOrConfig(p string, scope HostScope) bool {
	for _, q := range []string{p, resolveLinks(p)} {
		if (autoSecret.MatchString(q) && !autoExample.MatchString(q)) || secretFiles.MatchString(q) || configPath(q) || repoConfigPaths.MatchString(q) {
			return true
		}
	}
	return scope.config(p)
}

// secretName is secretOrConfig by name alone, for a walk: a repository's
// .git/config is one too (a remote's address can hold a token), its hooks are
// not.
func secretName(p string) bool {
	return (autoSecret.MatchString(p) && !autoExample.MatchString(p)) || secretFiles.MatchString(p) || configPath(p) || gitConfigFile.MatchString(p)
}

var gitConfigFile = regexp.MustCompile(`(^|/)\.git/config$`)

// autoPath says why reading p asks, or "": it must resolve (following
// existing links) inside the working folder and not be a secret or settings
// file.
func autoPath(p string, scope HostScope) string {
	if p == "-" {
		return "" // standard input
	}
	abs, ok := scope.abs(p)
	if !ok {
		return "it reads a path Timely can't place"
	}
	if !scope.inside(abs) {
		return "it reads outside the working folder"
	}
	if secretOrConfig(abs, scope) {
		return "it reads a file that may hold passwords, keys or settings"
	}
	return ""
}

// autoCwd says why a command that reads the folder it runs in asks, or "".
func autoCwd(scope HostScope) string {
	base, ok := scope.base()
	if !ok {
		return "it runs in a folder Timely can't see"
	}
	if !scope.inside(base) {
		return "it runs outside the working folder"
	}
	return ""
}

// maxWalk is how many entries a recursive content search may cover before
// Auto asks: the walk looks for secret files a search would print.
const maxWalk = 20000

// treeKind says how a content search walks a folder.
type treeKind int

const (
	treeGrep treeKind = iota // grep -r: every entry, .git included
	treeRg                   // rg: every entry, but .git only if rg could search it
)

// autoTree says why searching the contents of dir asks: a secret or settings
// file anywhere under it (grep -r PASSWORD . would print a .env), or more
// entries than Timely checks. Links are not followed, as grep -r and rg don't.
// The walk always includes dot files, whatever the command line or an ignore
// file says: rg skips hidden files unless a -g glob, a file type or a `!` line
// in a .ignore file un-hides them, and a walk that follows those rules is one
// the agent can steer (it can write a .ignore file). rg never searches a
// .git folder unless something whitelists it (a -g glob, --hidden, -u, a `!`
// line that could match .git), so for rg that folder is walked only then
// (rgGit): a plain `rg x` in a repository is fine, `rg -g '*' x` reads
// .git/config.
func autoTree(dir string, scope HostScope, kind treeKind, rgGit bool) string {
	abs, ok := scope.abs(dir)
	if !ok {
		return "it reads a path Timely can't place"
	}
	real := resolveLinks(abs)
	if fi, err := os.Stat(real); err != nil || !fi.IsDir() {
		return ""
	}
	n := 0
	found := ""
	var gitDirs []string
	var walk func(root string, skipGit bool)
	walk = func(root string, skipGit bool) {
		_ = filepath.WalkDir(filepath.FromSlash(root), func(p string, d fs.DirEntry, err error) error {
			n++
			if n > maxWalk {
				found = "it searches more files than Timely can check first"
				return filepath.SkipAll
			}
			if err != nil {
				return nil
			}
			sp := filepath.ToSlash(p)
			if skipGit && d.IsDir() && d.Name() == ".git" && sp != root {
				gitDirs = append(gitDirs, sp)
				return filepath.SkipDir
			}
			if kind == treeRg && !d.IsDir() && ignoreFile.MatchString(d.Name()) && ignoreWhitelistsGit(p) {
				rgGit = true
			}
			if secretName(sp) {
				found = "it searches a folder that holds a file with passwords, keys or settings (" + path.Base(sp) + ")"
				return filepath.SkipAll
			}
			return nil
		})
	}
	if kind == treeRg {
		// ignore files in the folders above the one searched apply too
		for d := real; scope.realInside(d); d = path.Dir(d) {
			for _, name := range []string{".ignore", ".rgignore", ".gitignore"} {
				if ignoreWhitelistsGit(filepath.FromSlash(path.Join(d, name))) {
					rgGit = true
				}
			}
			if d == "/" {
				break
			}
		}
	}
	walk(real, kind == treeRg)
	if found == "" && kind == treeRg && rgGit {
		for _, g := range gitDirs {
			if walk(g, false); found != "" {
				break
			}
		}
	}
	return found
}

var ignoreFile = regexp.MustCompile(`^\.(ignore|rgignore|gitignore)$`)

// ignoreWhitelistsGit reports whether an ignore file has a `!` line that
// could whitelist a .git folder (which rg then searches).
func ignoreWhitelistsGit(file string) bool {
	f, err := os.Open(file)
	if err != nil {
		return false
	}
	defer f.Close()
	b, _ := io.ReadAll(io.LimitReader(f, 256<<10))
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "!") {
			continue
		}
		pat := strings.Trim(strings.TrimPrefix(line, "!"), "/")
		if strings.Contains(pat, "**") {
			return true
		}
		for _, q := range []string{pat, path.Base(pat)} {
			if m, err := path.Match(q, ".git"); err != nil || m {
				return true
			}
		}
	}
	return false
}

// cdPathFree reports whether bash's cd skips CDPATH for a target: an absolute
// one, ., .. and anything starting ./ or ../.
func cdPathFree(t string) bool {
	return strings.HasPrefix(t, "/") || t == "." || t == ".." || strings.HasPrefix(t, "./") || strings.HasPrefix(t, "../")
}

// autoCd is the scope after cd to a folder inside the working folder.
func autoCd(args []string, scope HostScope) (HostScope, string) {
	if len(args) != 1 || strings.HasPrefix(args[0], "-") {
		return scope, "it changes folder in a way Timely can't follow"
	}
	abs, ok := scope.abs(args[0])
	if !ok {
		return scope, "it changes folder in a way Timely can't follow"
	}
	if !scope.inside(abs) {
		return scope, "it moves outside the working folder"
	}
	scope.Cwd, scope.CwdUnknown = abs, false
	return scope, ""
}

// Option kinds in a program's spec.
const (
	optBool  = 'b' // takes no value
	optValue = 'v' // takes a value: --x=v, --x v, -xv or -x v
	optOpt   = 'o' // takes a value only as --x=v (--color[=when])
	optPath  = 'p' // takes a path, judged like an operand
)

// progSpec is what Auto accepts of one program.
type progSpec struct {
	short map[byte]byte   // letter -> kind
	long  map[string]byte // --name -> kind
	// numeric accepts -5 (head -20, grep -3).
	numeric bool
	// operands: 'p' paths, 't' text (never opened), 'n' none.
	operands byte
	max      int // most operands, 0 for any
	// pattern: the first operand is a pattern (text) unless -e or -f gave one.
	pattern bool
	// cwd: with no path operand the program reads the folder it runs in.
	cwd bool
	// tree: a folder operand's whole contents are read (a content search).
	tree bool
	// noDir: a folder operand is compared or printed as a whole tree (diff
	// -N prints every file only one side has), so it asks.
	noDir bool
}

func shorts(kind byte, letters string, m map[byte]byte) map[byte]byte {
	if m == nil {
		m = map[byte]byte{}
	}
	for i := 0; i < len(letters); i++ {
		m[letters[i]] = kind
	}
	return m
}

func longs(kind byte, names string, m map[string]byte) map[string]byte {
	if m == nil {
		m = map[string]byte{}
	}
	for _, n := range strings.Fields(names) {
		m["--"+n] = kind
	}
	return m
}

func spec(bools, values, paths, longBools, longValues, longOpts, longPaths string) progSpec {
	s := progSpec{short: shorts(optBool, bools, nil), long: longs(optBool, longBools, nil)}
	shorts(optValue, values, s.short)
	shorts(optPath, paths, s.short)
	longs(optValue, longValues, s.long)
	longs(optOpt, longOpts, s.long)
	longs(optPath, longPaths, s.long)
	s.operands = 'p'
	return s
}

func (s progSpec) with(f func(*progSpec)) progSpec { f(&s); return s }

// autoPrograms is the list. Each entry is a command an agent reaches for to
// look around a folder. It was picked as the standard read-only inspection
// set, not from counted usage: the parity scenarios make no terminal calls,
// and the live drives and host tests ran ls -la, cat, echo and printf; git
// status and git log are here because they are what a coding agent runs first
// in a repository. Every option that writes, runs a program, follows links out
// of a recursive walk or reads a list of files from a file is left out, so it
// asks.
var autoPrograms = map[string]progSpec{
	// ls lists a folder. Left out: -L/--dereference (a recursive listing
	// would follow links out of the folder).
	"ls": spec("aAlhRtrS1dFpinsgoXvUcuQkGBmxC", "IwT", "",
		"all almost-all human-readable recursive reverse size classify inode directory numeric-uid-gid group-directories-first full-time si no-group quote-name literal escape hide-control-chars show-control-chars author context",
		"sort time-style time format indicator-style block-size ignore hide width quoting-style tabsize", "color hyperlink", "").
		with(func(s *progSpec) { s.cwd = true }),
	// cat prints a file.
	"cat": spec("nbAEsvTetu", "", "", "number number-nonblank show-all show-ends squeeze-blank show-tabs show-nonprinting", "", "", ""),
	// head and tail print part of a file. Left out: tail -f (never ends).
	"head": spec("qvz", "nc", "", "quiet silent verbose zero-terminated", "lines bytes", "", "").with(func(s *progSpec) { s.numeric = true }),
	"tail": spec("qvz", "nc", "", "quiet silent verbose zero-terminated", "lines bytes", "", "").with(func(s *progSpec) { s.numeric = true }),
	// wc counts. Left out: --files0-from (reads names from a file).
	"wc": spec("lwcmL", "", "", "lines words bytes chars max-line-length", "", "total", ""),
	// file says what a file is. Left out: -C (writes a magic file), -f, -m,
	// -z (runs decompressors).
	"file": spec("biLkNhpE", "", "", "brief mime mime-type mime-encoding dereference no-dereference keep-going no-pad extension apple", "", "", ""),
	// stat shows a file's details.
	"stat": spec("Ltf", "c", "", "dereference terse file-system", "format printf", "", ""),
	// du and df show sizes and free space. Left out: du -L, -X,
	// --files0-from, --exclude-from.
	"du": spec("shacbkmxl0", "dBt", "", "summarize human-readable all total apparent-size bytes one-file-system si null count-links", "max-depth threshold block-size exclude time-style", "time", "").
		with(func(s *progSpec) { s.cwd = true }),
	"df": spec("hHiTlaPk", "tx", "", "human-readable inodes print-type local all portability total si", "type exclude-type block-size", "output", ""),
	// pwd prints the folder.
	"pwd": spec("LP", "", "", "", "", "", "").with(func(s *progSpec) { s.operands = 'n' }),
	// grep searches. Left out: -R/--dereference-recursive (follows every
	// link), --exclude-from, and -d/--directories and -D/--devices (any value
	// of --directories, even an abbreviation like rec, makes it recurse). A
	// folder it searches is walked first for secret files.
	"grep": spec("inrlLcvwxEFGPosqhHIaUzZTbyU", "emABC", "f",
		"ignore-case no-ignore-case line-number recursive files-with-matches files-without-match count invert-match word-regexp line-regexp extended-regexp fixed-strings basic-regexp perl-regexp only-matching no-messages quiet silent no-filename with-filename text null null-data byte-offset initial-tab line-buffered",
		"regexp max-count after-context before-context context include exclude exclude-dir label binary-files", "color colour", "file").
		with(func(s *progSpec) { s.numeric, s.pattern, s.tree = true, true, true }),
	// rg searches. Left out: --pre/--pre-glob and -z/--search-zip (run other
	// programs), -L/--follow, --hostname-bin, --ignore-file.
	"rg": spec("inlcvwxFSsuUHNo0pqIa.", "egtTmABCMdjr", "f",
		"ignore-case smart-case case-sensitive line-number no-line-number files-with-matches files-without-match count count-matches invert-match word-regexp line-regexp fixed-strings hidden no-ignore no-ignore-vcs files no-heading heading with-filename no-filename only-matching json multiline null text vimgrep stats trim column no-messages quiet pretty unrestricted no-config",
		"color colors sort sortr type type-not glob iglob max-count max-depth max-columns after-context before-context context regexp replace threads max-filesize engine", "", "file").
		with(func(s *progSpec) { s.pattern, s.tree, s.cwd = true, true, true }),
	// tree draws a folder. Left out: -l (follows links), -o (writes a file),
	// -R, --fromfile.
	"tree": spec("adfisDhpugCnNFxJAS", "LIP", "", "dirsfirst noreport gitignore du si", "filelimit sort charset", "", "").
		with(func(s *progSpec) { s.cwd = true }),
	// diff and cmp compare two files; a folder operand asks (diff compares
	// the top-level files of two folders and prints the ones only one side
	// has, whole). Left out: diff -r (follows links into other folders),
	// --from-file/--to-file, -x/-X.
	"diff": spec("cuqsbwBiyaEZtTpN", "UWCFIL", "",
		"brief report-identical-files ignore-space-change ignore-all-space ignore-blank-lines ignore-case side-by-side text expand-tabs initial-tab show-c-function strip-trailing-cr minimal speed-large-files suppress-common-lines new-file",
		"label width ignore-matching-lines", "unified context color", "").with(func(s *progSpec) { s.max, s.noDir = 2, true }),
	"cmp": spec("lsb", "ni", "", "verbose silent quiet print-bytes", "bytes ignore-initial", "", "").with(func(s *progSpec) { s.max, s.noDir = 4, true }),
	// sort, uniq, cut and tr reshape text. Left out: sort -o/--output,
	// -T, --compress-program (runs a program), --files0-from; a second uniq
	// operand (it is an output file).
	"sort": spec("bdfgiMhnRrVsuzcCm", "ktS", "",
		"reverse numeric-sort unique human-numeric-sort version-sort ignore-case stable zero-terminated general-numeric-sort month-sort dictionary-order ignore-leading-blanks merge random-sort",
		"key field-separator buffer-size sort parallel", "check", ""),
	"uniq": spec("cduiDz", "fsw", "", "count repeated unique ignore-case zero-terminated", "skip-fields skip-chars check-chars", "all-repeated group", "").
		with(func(s *progSpec) { s.max = 1 }),
	"cut": spec("szn", "dfcb", "", "complement only-delimited zero-terminated", "delimiter fields characters bytes output-delimiter", "", ""),
	"tr":  spec("cCdst", "", "", "complement delete squeeze-repeats truncate-set1", "", "", "").with(func(s *progSpec) { s.operands, s.max = 't', 2 }),
	// which, type and command -v say where a program is. Left out: command
	// without -v/-V (it runs the program).
	"which": spec("a", "", "", "", "", "", "").with(func(s *progSpec) { s.operands = 't' }),
	"type":  spec("afptP", "", "", "", "", "", "").with(func(s *progSpec) { s.operands = 't' }),
	// date and uname print the time and the system. Left out: date -s/--set
	// and an operand that is not +FORMAT (both set the clock), -f, -r.
	"date":  spec("uR", "d", "", "utc universal rfc-email", "date", "iso-8601 rfc-3339", "").with(func(s *progSpec) { s.operands, s.max = 't', 1 }),
	"uname": spec("asnrvmopi", "", "", "all kernel-name nodename kernel-release kernel-version machine processor hardware-platform operating-system", "", "", "").with(func(s *progSpec) { s.operands = 'n' }),
}

// Not on the list, on purpose: env and printenv (they print the environment,
// which holds the same secrets as /proc/self/environ, a critical-list file),
// jq and yq (jq reads the environment with $ENV and loads modules from ~/.jq;
// yq edits in place), sed and awk (they write files and run commands), xargs,
// tee, and every build, test or script runner (make, npm, go test, pytest,
// python x.py, ./x.sh): those run code the agent may have just written.

// autoSimple says why one simple command asks, or "".
func autoSimple(words []string, scope HostScope) string {
	prog := words[0]
	if envAssignment.MatchString(prog) {
		return "it sets an environment variable for the command"
	}
	if strings.Contains(prog, "/") {
		return "it runs a program by its path"
	}
	args := words[1:]
	switch prog {
	case "echo":
		return "" // prints its words; options are only -n -e -E
	case "printf":
		if len(args) > 0 && strings.HasPrefix(args[0], "-") {
			return "it uses a printf option (-v sets a shell variable)"
		}
		return ""
	case "command":
		if len(args) < 2 || (args[0] != "-v" && args[0] != "-V") {
			return "command runs a program unless it is command -v"
		}
		return ""
	case "find":
		return autoFind(args, scope)
	case "git":
		return autoGit(args, scope)
	}
	s, ok := autoPrograms[prog]
	if !ok {
		return prog + " is not on Auto's list of read-only commands"
	}
	ops, gotPattern, why := parseOptions(prog, s, args, scope)
	if why != "" {
		return why
	}
	if prog == "rg" && slices.Contains(args, "--files") {
		gotPattern = true // rg --files lists files and takes no pattern
	}
	if s.pattern && !gotPattern && len(ops) > 0 {
		ops = ops[1:]
	}
	if s.max > 0 && len(ops) > s.max {
		return prog + " is given more operands than Auto reads (the last may be written)"
	}
	switch s.operands {
	case 'n':
		if len(ops) > 0 {
			return prog + " is given operands Auto doesn't read"
		}
		return ""
	case 't':
		if prog == "date" && len(ops) == 1 && !strings.HasPrefix(ops[0], "+") {
			return "date with a value sets the clock"
		}
		return ""
	}
	// grep with no file and no -r reads what is piped into it
	stdin := prog == "grep" && !recursiveGrep(args)
	kind, rgGit := treeGrep, false
	if prog == "rg" {
		kind, rgGit = treeRg, rgWhitelists(args)
	}
	if len(ops) == 0 && (s.cwd || s.tree) && !stdin {
		if why := autoCwd(scope); why != "" {
			return why
		}
		if s.tree {
			return autoTree(".", scope, kind, rgGit)
		}
		return ""
	}
	for _, op := range ops {
		if why := autoPath(op, scope); why != "" {
			return why
		}
		if s.noDir && isDir(op, scope) {
			return prog + " is given a folder, which it reads as a whole tree"
		}
		if s.tree {
			if why := autoTree(op, scope, kind, rgGit); why != "" {
				return why
			}
		}
	}
	return ""
}

// isDir reports whether p, where its links lead, is a folder.
func isDir(p string, scope HostScope) bool {
	if p == "-" {
		return false
	}
	abs, ok := scope.abs(p)
	if !ok {
		return true // unknown: treat as a folder
	}
	fi, err := os.Stat(filepath.FromSlash(resolveLinks(abs)))
	return err == nil && fi.IsDir()
}

// rgWhitelists reports whether the command line can make rg search a .git
// folder (rg skips it as hidden): -g/--glob/--iglob (an override glob
// un-hides what it matches), --hidden, -u, --no-ignore and -. in any cluster.
func rgWhitelists(args []string) bool {
	for _, a := range args {
		if a == "--" {
			break
		}
		switch {
		case strings.HasPrefix(a, "--"):
			name, _, _ := strings.Cut(a, "=")
			switch name {
			case "--glob", "--iglob", "--hidden", "--unrestricted", "--no-ignore", "--no-ignore-vcs", "--no-ignore-dot", "--no-ignore-parent":
				return true
			}
		case strings.HasPrefix(a, "-") && len(a) > 1 && strings.ContainsAny(a[1:], ".ug"):
			return true
		}
	}
	return false
}

var envAssignment = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*\+?=`)

func recursiveGrep(args []string) bool {
	for _, a := range args {
		if a == "--" {
			break
		}
		if a == "--recursive" || (strings.HasPrefix(a, "-") && !strings.HasPrefix(a, "--") && strings.ContainsAny(a, "r")) {
			return true
		}
	}
	return false
}

// parseOptions reads a program's options by its spec, the GNU way (options
// may follow operands; -- ends them). It returns the operands, whether -e or
// -f gave the pattern, and why the call asks.
func parseOptions(prog string, s progSpec, args []string, scope HostScope) (ops []string, gotPattern bool, why string) {
	unknown := func(opt string) string { return prog + " " + opt + " is not an option Auto runs on its own" }
	value := func(kind byte, v string) string {
		if kind == optPath {
			return autoPath(v, scope)
		}
		return ""
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--":
			return append(ops, args[i+1:]...), gotPattern, ""
		case strings.HasPrefix(a, "--"):
			name, v, hasV := strings.Cut(a, "=")
			kind, ok := s.long[name]
			if !ok {
				return nil, false, unknown(name)
			}
			switch kind {
			case optBool:
				if hasV {
					return nil, false, unknown(a)
				}
			case optOpt:
			case optValue, optPath:
				if !hasV {
					if i+1 >= len(args) {
						return nil, false, unknown(name)
					}
					i++
					v = args[i]
				}
				if why := value(kind, v); why != "" {
					return nil, false, why
				}
				if name == "--regexp" || name == "--file" {
					gotPattern = true
				}
			}
		case len(a) > 1 && strings.HasPrefix(a, "-") && (prog != "echo"):
			if s.numeric && strings.Trim(a[1:], "0123456789") == "" {
				continue
			}
			for j := 1; j < len(a); j++ {
				kind, ok := s.short[a[j]]
				if !ok {
					return nil, false, unknown("-" + string(a[j]))
				}
				if kind == optBool {
					continue
				}
				v := a[j+1:]
				if v == "" {
					if i+1 >= len(args) {
						return nil, false, unknown("-" + string(a[j]))
					}
					i++
					v = args[i]
				}
				if why := value(kind, v); why != "" {
					return nil, false, why
				}
				if s.pattern && (a[j] == 'e' || a[j] == 'f') {
					gotPattern = true
				}
				break
			}
		default:
			ops = append(ops, a)
		}
	}
	return ops, gotPattern, ""
}

// find's expression words Auto accepts, by how many values each takes. Left
// out (so they ask): -exec, -execdir, -ok, -okdir, -delete, -fprint,
// -fprint0, -fprintf, -fls, -follow, -files0-from, and the -L and -H options
// (they follow links out of the folder).
var (
	findNoValue = set("-print", "-print0", "-prune", "-empty", "-o", "-a", "-or", "-and", "-not", "!", "(", ")", ",", "-true", "-false",
		"-readable", "-writable", "-executable", "-nouser", "-nogroup", "-depth", "-xdev", "-mount", "-ls", "-quit", "-daystart", "-noleaf")
	findText = set("-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex", "-type", "-xtype", "-maxdepth",
		"-mindepth", "-size", "-mtime", "-mmin", "-atime", "-amin", "-ctime", "-cmin", "-perm", "-user", "-group", "-uid", "-gid", "-links",
		"-inum", "-printf", "-regextype", "-lname", "-ilname")
	findPath = set("-newer", "-anewer", "-cnewer", "-samefile")
)

func autoFind(args []string, scope HostScope) string {
	i := 0
	for i < len(args) && args[i] == "-P" {
		i++
	}
	var starts []string
	for ; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") || a == "(" || a == ")" || a == "!" || a == "," {
			break
		}
		starts = append(starts, a)
	}
	for ; i < len(args); i++ {
		a := args[i]
		switch {
		case findNoValue[a]:
		case findText[a]:
			if i+1 >= len(args) {
				return "find " + a + " has no value"
			}
			i++
		case findPath[a]:
			if i+1 >= len(args) {
				return "find " + a + " has no value"
			}
			i++
			if why := autoPath(args[i], scope); why != "" {
				return why
			}
		default:
			return "find " + a + " is not an option Auto runs on its own"
		}
	}
	if len(starts) == 0 {
		return autoCwd(scope)
	}
	for _, s := range starts {
		if why := autoPath(s, scope); why != "" {
			return why
		}
	}
	return ""
}

// git's read-only subcommands and the options Auto accepts for each. Left
// out everywhere: -c and --config-env (a setting can name a program),
// --exec-path, --git-dir, --work-tree, -p/--paginate, --output (writes a
// file), --ext-diff and --textconv (run programs), --show-signature (runs
// gpg), -O (reads an order file); branch's delete, move, copy, create and
// upstream forms; remote anything but a plain listing.
var gitDiffBools = "p patch stat shortstat numstat name-only name-status summary no-color no-ext-diff no-textconv minimal patience histogram " +
	"ignore-space-at-eol ignore-space-change ignore-all-space ignore-blank-lines text no-renames find-renames find-copies full-index binary abbrev check raw " +
	"compact-summary dirstat cumulative no-prefix exit-code quiet relative irreversible-delete function-context"

var gitSubs = map[string]progSpec{
	"status": spec("sbvz", "u", "", "short branch long verbose show-stash ahead-behind no-ahead-behind renames no-renames null", "", "porcelain untracked-files ignored column ignore-submodules find-renames", ""),
	"log": spec("pzMCiuR", "nSGU", "", "oneline graph all patch stat shortstat numstat name-only name-status no-merges merges reverse first-parent abbrev-commit follow no-color no-decorate source "+
		"left-right cherry-pick cherry-mark branches tags remotes full-history simplify-by-decoration no-ext-diff no-textconv date-order topo-order author-date-order "+
		"regexp-ignore-case all-match invert-grep basic-regexp extended-regexp fixed-strings perl-regexp walk-reflogs no-abbrev-commit raw boundary no-walk relative-date summary",
		"max-count skip since until after before author committer grep format pretty date min-parents max-parents diff-filter encoding", "decorate color abbrev word-diff unified", "").
		with(func(s *progSpec) { s.numeric = true }),
	"diff": spec("pzRMCwbaU", "U", "", "cached staged merge-base "+gitDiffBools, "diff-filter word-diff-regex inter-hunk-context src-prefix dst-prefix", "color word-diff unified ignore-submodules dirstat", ""),
	"show": spec("pzMCwbsU", "U", "", "oneline no-patch abbrev-commit no-color no-decorate source "+gitDiffBools, "format pretty date diff-filter encoding", "decorate color word-diff unified", ""),
	"branch": spec("arvlq", "", "", "all remotes verbose list show-current no-color omit-empty ignore-case", "sort format points-at contains no-contains merged no-merged", "color column abbrev", "").
		with(func(s *progSpec) { s.operands = 't' }),
	"rev-parse": spec("q", "", "", "show-toplevel verify quiet git-dir is-inside-work-tree is-inside-git-dir show-prefix show-cdup absolute-git-dir symbolic symbolic-full-name git-common-dir is-bare-repository is-shallow-repository show-superproject-working-tree all branches tags remotes",
		"", "short abbrev-ref", ""),
	"ls-files": spec("cdmostkvfzi", "x", "", "cached deleted modified others stage killed exclude-standard full-name error-unmatch directory no-empty-directory eol debug deduplicate", "exclude", "abbrev format", "").
		with(func(s *progSpec) { s.operands = 'p' }),
	"blame":  spec("wMCeslftpcnb", "L", "", "porcelain line-porcelain root show-email show-name show-number show-stats incremental minimal", "date", "abbrev color-lines color-by-age", ""),
	"remote": spec("v", "", "", "verbose", "", "", "").with(func(s *progSpec) { s.operands = 'n' }),
}

// skipsSubmodules reports whether a git status or git diff is told, every
// time it says so, to leave submodules alone (--ignore-submodules=all).
func skipsSubmodules(name string, args []string) bool {
	if name != "status" && name != "diff" {
		return false
	}
	found := false
	for _, a := range args {
		if a == "--" {
			break
		}
		if strings.HasPrefix(a, "--ignore-submodules") {
			if a != "--ignore-submodules=all" {
				return false
			}
			found = true
		}
	}
	return found
}

func autoGit(args []string, scope HostScope) string {
	// Global options: only --no-pager, --no-optional-locks and -C to a folder
	// inside the working folder.
	i := 0
	for i < len(args) {
		switch a := args[i]; {
		case a == "--no-pager" || a == "--no-optional-locks":
			i++
		case a == "-C":
			if i+1 >= len(args) {
				return "git -C has no folder"
			}
			next, why := autoCd(args[i+1:i+2], scope)
			if why != "" {
				return "git -C " + strings.TrimPrefix(why, "it ")
			}
			scope = next
			i += 2
		case strings.HasPrefix(a, "-"):
			return "git " + a + " is not an option Auto runs on its own"
		default:
			goto sub
		}
	}
	return "git without a subcommand is not on Auto's list"
sub:
	name, rest := args[i], args[i+1:]
	s, ok := gitSubs[name]
	if !ok {
		return "git " + name + " is not on Auto's list of read-only commands"
	}
	if why := autoCwd(scope); why != "" {
		return why
	}
	if why := gitRepo(scope, skipsSubmodules(name, rest)); why != "" {
		return why
	}
	ops, _, why := parseOptions("git "+name, s, rest, scope)
	if why != "" {
		return why
	}
	for _, a := range rest {
		if a == "--" {
			break
		}
		if strings.Contains(a, "%G") {
			return "git " + name + " would check signatures, which runs gpg"
		}
	}
	switch name {
	case "branch":
		if len(ops) > 0 && !hasFlag(rest, "l", "--list") {
			return "git branch with a name creates or changes a branch"
		}
		return ""
	case "remote":
		if len(ops) > 0 {
			return "git remote with a subcommand is not on Auto's list"
		}
		return ""
	case "rev-parse":
		for _, op := range ops {
			if strings.HasPrefix(op, "-") {
				return "git rev-parse " + op + " is not an option Auto runs on its own"
			}
		}
	}
	for _, op := range ops {
		// git matches a path argument as a pathspec: a quoted * or ? still
		// globs (git log -p -- '*env' prints a committed .env) and :(magic)
		// changes what it means, so neither is judged as a literal name
		if strings.ContainsAny(op, "*?[") || strings.HasPrefix(op, ":") {
			return "git " + name + " is given a pattern, which can match a file with passwords or keys"
		}
		// a path, a revision (HEAD~2, main..dev) or rev:path; all are judged
		// as paths from the folder, and a rev:path also by its path part
		if why := autoPath(op, scope); why != "" {
			return why
		}
		if _, after, ok := strings.Cut(op, ":"); ok && after != "" && secretOrConfig(after, scope) {
			return "it reads a file that may hold passwords, keys or settings"
		}
	}
	return ""
}

// gitRepo says why git asks in the folder scope runs in, or "": the
// repository git would find must have a real .git folder inside the working
// folder, with no pointer elsewhere. A .git file, a bare repository laid out
// in a folder, a commondir or config.worktree pointer, an alternates or
// shallow file, or a config that includes another file or names a program
// (core.fsmonitor, a diff driver, a pager) would let a file the agent wrote
// make git read another repository or run a program. Writes under .git are on
// the critical list (item 5), so these only exist when the repository came
// that way. A repository with submodules asks too, unless the command skips
// them (noSubmodules): git status and git diff start a git inside every
// checked-out submodule, and that one reads the submodule's own config.
func gitRepo(scope HostScope, noSubmodules bool) string {
	base, ok := scope.base()
	if !ok {
		return "it runs in a folder Timely can't see"
	}
	dir := filepath.FromSlash(resolveLinks(base))
	for {
		dotgit := filepath.Join(dir, ".git")
		if fi, err := os.Lstat(dotgit); err == nil {
			if !fi.IsDir() {
				return "its repository's .git is a file or a link, which can point anywhere"
			}
			if !scope.inside(filepath.ToSlash(dir)) {
				return "its repository is outside the working folder"
			}
			for _, f := range []string{"commondir", "config.worktree", "shallow", "info/grafts", "objects/info/alternates", "objects/info/http-alternates"} {
				if _, err := os.Lstat(filepath.Join(dotgit, filepath.FromSlash(f))); err == nil {
					return "its repository points to another git folder or history (" + f + ")"
				}
			}
			if b, err := os.ReadFile(filepath.Join(dotgit, "config")); err == nil {
				if gitInclude.Match(b) {
					return "its repository's settings include another file"
				}
				if key := riskyGitConfig(b); key != "" {
					return "its repository's settings name a program git would run (" + key + ")"
				}
			}
			if !noSubmodules {
				if why := gitSubmodules(dir, dotgit); why != "" {
					return why
				}
			}
			return ""
		}
		if bareLayout(dir) {
			return "it runs in a folder laid out like a bare repository"
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "" // no repository: git only reports that
		}
		dir = parent
	}
}

const submoduleWhy = "its repository has submodules, and git runs inside each one with that folder's own settings"

// gitSubmodules says why a repository with submodules asks: a .gitmodules
// file, a .git/modules folder, a split index, or a gitlink in the index.
func gitSubmodules(dir, dotgit string) string {
	for _, p := range []string{filepath.Join(dir, ".gitmodules"), filepath.Join(dotgit, "modules")} {
		if _, err := os.Lstat(p); err == nil {
			return submoduleWhy
		}
	}
	if m, _ := filepath.Glob(filepath.Join(dotgit, "sharedindex.*")); len(m) > 0 {
		return "its index is split, which Timely can't read"
	}
	b, err := os.ReadFile(filepath.Join(dotgit, "index"))
	if err != nil {
		return "" // no index: nothing is staged, so no gitlink
	}
	gitlink, readable := indexHasGitlink(b)
	switch {
	case !readable:
		return "its index is in a form Timely can't read"
	case gitlink:
		return submoduleWhy
	}
	return ""
}

// indexHasGitlink reads a git index, version 2 or 3, for an entry whose mode
// is a gitlink (160000). readable is false for any other form.
func indexHasGitlink(b []byte) (gitlink, readable bool) {
	if len(b) < 12 || string(b[:4]) != "DIRC" {
		return false, false
	}
	version, count := binary.BigEndian.Uint32(b[4:8]), int(binary.BigEndian.Uint32(b[8:12]))
	if version != 2 && version != 3 {
		return false, false
	}
	off := 12
	for i := 0; i < count; i++ {
		if off+62 > len(b) {
			return false, false
		}
		mode := binary.BigEndian.Uint32(b[off+24 : off+28])
		flags := binary.BigEndian.Uint16(b[off+60 : off+62])
		fixed := 62
		if version == 3 && flags&0x4000 != 0 {
			fixed = 64
		}
		if mode&0xF000 == 0xE000 {
			return true, true
		}
		nul := bytes.IndexByte(b[min(off+fixed, len(b)):], 0)
		if nul < 0 {
			return false, false
		}
		off += (fixed + nul + 8) &^ 7
	}
	return false, true
}

// riskyGitConfig is the first setting in a repository's config that names a
// program git runs (riskyGitKeys), as section.subsection.key; "" for none.
func riskyGitConfig(b []byte) string {
	section := ""
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		for line != "" && line[0] == '[' {
			end := strings.IndexByte(line, ']')
			if end < 0 {
				return "an unreadable section"
			}
			head := strings.TrimSpace(line[1:end])
			if name, sub, ok := strings.Cut(head, " "); ok {
				section = name + "." + strings.Trim(strings.TrimSpace(sub), `"`)
			} else {
				section = head
			}
			line = strings.TrimSpace(line[end+1:])
		}
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}
		key, _, _ := strings.Cut(line, "=")
		key = section + "." + strings.TrimSpace(key)
		if riskyGitKeys.MatchString(key) {
			return key
		}
	}
	return ""
}

var gitInclude = regexp.MustCompile(`(?im)^\s*\[\s*include`)

// bareLayout reports whether git would read dir itself as a repository.
func bareLayout(dir string) bool {
	for _, f := range []string{"HEAD", "objects", "refs"} {
		if _, err := os.Lstat(filepath.Join(dir, f)); err != nil {
			return false
		}
	}
	return true
}
