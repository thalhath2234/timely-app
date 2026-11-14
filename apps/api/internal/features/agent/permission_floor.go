package agent

import (
	"path"
	"regexp"
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
	rmtreeRoot = regexp.MustCompile(`(?i)\brmtree\s*\(\s*(?:["'](?:/|~)["']|os\.path\.expanduser\(\s*["']~["']\s*\)|pathlib\.path\.home\(\s*\)|path\.home\(\s*\))`)
	forkBomb   = regexp.MustCompile(`:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&?\s*\}\s*;\s*:`)
	// a redirect or a copy onto a raw disk
	toRawDisk = regexp.MustCompile(`(?:>|\bof=)\s*/dev/(?:sd|hd|vd|xvd|nvme|mmcblk|disk|rdisk|md|dm-|mapper/)`)
)

const floorHome = "erases the home folder or the whole disk"

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
	if forkBomb.MatchString(line) || toRawDisk.MatchString(line) {
		return "writes onto a raw disk or forks without end", true
	}
	// Program text (execute_code, an interpreter's -c/-e/heredoc) is scanned as
	// text: a string in it may be the command.
	if code || strings.Contains(line, "<<") || rmtreeRoot.MatchString(line) {
		if rmRootText.MatchString(line) || rmtreeRoot.MatchString(line) {
			return floorHome, true
		}
	}
	inline := false
	for _, part := range commandSplit.Split(line, -1) {
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
	if inline && (rmRootText.MatchString(line) || rmtreeRoot.MatchString(line)) {
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
		if rmRootText.MatchString(part) || rmtreeRoot.MatchString(part) {
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
					if (p == "rm" && hasFlag(rest[1:], "rR", "--recursive")) || ((p == "chmod" || p == "chown" || p == "chgrp") && hasFlag(rest[1:], "R", "--recursive")) {
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

// floorOperand reports whether a recursive delete (or chmod -R) of op takes
// the disk's root, a system folder, the home or everything in them: `/`,
// `/*`, `~`, `$HOME`, the home itself, and `*` or `.` when the command runs
// in the root or the home.
func floorOperand(op string, scope HostScope) bool {
	op = strings.Trim(strings.TrimSpace(op), `"'`)
	if op == "" {
		return false
	}
	if len(op) > 1 {
		op = strings.TrimRight(op, "/")
		if op == "" {
			op = "/"
		}
	}
	glob := false
	if strings.HasSuffix(op, "/*") || strings.HasSuffix(op, "/.*") || strings.HasSuffix(op, "/.") {
		glob = true
	}
	op = strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(op, "/.*"), "/*"), "/.")
	switch {
	case op == "~" || op == "$HOME" || op == "${HOME}":
		return true
	case strings.HasPrefix(op, "~") || strings.HasPrefix(op, "$"):
		return false
	}
	if op == "" { // "/*"
		return true
	}
	if !path.IsAbs(op) {
		if !glob && op != "*" && op != "." && op != ".." && op != "./" && op != ".*" {
			return false
		}
		// a bare glob or dot: it means whatever folder the command runs in
		if scope.CwdUnknown {
			return false
		}
		base, ok := scope.base()
		if !ok {
			return false
		}
		op = path.Join(base, op)
		if op == base || strings.HasSuffix(op, "/*") {
			op = base
		}
	}
	op = path.Clean(op)
	if op == "/" || systemDirs[op] {
		return true
	}
	if scope.Home != "" {
		home := path.Clean(scope.Home)
		if op == home || strings.HasPrefix(home+"/", op+"/") { // the home or a folder above it
			return true
		}
	}
	return false
}
