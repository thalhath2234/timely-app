package agent

import (
	"path"
	"regexp"
	"slices"
	"strings"
)

// The hardline floor (plan 5.5b): a few commands that erase the disk or the
// whole home never run, in any mode, Full Access included. Hermes has a floor
// of its own (tools.approval._floor_block), but it reads the program name as
// typed, so `/bin/rm -rf /`, `command rm -rf /` and `cd / && rm -rf *` slip
// past it and Full Access then approves them. Go's floor reads the same
// command lines the critical list does (wrappers, shells, eval, find -exec,
// substitutions, cd), so it holds where Hermes' does not.

// systemDirs are top-level folders whose recursive delete or permission
// change takes the system or every user's files with it.
var systemDirs = set("/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib32", "/lib64", "/opt", "/proc", "/root", "/sbin", "/sys",
	"/usr", "/var", "/Users", "/System", "/Library", "/Applications", "/Volumes", "/private")

var (
	// A recursive rm whose operand is the root, the home or everything in
	// them, written anywhere in a script or an inline program (the text
	// layer: os.system("rm -rf /"), a perl one-liner, an execute_code string).
	rmRootText = regexp.MustCompile(`(?i)\brm\s+(?:[^\s;&|]+\s+)*?(?:-[a-z]*r[a-z]*|--recursive)\s+(?:[^\s;&|]+\s+)*?(?:--\s+)?["']?(?:/\*?|~/?\*?|\$\{?home\}?/?\*?)["']?(?:[\s;&|)"'\\]|$)`)
	// shutil.rmtree("/"), rmtree(os.path.expanduser("~"))
	rmtreeRoot = regexp.MustCompile(`(?i)\brmtree\s*\(\s*(?:["'](?:/|~)["']|os\.path\.expanduser\(\s*["']~["']\s*\)|pathlib\.path\.home\(\s*\)|path\.home\(\s*\))\s*[,)]`)
	forkBomb   = regexp.MustCompile(`:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&?\s*\}\s*;\s*:`)
	// a redirect or a copy onto a raw disk
	toRawDisk = regexp.MustCompile(`(?:>|\bof=)\s*/dev/(?:sd|hd|vd|xvd|nvme|mmcblk|disk|rdisk|md|dm-|mapper/)`)
)

const floorHome = "erases the home folder or the whole disk"

// The helpers below let the floor read the spellings of "the home" and of
// "up from here": ~, ~user, $HOME and ${HOME:?}, `..` climbs, a variable the
// same line set, $(echo X) and $(pwd), braces and globs that can match a
// system folder, and the quoted paths of program text. A name the line
// computes (a variable from outside, a substitution of another command)
// cannot be read: the floor is best effort for those, as plan 5.5b says.
var (
	assignment = regexp.MustCompile(`^\s*(?:export\s+|local\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s*$`)
	echoSubst  = regexp.MustCompile("\\$\\(\\s*(?:echo|printf)\\s+([^()]*?)\\s*\\)|`\\s*(?:echo|printf)\\s+([^`]*?)\\s*`")
	pwdSubst   = regexp.MustCompile("\\$\\(\\s*pwd\\s*\\)|`\\s*pwd\\s*`")
	homeVar    = regexp.MustCompile(`^\$(?:HOME\b|\{HOME[^}]*\})`)
	anyVar     = regexp.MustCompile(`^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\})`)

	// A call that removes a whole tree in program text: shutil.rmtree,
	// FileUtils.rm_rf, fs.rmSync, rimraf, perl's rmtree, os.removedirs ...
	removeCall = regexp.MustCompile(`(?:rmtree|rm_rf|rm_r|remove_tree|rmSync|rmdirSync|removeSync|emptyDirSync|rimraf(?:Sync)?|RemoveAll|removedirs|rmdir_p)\s*\(\s*(.{0,160})`)
	// What names the home in program text.
	homeExpr = `os\.environ(?:\.get)?\s*[\[(]\s*["']HOME["']\s*[\])]|os\.getenv\(\s*["']HOME["']\s*\)|(?:pathlib\.)?Path\.home\(\s*\)|(?:os\.path\.)?expanduser\(\s*["']~["']\s*\)|os\.homedir\(\s*\)|require\(["']os["']\)\.homedir\(\s*\)|process\.env\.HOME|Dir\.home(?:\(\s*\))?|ENV\[\s*["']HOME["']\s*\]|\$ENV\{\s*["']?HOME["']?\s*\}|os\.UserHomeDir\(\)`
	codeWrap = `(?:(?:str|Path|pathlib\.Path|os\.fspath|os\.path\.(?:abspath|realpath|normpath))\(\s*)*`
	homeArg  = regexp.MustCompile(`^` + codeWrap + `(?:` + homeExpr + `)\s*(?:[,)\]]|$)`)
	litArg   = regexp.MustCompile(`^` + codeWrap + `["']([^"']*)["']\s*(?:[,)\]]|$)`)
	// quoted strings, and runs of two or more quoted strings (an argv list)
	quoted  = regexp.MustCompile(`"((?:[^"\\\n]|\\.){1,400})"|'((?:[^'\\\n]|\\.){1,400})'`)
	argvRun = regexp.MustCompile(`["'][^"'\n]{1,200}["'](?:\s*,\s*["'][^"'\n]{1,200}["']){1,}`)
)

// HardlineHost says whether a host action is one of the commands that never
// run in any mode (a recursive delete or permission change of the disk's
// root, a system folder or the home, mkfs, a write onto a raw disk, a fork
// bomb). reason is shown to the model and the person.
func HardlineHost(h HostAction, scope HostScope) (reason string, ok bool) {
	if h.Kind != HostTerminal {
		return "", false
	}
	if h.Cwd != "" {
		scope.Cwd = h.Cwd
	}
	return floorCommand(h.Command, scope, h.Code, 0)
}

// floorDepth bounds how far wrappers, shells and substitutions are followed.
const floorDepth = 8

func floorCommand(line string, scope HostScope, code bool, depth int) (string, bool) {
	line = strings.TrimSpace(line)
	if line == "" || depth > floorDepth {
		return "", false
	}
	if scope.vars == nil {
		scope.vars = map[string]string{}
	}
	if forkBomb.MatchString(line) || toRawDisk.MatchString(line) {
		return "writes onto a raw disk or forks without end", true
	}
	// $(echo /), $(pwd): a substitution that only names a path is that path.
	line = pwdSubst.ReplaceAllStringFunc(line, func(string) string {
		if base, ok := scope.base(); ok {
			return base
		}
		return "$(pwd)"
	})
	line = echoSubst.ReplaceAllString(line, "$1$2")
	// Program text (execute_code, an interpreter's -c/-e/heredoc) is scanned as
	// text: a string in it may be the command.
	if code || strings.Contains(line, "<<") || rmtreeRoot.MatchString(line) {
		if codeFloor(line, scope, depth) {
			return floorHome, true
		}
	}
	inline := false
	for _, part := range commandSplit.Split(line, -1) {
		if m := assignment.FindStringSubmatch(part); m != nil {
			scope.vars[m[1]] = strings.Trim(m[2], `"'`)
			continue
		}
		if next, ok := cdScope(part, scope); ok {
			scope = next
			continue
		}
		if why, ok := floorPart(part, scope, depth); ok {
			return why, true
		}
		if words, _ := unwrapCommand(fields(part)); len(words) > 0 && inlineCode(path.Base(strings.TrimLeft(words[0], `\`)), words[1:], part) {
			inline = true
		}
	}
	// An interpreter's inline program may hold ; and quotes that split the
	// line mid-string: read the whole line as text.
	if inline && codeFloor(line, scope, depth) {
		return floorHome, true
	}
	for _, m := range substitution.FindAllStringSubmatch(line, -1) {
		if why, ok := floorCommand(m[1]+m[2], scope, code, depth+1); ok {
			return why, true
		}
	}
	// xargs reads its operands from the line before it: echo / | xargs rm -rf.
	if strings.Contains(line, "xargs") {
		if why, ok := floorXargs(line, scope); ok {
			return why, true
		}
	}
	return "", false
}

// codeFloor reads program text for what erases the home or the disk: a
// literal rm -rf of the root or the home, a call that removes a tree whose
// argument is the root, the home or a folder above it, and every string in
// it that is itself such a command (os.system("rm -rf /home/me"), an argv
// list ['rm', '-rf', '/']).
func codeFloor(text string, scope HostScope, depth int) bool {
	if rmRootText.MatchString(text) || rmtreeRoot.MatchString(text) {
		return true
	}
	for _, m := range removeCall.FindAllStringSubmatch(text, -1) {
		arg := strings.TrimSpace(m[1])
		if homeArg.MatchString(arg) {
			return true
		}
		if l := litArg.FindStringSubmatch(arg); l != nil && floorOperand(l[1], scope) {
			return true
		}
	}
	if depth >= floorDepth {
		return false
	}
	for _, m := range quoted.FindAllStringSubmatch(text, -1) {
		lit := m[1] + m[2]
		if !strings.ContainsAny(lit, " ") {
			continue
		}
		if floorWord.MatchString(lit) {
			if _, ok := floorCommand(lit, scope, false, depth+1); ok {
				return true
			}
		}
		// a string that holds another program's text: python -c "...'rm -rf /'..."
		if strings.ContainsAny(lit, `"'`) && codeFloor(lit, scope, depth+1) {
			return true
		}
	}
	for _, run := range argvRun.FindAllString(text, -1) {
		var words []string
		for _, m := range quoted.FindAllStringSubmatch(run, -1) {
			words = append(words, m[1]+m[2])
		}
		if _, ok := floorCommand(strings.Join(words, " "), scope, false, depth+1); ok {
			return true
		}
	}
	return false
}

// floorWord is a program a string must name before the floor reads it as a
// command line.
var floorWord = regexp.MustCompile(`\b(?:rm|rmdir|shred|chmod|chown|chgrp|mv|rsync|find|mkfs|dd)\b`)

// floorPart judges one simple command.
func floorPart(part string, scope HostScope, depth int) (string, bool) {
	words, _ := unwrapCommand(fields(part))
	if len(words) == 0 {
		return "", false
	}
	prog := path.Base(strings.TrimLeft(words[0], `\`))
	args := words[1:]
	switch {
	case prog == "eval":
		return floorCommand(strings.Join(args, " "), scope, false, depth+1)
	case shellPrograms[prog]:
		if payload, ok := shellPayload(args); ok {
			return floorCommand(payload, scope, false, depth+1)
		}
		return "", false
	case inlineCode(prog, args, part):
		// python -c, node -e, perl -e: the program is text.
		if codeFloor(part, scope, depth) {
			return floorHome, true
		}
		return "", false
	case prog == "find":
		starts := []string{}
		for _, a := range args {
			if strings.HasPrefix(a, "-") || a == "(" || a == "!" {
				break
			}
			starts = append(starts, a)
		}
		for i, a := range args {
			if oneOf(a, "-exec", "-execdir", "-ok", "-okdir") && i+1 < len(args) {
				if rest, _ := unwrapCommand(args[i+1:]); len(rest) > 0 {
					p := path.Base(rest[0])
					// find hands rm every file it finds, so rm needs no -r to empty a
					// tree.
					if oneOf(p, "rm", "rmdir", "shred", "unlink") || ((p == "chmod" || p == "chown" || p == "chgrp") && hasFlag(rest[1:], "R", "--recursive")) {
						for _, st := range starts {
							if floorOperand(st, scope) {
								return floorHome, true
							}
						}
					}
				}
			}
			if oneOf(a, "-exec", "-execdir", "-ok", "-okdir") && i+1 < len(args) {
				if why, ok := floorPart(strings.Join(args[i+1:], " "), scope, depth+1); ok {
					return why, true
				}
			}
			if a == "-delete" {
				for _, st := range starts {
					if floorOperand(st, scope) {
						return floorHome, true
					}
				}
			}
		}
		return "", false
	case prog == "rm" || prog == "rmdir" || prog == "shred" || prog == "srm":
		if prog == "rm" && !hasFlag(args, "rR", "--recursive") {
			return "", false
		}
		for _, op := range operands(args) {
			if floorOperand(op, scope) {
				return floorHome, true
			}
		}
	case prog == "chmod" || prog == "chown" || prog == "chgrp":
		if !hasFlag(args, "R", "--recursive") {
			return "", false
		}
		for _, op := range operands(args) {
			if floorOperand(op, scope) {
				return floorHome, true
			}
		}
	case prog == "mv":
		// Moving the home, a system folder or everything in one takes it
		// away as surely as deleting it.
		for _, op := range operands(args) {
			if floorOperand(op, scope) {
				return floorHome, true
			}
		}
	case prog == "rsync":
		// rsync --delete makes the destination match the source: an empty
		// source over the home erases it.
		if hasFlag(args, "", "--delete", "--delete-after", "--delete-before", "--delete-during", "--delete-delay", "--delete-excluded", "--del", "--remove-source-files") {
			ops := operands(args)
			if len(ops) >= 2 && floorOperand(ops[len(ops)-1], scope) {
				return floorHome, true
			}
			if hasFlag(args, "", "--remove-source-files") {
				for _, op := range ops[:max(len(ops)-1, 0)] {
					if floorOperand(op, scope) {
						return floorHome, true
					}
				}
			}
		}
	case strings.HasPrefix(prog, "mkfs") || prog == "mke2fs" || prog == "wipefs" || prog == "blkdiscard" || prog == "fdisk" || prog == "sfdisk" || prog == "parted":
		return "formats a disk", true
	case prog == "dd":
		for _, a := range args {
			if toRawDisk.MatchString(a) {
				return "writes onto a raw disk", true
			}
		}
	}
	return "", false
}

// floorXargs finds `echo <target> | xargs rm -rf` and `xargs rm -rf <<< <target>`.
func floorXargs(line string, scope HostScope) (string, bool) {
	parts := strings.Split(line, "|")
	for i, seg := range parts {
		if !strings.Contains(seg, "xargs") {
			continue
		}
		var feed []string
		if i > 0 {
			prev := fields(parts[i-1])
			if len(prev) > 0 && oneOf(path.Base(prev[0]), "echo", "printf") {
				feed = append(feed, prev[1:]...)
			}
		}
		if j := strings.Index(seg, "<<<"); j >= 0 {
			feed = append(feed, fields(seg[j+3:])...)
		}
		if len(feed) == 0 {
			continue
		}
		// the command xargs runs, without the feed
		cmd := seg
		if j := strings.Index(cmd, "<<<"); j >= 0 {
			cmd = cmd[:j]
		}
		rest, _ := unwrapCommand(fields(cmd))
		if len(rest) == 0 {
			continue
		}
		prog := path.Base(rest[0])
		recursive := hasFlag(rest[1:], "rR", "--recursive")
		if (prog == "rm" && recursive) || ((prog == "chmod" || prog == "chown" || prog == "chgrp") && hasFlag(rest[1:], "R", "--recursive")) {
			for _, f := range feed {
				if floorOperand(f, scope) {
					return floorHome, true
				}
			}
		}
	}
	return "", false
}

// floorOperand reports whether a recursive delete (or chmod -R, a move, an
// rsync --delete) of op takes the disk's root, a system folder, the home or
// everything in them: `/`, `/*`, `~`, `$HOME`, the home itself or a way up
// from it (`~/..`, `$HOME/../..`, `../..` from the working folder), a glob or
// brace that can match one of them (`/h?me`, `/home/me/{*,.*}`), and `*` or
// `.` when the command runs in the root or the home.
func floorOperand(op string, scope HostScope) bool {
	op = expandPath(op, scope)
	if op == "" {
		return false
	}
	for _, one := range braceExpand(op, 0) {
		if floorOne(one, scope) {
			return true
		}
	}
	return false
}

// expandPath reads ~, ~user, $HOME, ${HOME:?} and the variables the line set
// at the start of op. A home that is not known leaves a bare ~ as ~.
func expandPath(op string, scope HostScope) string {
	op = strings.Trim(strings.TrimSpace(op), `"'`)
	for range 3 { // a variable may hold another
		switch {
		case op == "~" || strings.HasPrefix(op, "~/"):
			if scope.Home == "" {
				return op
			}
			op = path.Join(scope.Home, op[1:])
		case strings.HasPrefix(op, "~"):
			name, rest, _ := strings.Cut(op[1:], "/")
			op = path.Join(userHome(name, scope), rest)
		case homeVar.MatchString(op):
			rest := op[len(homeVar.FindString(op)):]
			if scope.Home == "" {
				return "~" + rest
			}
			op = path.Join(scope.Home, rest)
		case strings.HasPrefix(op, "$"):
			m := anyVar.FindStringSubmatch(op)
			if m == nil {
				return op
			}
			name := m[1] + m[2]
			val, ok := scope.vars[name]
			if !ok {
				return op
			}
			op = strings.Trim(val, `"'`) + op[len(m[0]):]
		default:
			return op
		}
	}
	return op
}

// userHome is the home of the user ~name names: the account's own when the
// name is its folder's, else a sibling of it.
func userHome(name string, scope HostScope) string {
	if name == "root" {
		return "/root"
	}
	home := path.Clean(scope.Home)
	if scope.Home == "" {
		home = "/home/" + name
	}
	if path.Base(home) == name {
		return home
	}
	return path.Join(path.Dir(home), name)
}

// braceExpand opens one level of {a,b} at a time (at most 64 results).
func braceExpand(s string, depth int) []string {
	i := strings.Index(s, "{")
	if i < 0 || depth > 4 {
		return []string{s}
	}
	j := strings.Index(s[i:], "}")
	if j < 0 {
		return []string{s}
	}
	j += i
	var out []string
	for _, alt := range strings.Split(s[i+1:j], ",") {
		out = append(out, braceExpand(s[:i]+alt+s[j+1:], depth+1)...)
		if len(out) > 64 {
			break
		}
	}
	return out
}

// floorOne judges one expanded operand.
func floorOne(op string, scope HostScope) bool {
	if op == "~" {
		return true // the home, when it is not known
	}
	if op == "" || strings.HasPrefix(op, "~") || strings.ContainsAny(op, "$`") {
		return false
	}
	if !path.IsAbs(op) {
		// A relative operand is judged from the folder the command runs in.
		if scope.CwdUnknown {
			return false
		}
		base, ok := scope.base()
		if !ok {
			return false
		}
		op = path.Join(base, op)
	}
	op = path.Clean(op)
	// A trailing glob means everything in that folder.
	for _, g := range []string{"/.*", "/*", "/."} {
		if strings.HasSuffix(op, g) {
			op = path.Clean(strings.TrimSuffix(op, g) + "/")
			break
		}
	}
	if strings.ContainsAny(op, "*?[") {
		for _, d := range floorDirs(scope) {
			if ok, err := path.Match(op, d); err == nil && ok {
				return true
			}
		}
		return false
	}
	dirs := floorDirs(scope)
	if slices.Contains(dirs, op) {
		return true
	}
	// A link leads to where it points: `rm -rf link/*` in a folder whose
	// `link` is the home erases the home (the critical list reads links the
	// same way, realInside).
	if real := resolveLinks(op); real != op && slices.Contains(dirs, real) {
		return true
	}
	return false
}

// floorDirs are the folders a recursive delete of must never run: the root,
// the system folders, the home and every folder above it.
func floorDirs(scope HostScope) []string {
	out := []string{"/"}
	for d := range systemDirs {
		out = append(out, d)
	}
	if scope.Home != "" {
		for d := path.Clean(scope.Home); d != "/" && d != "."; d = path.Dir(d) {
			out = append(out, d)
		}
		// The home may itself sit behind a link (/home/me -> /data/me).
		if real := resolveLinks(path.Clean(scope.Home)); real != path.Clean(scope.Home) {
			for d := real; d != "/" && d != "."; d = path.Dir(d) {
				out = append(out, d)
			}
		}
	}
	return out
}
