package agent

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// Phase 5, review round 3: what the first critical list did not read.
// Paths are judged where they really land (symlinks), downloads, archives and
// clones are writes to their destination, programs that run the folder's own
// code (builds, tests, runners) ask like a script file does, and deleting
// subcommands of common tools (git stash drop, docker prune, kubectl delete,
// terraform destroy, cloud CLIs) are item 1.

// resolveLinks is p with the symlinks it passes through (and, when p itself
// is one, the one it is) followed, even where the path does not exist yet: the
// deepest part that exists is resolved and the rest is put back. A link
// inside the agent's folder that points outside it lets a write to the link
// reach the target.
func resolveLinks(p string) string {
	if !filepath.IsAbs(filepath.FromSlash(p)) {
		return p
	}
	cur, rest := filepath.FromSlash(p), ""
	for i := 0; i < 40; i++ {
		if fi, err := os.Lstat(cur); err == nil {
			if fi.Mode()&os.ModeSymlink != 0 {
				target, err := os.Readlink(cur)
				if err != nil {
					return p
				}
				if !filepath.IsAbs(target) {
					target = filepath.Join(filepath.Dir(cur), target)
				}
				cur = filepath.Clean(target)
				continue
			}
			real, err := filepath.EvalSymlinks(cur)
			if err != nil {
				return p
			}
			return path.Clean(filepath.ToSlash(filepath.Join(real, rest)))
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return p
		}
		rest = filepath.Join(filepath.Base(cur), rest)
		cur = parent
	}
	return p
}

// abs is p as an absolute path from the folder the call runs in, with ~ and
// $HOME read as the home; false when that is not known.
func (s HostScope) abs(p string) (string, bool) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", false
	}
	if strings.HasPrefix(p, "~") || strings.HasPrefix(p, "$") {
		p = expandPath(p, s)
		if strings.HasPrefix(p, "~") || strings.HasPrefix(p, "$") {
			return "", false
		}
	}
	if !path.IsAbs(p) {
		base, ok := s.base()
		if !ok {
			return "", false
		}
		p = path.Join(base, p)
	}
	return path.Clean(p), true
}

// config reports whether a file holds settings or credentials, as written or
// where its links lead.
func (s HostScope) config(p string) bool {
	if configPath(p) {
		return true
	}
	abs, ok := s.abs(p)
	return ok && configPath(resolveLinks(abs))
}

// realInside is the symlink-resolved path inside the folder (which is itself
// resolved: /tmp may be a link).
func (s HostScope) realInside(real string) bool {
	ws := resolveLinks(path.Clean(s.Workspace))
	return real == ws || strings.HasPrefix(real, strings.TrimSuffix(ws, "/")+"/")
}

// The settings and credential files of a repository and a shell: a git hook
// or a repository's own config runs code on a later `git commit`, and a
// .envrc runs on `direnv allow`.
var repoConfigPaths = regexp.MustCompile(`(?i)(^|/)(\.git/(hooks/|config$|info/|modules/[^/]+/(hooks/|config$))|\.husky/|\.envrc$|\.githooks/)`)

// riskyGitKeys are the git settings that name a program git then runs.
var riskyGitKeys = regexp.MustCompile(`(?i)^(core\.(hookspath|sshcommand|pager|editor|fsmonitor|askpass|gitproxy|attributesfile|excludesfile)|alias\..+|filter\..+|diff\..+\.(textconv|command)|diff\.external|merge\..+\.driver|credential(\..+)?\.helper|sequence\.editor|gpg\.(.+\.)?program|http\.proxy|url\..+\.insteadof|include\.path|includeif\..+|safe\.directory|protocol\..+)$`)

// deleteWord is a subcommand or an operation name that deletes something on a
// service or the machine (delete-bucket, apps:destroy, s3 rm, terminate-...).
var deleteWord = regexp.MustCompile(`(?i)(^|[:_-])(delete|destroy|remove|rm|rb|rmi|purge|terminate|deregister|unpublish|undeploy|teardown|wipe|erase|uninstall|prune|nuke)([:_-]|$)`)

// cloudCLIs have no fixed grammar: any of their first operands that reads as
// deleting makes the call deleting.
var cloudCLIs = set("gcloud", "az", "doctl", "heroku", "fly", "flyctl", "wrangler", "vercel", "netlify", "firebase", "supabase", "railway", "scw", "linode-cli", "oci", "ibmcloud", "aliyun", "hcloud", "exo", "civo", "upctl", "pscale", "turso", "neon", "neonctl", "stripe")

// modules that python -m runs without running code from the folder.
var benignModules = set("pip", "ensurepip", "venv", "virtualenv", "json.tool", "py_compile", "compileall", "site", "sysconfig", "platform", "this", "zipapp", "tokenize", "webbrowser", "uv")

const (
	runnerReason   = "runs code from this folder (a build, a test or a script) that the agent may have just written"
	killReason     = "stops running programs"
	downloadReason = "writes a file outside the agent's folder"
)

// judgeDest says how critical writing to dest is: a settings file is item 5,
// anywhere outside the agent's folder item 1.
func judgeDest(dest string, scope HostScope, reason string) (int, string) {
	dest = strings.Trim(strings.TrimSpace(dest), `"'`)
	switch dest {
	case "", "-", "/dev/null", "/dev/stdout", "/dev/stderr":
		return 0, ""
	}
	// A folder is judged as one (.ssh/ , .git/hooks/ name settings by their
	// slash).
	dir := strings.TrimSuffix(dest, "/") + "/"
	if scope.config(dest) || scope.config(dir) || repoConfigPaths.MatchString(dir) {
		return CriticalSettings, "changes a settings file"
	}
	if !scope.inside(dest) {
		return CriticalDeleting, reason
	}
	return 0, ""
}

// flagValues are the values of an option given as `-o v`, `-ov`, `--out v`,
// `--out=v` or the last letter of a short cluster (`-sSo v`).
func flagValues(args []string, short byte, long ...string) []string {
	var out []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			break
		}
		if strings.HasPrefix(a, "--") {
			name, val, has := strings.Cut(a, "=")
			if slices.Contains(long, name) {
				if has {
					out = append(out, val)
				} else if i+1 < len(args) {
					out = append(out, args[i+1])
					i++
				}
			}
			continue
		}
		if short != 0 && strings.HasPrefix(a, "-") && len(a) > 1 {
			if j := strings.IndexByte(a, short); j >= 1 {
				if j == len(a)-1 {
					if i+1 < len(args) {
						out = append(out, args[i+1])
						i++
					}
				} else {
					out = append(out, a[j+1:])
				}
			}
		}
	}
	return out
}

// tarExtracts reports whether a tar call unpacks an archive.
func tarExtracts(args []string) bool {
	for i, a := range args {
		if strings.HasPrefix(a, "--") {
			if a == "--extract" || a == "--get" {
				return true
			}
			continue
		}
		if strings.HasPrefix(a, "-") && len(a) > 1 && strings.Contains(a[1:], "x") && !strings.ContainsAny(a[1:], "0123456789=") {
			return true
		}
		// old style: tar xzf a.tgz (the first word, no dash)
		if i == 0 && !strings.HasPrefix(a, "-") && strings.Trim(a, "xzjJvfpkoOUmaCZ") == "" && strings.Contains(a, "x") {
			return true
		}
	}
	return false
}

var gitCloneValued = set("-b", "--branch", "-o", "--origin", "--depth", "--reference", "--reference-if-able", "--separate-git-dir", "--template", "-c", "--config", "-j", "--jobs", "--filter", "--shallow-since", "--shallow-exclude", "--server-option", "-u", "--upload-pack", "--bundle-uri")

// moreProgramItem is programItem's second reading of a program and its
// arguments; the worse of the two answers stands.
func moreProgramItem(prog string, args []string, scope HostScope) (int, string) {
	first := sub(args, 0)
	switch prog {
	// Downloads and extractions write to their destination.
	case "curl":
		dests := append(flagValues(args, 'o', "--output"), flagValues(args, 0, "--output-dir")...)
		if len(dests) == 0 && hasFlag(args, "O", "--remote-name", "--remote-name-all") {
			dests = []string{"."}
		}
		if hasFlag(args, "O", "--remote-name") && len(flagValues(args, 0, "--output-dir")) > 0 {
			dests = append(dests, flagValues(args, 0, "--output-dir")...)
		}
		return worstDest(dests, scope, downloadReason)
	case "wget", "wget2":
		dests := append(flagValues(args, 'O', "--output-document"), flagValues(args, 'P', "--directory-prefix")...)
		if len(dests) == 0 {
			dests = []string{"."}
		}
		return worstDest(dests, scope, downloadReason)
	case "tar", "bsdtar", "gtar":
		if !tarExtracts(args) {
			return 0, ""
		}
		dests := flagValues(args, 'C', "--directory")
		if len(dests) == 0 {
			dests = []string{"."}
		}
		if hasFlag(args, "P", "--absolute-names") {
			return CriticalDeleting, "unpacks files to absolute paths"
		}
		return worstDest(dests, scope, "unpacks files outside the agent's folder")
	case "unzip", "7z", "7za", "7zr":
		dests := flagValues(args, 'd')
		if prog != "unzip" {
			for _, a := range args {
				if strings.HasPrefix(a, "-o") && len(a) > 2 {
					dests = append(dests, a[2:])
				}
			}
			if len(operands(args)) == 0 || !oneOf(first, "x", "e") {
				return 0, ""
			}
		}
		if len(dests) == 0 {
			dests = []string{"."}
		}
		return worstDest(dests, scope, "unpacks files outside the agent's folder")
	case "rename", "prename", "perl-rename", "file-rename":
		// rename 's/a/b/' files...: every file after the expression may move.
		ops := operands(args)
		if len(ops) < 2 {
			return 0, ""
		}
		for _, f := range ops[1:] {
			if scope.config(f) {
				return CriticalSettings, "changes a settings file"
			}
			if !scope.insideLink(f) {
				return CriticalDeleting, "renames files outside the agent's folder"
			}
		}
		return 0, ""
	case "gcc", "g++", "cc", "c++", "clang", "clang++", "tcc", "rustc", "ld", "ld.lld", "nvcc", "gfortran", "javac":
		return worstDest(append(flagValues(args, 'o'), flagValues(args, 'd')...), scope, "writes a program outside the agent's folder")
	case "cp", "install":
		// cp -s and cp -l make links: a link inside the folder to a file
		// outside it lets a later write through the folder reach that file.
		if prog == "cp" && hasFlag(args, "sl", "--symbolic-link", "--link") {
			ops := operands(args)
			if len(ops) >= 2 {
				for _, src := range ops[:len(ops)-1] {
					if scope.config(src) {
						return CriticalSettings, "links to a settings file"
					}
					if !scope.inside(src) {
						return CriticalDeleting, "links to a file outside the agent's folder"
					}
				}
			}
		}
	case "trash", "trash-put", "gvfs-trash", "rmtrash", "gio", "kioclient5", "kioclient":
		if prog == "gio" && !oneOf(first, "trash", "remove") {
			return 0, ""
		}
		ops := operands(args)
		if prog == "gio" && len(ops) > 0 {
			ops = ops[1:]
		}
		for _, f := range ops {
			if !scope.insideLink(f) {
				return CriticalDeleting, "moves files outside the agent's folder to the trash"
			}
		}
		return 0, ""

	// The folder's own code.
	case "make", "gmake", "ninja", "rake", "just", "mvn", "mvnw", "gradle", "gradlew", "ant", "bazel", "bazelisk", "meson",
		"pytest", "py.test", "tox", "nox", "tsx", "ts-node", "ts-node-dev", "vite-node", "nodemon", "jest", "vitest", "mocha", "ctest", "scons":
		if hasFlag(args, "", "--version", "--help") {
			return 0, ""
		}
		if prog != "make" || !oneOf(first, "install") { // make install is item 4 already
			return CriticalDeleting, runnerReason
		}
	case "direnv":
		if oneOf(first, "allow", "exec", "permit", "grant", "reload") {
			return CriticalDeleting, runnerReason
		}
	case "npm":
		if oneOf(first, "run", "run-script", "rum", "urn", "test", "t", "tst", "start", "stop", "restart", "rebuild", "explore", "create", "init", "link", "pack") {
			return CriticalDeleting, runnerReason
		}
		if oneOf(first, "unpublish") {
			return CriticalDeleting, "removes a published package"
		}
	case "pnpm", "yarn":
		if !oneOf(first, "", "help", "list", "ls", "why", "info", "view", "outdated", "audit", "bin", "root", "config", "cache", "licenses", "version", "versions") &&
			!oneOf(first, "install", "i", "add", "ci", "update", "upgrade", "dlx", "exec", "x", "publish", "login") { // those are installs and publishes already
			return CriticalDeleting, runnerReason
		}
	case "go":
		if oneOf(first, "run", "test", "generate", "tool") {
			return CriticalDeleting, runnerReason
		}
	case "cargo":
		if oneOf(first, "run", "r", "test", "t", "bench", "build", "b", "check", "c", "clippy", "doc", "fix", "rustc", "rustdoc", "miri", "nextest", "watch", "make", "xtask") {
			return CriticalDeleting, runnerReason
		}
	case "uv":
		if first == "run" {
			return CriticalDeleting, runnerReason
		}
	case "poetry", "pdm", "rye", "hatch", "pipenv", "pixi", "composer", "bundle", "bundler", "dotnet", "mix", "sbt", "lein", "stack", "cabal":
		if oneOf(first, "run", "run-script", "exec", "test", "watch", "build", "script", "shell") {
			return CriticalDeleting, runnerReason
		}
	case "java":
		if slices.Contains(args, "-jar") || len(operands(args)) > 0 {
			return CriticalDeleting, runnerReason
		}
	case "awk", "gawk", "mawk", "nawk":
		if hasFlag(args, "f", "--file") {
			return CriticalDeleting, scriptReason
		}
		for _, a := range args {
			if strings.Contains(a, "system(") || strings.Contains(a, "| getline") || strings.Contains(a, `|"`) || strings.Contains(a, "| \"") {
				return CriticalDeleting, "runs commands from an awk program"
			}
		}
	case "sed", "gsed":
		if hasFlag(args, "f", "--file") {
			return CriticalDeleting, scriptReason
		}
	case "git":
		rest, _ := gitSubcommandArgs(args)
		ops := operands(rest)
		switch sub(rest, 0) {
		case "stash":
			if len(ops) > 1 && oneOf(strings.ToLower(ops[1]), "drop", "clear") {
				return CriticalDeleting, "discards stashed work"
			}
		case "worktree":
			if len(ops) > 1 && oneOf(strings.ToLower(ops[1]), "remove", "prune") {
				return CriticalDeleting, "removes a work folder"
			}
		case "update-ref":
			if hasFlag(rest, "d", "--delete") {
				return CriticalDeleting, "deletes a branch or tag"
			}
		case "reflog":
			if len(ops) > 1 && oneOf(strings.ToLower(ops[1]), "expire", "delete") {
				return CriticalDeleting, "erases history that could undo changes"
			}
		case "gc":
			for _, a := range rest {
				if strings.HasPrefix(a, "--prune") {
					return CriticalDeleting, "erases history that could undo changes"
				}
			}
		case "prune", "filter-branch", "filter-repo", "replace":
			return CriticalDeleting, "rewrites or erases history"
		case "tag":
			if hasFlag(rest, "d", "--delete") {
				return CriticalDeleting, "deletes a tag"
			}
		case "submodule":
			if len(ops) > 1 && oneOf(strings.ToLower(ops[1]), "deinit") {
				return CriticalDeleting, "removes a submodule"
			}
		case "clone":
			var pos []string
			for i := 1; i < len(rest); i++ {
				a := rest[i]
				if strings.HasPrefix(a, "-") {
					name, _, has := strings.Cut(a, "=")
					if gitCloneValued[name] && !has && i+1 < len(rest) {
						if name == "--separate-git-dir" {
							if item, why := judgeDest(rest[i+1], scope, downloadReason); item != 0 {
								return item, why
							}
						}
						i++
					}
					continue
				}
				pos = append(pos, a)
			}
			dest := "."
			if len(pos) >= 2 {
				dest = pos[1]
			}
			return judgeDest(dest, scope, "clones into a folder outside the agent's folder")
		case "config":
			if hasFlag(rest, "", "--get", "--get-all", "--get-regexp", "--list", "--unset", "--unset-all", "--remove-section", "--rename-section", "--show-origin", "--show-scope") || hasFlag(rest, "l") {
				return 0, ""
			}
			if len(ops) >= 3 || hasFlag(rest, "", "--add", "--replace-all") {
				if len(ops) >= 2 && riskyGitKeys.MatchString(strings.TrimSpace(ops[1])) {
					return CriticalSettings, "changes a git setting that names a program git runs"
				}
			}
		}

	// Deleting subcommands of common tools.
	case "docker", "podman", "nerdctl", "docker-compose", "podman-compose":
		ops := operands(args)
		for i := 0; i < 3 && i < len(ops); i++ {
			if oneOf(strings.ToLower(ops[i]), "rm", "rmi", "kill", "prune", "remove", "down") {
				if i == 0 || oneOf(strings.ToLower(ops[0]), "system", "volume", "container", "image", "network", "builder", "buildx", "compose", "stack", "service", "secret", "config", "context", "plugin", "swarm", "node", "manifest") {
					return CriticalDeleting, "deletes containers, images or volumes"
				}
			}
		}
		if prog == "docker-compose" || prog == "podman-compose" {
			if oneOf(first, "down", "rm", "kill") {
				return CriticalDeleting, "deletes containers"
			}
		}
	case "kubectl", "oc", "microk8s", "k3s", "minikube":
		if oneOf(first, "delete", "drain", "replace", "uninstall", "destroy") {
			return CriticalDeleting, "deletes things on a cluster"
		}
	case "helm", "helmfile":
		if oneOf(first, "uninstall", "delete", "destroy", "rollback") {
			return CriticalDeleting, "removes a deployment"
		}
	case "terraform", "tofu", "terragrunt", "pulumi", "cdk", "cdktf", "serverless", "sls", "sam", "ansible-playbook":
		ops := operands(args)
		for _, o := range ops {
			if oneOf(strings.ToLower(o), "destroy", "rm", "remove", "taint", "untaint", "import") {
				return CriticalDeleting, "destroys infrastructure"
			}
		}
		if hasFlag(args, "", "-destroy", "--destroy") || slices.Contains(args, "-destroy") {
			return CriticalDeleting, "destroys infrastructure"
		}
	case "aws":
		ops := operands(args)
		if first == "s3" || first == "s3api" {
			verb := ""
			if len(ops) > 1 {
				verb = strings.ToLower(ops[1])
			}
			switch {
			case oneOf(verb, "rm", "rb", "delete-object", "delete-objects", "delete-bucket"):
				return CriticalDeleting, "deletes cloud files"
			case oneOf(verb, "cp", "mv", "sync") && len(ops) >= 4:
				last := ops[len(ops)-1]
				if strings.HasPrefix(last, "s3://") {
					return CriticalSendingOut, "uploads files to cloud storage"
				}
				return judgeDest(last, scope, "downloads over a file outside the agent's folder")
			}
		}
		for i := 0; i < 3 && i < len(ops); i++ {
			if i > 0 && deleteWord.MatchString(ops[i]) {
				return CriticalDeleting, "deletes things on a cloud account"
			}
		}
	case "gsutil", "gcloud-storage":
		ops := operands(args)
		if len(ops) >= 1 {
			switch strings.ToLower(ops[0]) {
			case "rm", "rb":
				return CriticalDeleting, "deletes cloud files"
			case "cp", "mv", "rsync":
				if last := ops[len(ops)-1]; strings.HasPrefix(last, "gs://") || strings.HasPrefix(last, "s3://") {
					return CriticalSendingOut, "uploads files to cloud storage"
				}
			}
		}
	case "rclone":
		ops := operands(args)
		if len(ops) >= 1 {
			switch strings.ToLower(ops[0]) {
			case "delete", "deletefile", "purge", "rmdir", "rmdirs", "cleanup", "dedupe":
				return CriticalDeleting, "deletes cloud files"
			case "copy", "copyto", "sync", "move", "moveto", "bisync", "copyurl":
				if len(ops) >= 3 && remoteSpec(ops[len(ops)-1]) {
					return CriticalSendingOut, "uploads files to cloud storage"
				}
			}
		}
	case "azcopy":
		if oneOf(first, "copy", "cp", "sync") {
			return CriticalSendingOut, "uploads files to cloud storage"
		}
		if oneOf(first, "remove", "rm") {
			return CriticalDeleting, "deletes cloud files"
		}
	case "pkill", "killall", "kill", "skill", "xkill", "taskkill", "killall5", "pkill-u":
		return CriticalDeleting, killReason
	case "redis-cli", "valkey-cli", "keydb-cli":
		for _, a := range operands(args) {
			if oneOf(strings.ToLower(a), "flushall", "flushdb", "del", "unlink", "shutdown") {
				return CriticalDeleting, "deletes database data"
			}
		}
	}
	if cloudCLIs[prog] {
		ops := operands(args)
		for i := 0; i < 4 && i < len(ops); i++ {
			if deleteWord.MatchString(ops[i]) {
				return CriticalDeleting, "deletes things on a cloud account"
			}
		}
		for i := 0; i < 4 && i < len(ops); i++ {
			if strings.HasPrefix(strings.ToLower(ops[i]), "upload") {
				return CriticalSendingOut, "uploads files to a service"
			}
		}
	}
	return 0, ""
}

// worstDest is the most critical of several destinations.
func worstDest(dests []string, scope HostScope, reason string) (int, string) {
	best, why := 0, ""
	for _, d := range dests {
		if item, r := judgeDest(d, scope, reason); item != 0 && (best == 0 || item < best) {
			best, why = item, r
		}
	}
	return best, why
}

// ReachesNetwork reports whether a terminal or code call fetches from the
// network: a URL in the command or the program, curl, wget, ssh, git clone or
// pull, a package manager's install or download, or program text that opens a
// connection. host is the first address named, when there is one. What such a
// call prints is outside content, whatever tool printed it.
func ReachesNetwork(h HostAction) (host string, ok bool) {
	if h.Kind != HostTerminal {
		return "", false
	}
	if u := urlPattern.FindString(h.Command); u != "" {
		return hostOf(u), true
	}
	if codeNetwork.MatchString(h.Command) {
		return "", true
	}
	if h.Code {
		return "", false
	}
	return "", networkCommand(h.Command, 0)
}

// codeNetwork is program text that opens a connection.
var codeNetwork = regexp.MustCompile(`(?i)\b(?:urllib|requests\.(?:get|post|put|request|session)|httpx|aiohttp|http\.client|urlopen|urlretrieve|socket\.(?:socket|create_connection)|XMLHttpRequest|axios|node-fetch|Net::HTTP|open-uri|curl_exec|file_get_contents\(\s*["']https?)\b|\bfetch\(\s*["'\x60]|\bhttp\.get\(|net/http|\bimport\s+(?:requests|urllib|httpx|aiohttp)\b`)

func networkCommand(line string, depth int) bool {
	if depth > floorDepth {
		return false
	}
	for _, part := range commandSplit.Split(line, -1) {
		words, _ := unwrapCommand(fields(part))
		if len(words) == 0 {
			continue
		}
		prog := strings.ToLower(path.Base(strings.TrimLeft(words[0], `\`)))
		args := words[1:]
		first := sub(args, 0)
		switch {
		case prog == "eval":
			if networkCommand(strings.Join(args, " "), depth+1) {
				return true
			}
		case shellPrograms[prog]:
			if payload, ok := shellPayload(args); ok && networkCommand(payload, depth+1) {
				return true
			}
		case oneOf(prog, "curl", "wget", "wget2", "http", "https", "xh", "httpie", "aria2c", "ssh", "scp", "sftp", "ftp", "lftp", "nc", "ncat", "netcat", "socat", "telnet", "mosh",
			"yt-dlp", "youtube-dl", "gallery-dl", "ping", "dig", "nslookup", "host", "traceroute", "mtr", "gh", "glab", "aws", "gcloud", "az", "gsutil", "rclone", "azcopy", "heroku", "doctl", "vercel", "netlify", "fly", "flyctl",
			"npx", "bunx", "uvx", "pnpx", "pipx", "hermes"):
			return true
		case prog == "rsync":
			for _, op := range operands(args) {
				if remoteSpec(op) {
					return true
				}
			}
		case prog == "git":
			rest, _ := gitSubcommandArgs(args)
			if oneOf(sub(rest, 0), "clone", "pull", "fetch", "ls-remote", "remote", "submodule", "push", "archive") {
				return true
			}
		case oneOf(prog, "pip", "pip3", "npm", "pnpm", "yarn", "bun", "cargo", "go", "uv", "poetry", "pdm", "conda", "mamba", "micromamba", "gem", "composer", "brew", "apt", "apt-get", "dnf", "yum", "pacman", "docker", "podman", "snap", "flatpak"):
			if oneOf(first, "install", "i", "add", "get", "update", "upgrade", "download", "fetch", "pull", "ci", "dlx", "sync", "search", "view", "info", "outdated", "audit", "publish", "mod", "-s", "-sy", "-syu", "build", "run") {
				return true
			}
		}
	}
	return false
}
