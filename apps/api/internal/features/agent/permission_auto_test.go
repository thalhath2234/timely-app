package agent

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// autoFixture is a home with a working folder that is a git repository, and
// the links, secret files and fake repositories the allowlist must see.
type autoFixture struct {
	home, work string
	scope      HostScope
}

func newAutoFixture(t *testing.T) autoFixture {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	home := filepath.Join(root, "home", "me")
	work := filepath.Join(home, "work")
	dirs := []string{
		filepath.Join(home, "Documents"), filepath.Join(home, ".ssh"), filepath.Join(work, "sub"), filepath.Join(work, ".git"),
		filepath.Join(work, "clean"), filepath.Join(work, "inj"), filepath.Join(work, "bare", "objects"), filepath.Join(work, "bare", "refs"),
		filepath.Join(work, "pointer"), filepath.Join(work, "big"),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		filepath.Join(home, ".bashrc"):                "x",
		filepath.Join(home, "notes.txt"):              "x",
		filepath.Join(home, ".ssh", "id_rsa"):         "key",
		filepath.Join(home, "Documents", "thesis.md"): "x",
		filepath.Join(work, "notes.md"):               "TODO",
		filepath.Join(work, "data.csv"):               "a,b",
		filepath.Join(work, ".env"):                   "DB_PASSWORD=x",
		filepath.Join(work, ".env.example"):           "DB_PASSWORD=",
		filepath.Join(work, "server.pem"):             "key",
		filepath.Join(work, ".git", "config"):         "[core]\n\tbare = false\n",
		filepath.Join(work, ".git", "HEAD"):           "ref: refs/heads/main\n",
		filepath.Join(work, "sub", "x.txt"):           "TODO",
		filepath.Join(work, "sub", ".env.local"):      "TOKEN=x",
		filepath.Join(work, "clean", "a.txt"):         "TODO",
		filepath.Join(work, "inj", "--pre=sh"):        "x",
		filepath.Join(work, "bare", "HEAD"):           "ref: refs/heads/main\n",
		filepath.Join(work, "bare", "config"):         "[core]\n\tfsmonitor = sh evil.sh\n",
		filepath.Join(work, "pointer", ".git"):        "gitdir: ../bare\n",
		filepath.Join(work, "big", "placeholder.txt"): "x",
		filepath.Join(work, "clean", "x.txt"):         "x",
	}
	for f, body := range files {
		if err := os.WriteFile(f, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for link, target := range map[string]string{
		filepath.Join(work, "out"):     filepath.Join(home, "Documents"),
		filepath.Join(work, "rc"):      filepath.Join(home, ".bashrc"),
		filepath.Join(work, "up"):      home,
		filepath.Join(work, "inner"):   filepath.Join(work, "notes.md"),
		filepath.Join(work, "keylink"): filepath.Join(home, ".ssh", "id_rsa"),
	} {
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
	}
	return autoFixture{home: home, work: work, scope: HostScope{Workspace: work, Home: home}}
}

func (f autoFixture) safe(t *testing.T, sc HostScope, lines ...string) {
	t.Helper()
	for _, c := range lines {
		if ok, why := AutoSafeCommand(c, sc); !ok {
			t.Errorf("%q asks (%s), want it to run in Auto", c, why)
		}
	}
}

func (f autoFixture) asks(t *testing.T, sc HostScope, lines ...string) {
	t.Helper()
	for _, c := range lines {
		ok, why := AutoSafeCommand(c, sc)
		if ok {
			t.Errorf("%q runs in Auto, want a card", c)
		} else if why == "" {
			t.Errorf("%q asks without saying why", c)
		}
	}
}

// Every entry's allowed forms run without a card.
func TestAutoSafeCommandEveryEntry(t *testing.T) {
	f := newAutoFixture(t)
	f.safe(t, f.scope,
		// ls, pwd, cat, head, tail, wc, file, stat, du, df
		"ls", "ls -la", "ls -la sub", "ls -lh --color=auto sub", "ls sub/*.txt", "ls inner", "pwd", "pwd -P",
		"cat notes.md", "cat -n notes.md sub/x.txt", "cat .env.example", "head -n 5 notes.md", "head -20 notes.md", "head -n5 notes.md", "tail -n +2 notes.md", "tail -3 notes.md",
		"wc -l notes.md", "wc -lw notes.md data.csv", "file notes.md", "file -b --mime-type notes.md", "stat notes.md", "stat -c %s notes.md",
		"du -sh .", "du -sh sub", "du -d 1 -h", "df -h", "df -h .",
		// echo and printf print their words
		"echo hi", "echo -n 'rm -rf ~'", "printf '%s\\n' a b", "echo hi there",
		// grep and rg
		"grep -n TODO notes.md", "grep -rn TODO sub/x.txt", "grep -rn TODO clean", "grep -i -e todo -e fixme notes.md", "grep -c TODO notes.md data.csv",
		"ls | grep notes", "rg TODO clean", "rg -n TODO clean", "rg -i --glob '*.md' TODO clean", "rg --files clean", "rg -l TODO sub/x.txt",
		// find without actions
		"find . -name '*.md'", "find sub -type f -maxdepth 2", "find . -name '*.md' -o -name '*.txt'", "find . ! -name '*.md' -type f", "find", "find . -newer notes.md", "find . -path ./sub -prune -o -print",
		// tree, diff, cmp
		"tree", "tree -L 2 sub", "tree -a -I node_modules", "diff notes.md sub/x.txt", "diff -u notes.md sub/x.txt", "cmp notes.md sub/x.txt",
		// sort, uniq, cut, tr
		"sort notes.md", "sort -rn data.csv | uniq -c", "uniq -c notes.md", "cut -d, -f1 data.csv", "cat notes.md | tr a-z A-Z", "tr -d x",
		// which, type, command -v, date, uname
		"which git", "which -a ls", "type ls", "command -v git", "date", "date +%Y-%m-%d", "date -u", "uname -a", "uname",
		// git read-only subcommands
		"git status", "git status --short", "git status -sb", "git --no-pager log", "git log --oneline -5", "git log -1", "git log -n 3 --stat",
		"git log --format='%h %s' HEAD~3..HEAD", "git log -p -- notes.md", "git diff", "git diff --stat", "git diff --cached", "git diff HEAD~1 -- notes.md",
		"git diff --no-ext-diff --no-textconv", "git show HEAD --stat", "git show HEAD:notes.md", "git branch", "git branch -a", "git branch -vv", "git branch --show-current",
		"git branch --list 'feat*'", "git rev-parse --show-toplevel", "git rev-parse --abbrev-ref HEAD", "git rev-parse HEAD", "git ls-files", "git ls-files sub",
		"git blame notes.md", "git blame -L 1,5 notes.md", "git remote", "git remote -v", "git -C sub status", "git -C clean log --oneline",
		// pipes, lists and a cd inside the folder
		"ls && pwd", "ls; pwd", "ls || pwd", "ls\npwd\n", "cd ./sub && ls", "cd ./sub && cat x.txt | wc -l", "cd ./sub && git status", "ls -la | sort | head -5",
	)
}

// Each shape the six review rounds found, and the classes the owner named,
// asks in Auto.
func TestAutoSafeCommandRefusals(t *testing.T) {
	f := newAutoFixture(t)
	f.asks(t, f.scope,
		// redirections
		"echo x > a.txt", "echo x >> a.txt", "cat < notes.md", "ls 2>/dev/null", "ls &> out.txt", "ls |& cat", "cat <<EOF\nx\nEOF", "cat <<< x", "echo x >| a",
		// command substitution, variables, process substitution
		"echo $(rm -rf ~)", "echo `id`", "cat \"$HOME/.ssh/id_rsa\"", "echo $PATH", "ls ${HOME}", "diff <(ls) <(ls sub)", "echo \"$(whoami)\"", "ls $'\\x2f'",
		// background jobs and subshells
		"ls &", "sleep 1 & ls", "(ls)", "{ ls; }", "ls; (cd /; ls)", "f() { ls; }",
		// environment assignments
		"LD_PRELOAD=/tmp/x.so ls", "PATH=. ls", "GIT_DIR=/tmp/x git status", "PAGER=sh git log", "GIT_EXTERNAL_DIFF=./x git diff", "GIT_CONFIG_GLOBAL=x git log", "FOO+=1 ls",
		// build, test and script runners
		"make", "make test", "npm test", "npm run build", "pnpm run dev", "yarn build", "go test ./...", "go run .", "pytest", "python3 -m pytest", "cargo test", "cargo build",
		"python3 x.py", "python3 -c 'print(1)'", "node x.js", "bash x.sh", "sh x.sh", "./x.sh", "source x.sh", ". ./x.sh", "uv run x.py", "tsx x.ts", "java -jar a.jar", "direnv allow",
		// programs not on the list
		"rm x", "rm -rf build", "mv a b", "cp a b", "ln -s /home/me/.bashrc rc", "chmod -R 777 .", "touch a", "mkdir d", "tar -xf x.tar", "unzip x.zip",
		"curl https://example.com", "wget https://example.com", "psql -c 'select 1'", "echo ok | psql", "sqlite3 a.db 'select 1'", "mysql -e 'select 1'",
		"env", "printenv", "env ls", "jq . a.json", "yq . a.yaml", "sed -n 1p notes.md", "awk '{print}' notes.md", "xargs ls", "ls | xargs cat", "tee x", "ls | tee out",
		"y", "yes", "sudo ls", "nohup ls", "time ls", "timeout 5 ls", "nice ls", "exec ls", "eval ls", "command ls", "builtin cd /", "alias ls=rm", "export PATH=.", "unset PATH",
		"kill -9 1", "pkill x", "docker ps", "kubectl get pods", "terraform plan", "redis-cli get x", "git stash", "gcc x.c -o x", "rename s/a/b/ *", "less notes.md", "vim notes.md",
		"/bin/ls", "./ls", "../bin/ls", "~/bin/ls",
		// git: subcommands and flags that write or run programs
		"git -c core.pager=sh log", "git -c alias.x=!rm status", "git --exec-path=. status", "git --git-dir=/tmp/x status", "git --work-tree=/ status", "git -p log", "git --paginate log",
		"git log --output=x", "git diff --output=/home/me/.bashrc", "git diff --ext-diff", "git log --textconv -p", "git show --show-signature", "git diff -O/tmp/order", "git log -L1,2:notes.md",
		"git config --list", "git config core.pager sh", "git push", "git commit -m x", "git checkout .", "git reset --hard", "git clean -fdx", "git fetch", "git pull", "git grep x",
		"git difftool", "git help log", "git branch -D x", "git branch -d x", "git branch -m a b", "git branch new", "git branch --set-upstream-to=o/m", "git branch -f x HEAD",
		"git remote add x y", "git remote show origin", "git remote set-url origin x", "git tag -d v1", "git", "git -C / status", "git -C .. log", "git -C out status", "git -C ~ status",
		"git log -- ../x", "git show HEAD:.env", "git show HEAD:sub/.env.local", "git diff --no-index notes.md /etc/passwd", "git rev-parse --git-path x",
		// find actions and link following
		"find . -exec rm {} \\;", "find . -exec rm {} +", "find . -execdir rm {} +", "find . -ok rm {} \\;", "find . -okdir rm {} \\;", "find . -delete", "find . -fprint x",
		"find . -fprint0 x", "find . -fprintf x %p", "find . -fls x", "find -L .", "find . -follow", "find -H .", "find / -name x", "find ~ -name x", "find .. -name x", "find out",
		"find . -files0-from x", "find . -name",
		// grep and rg forms that run programs, follow links or read secrets
		"grep -R x .", "grep --dereference-recursive x .", "grep -f /home/me/.ssh/id_rsa notes.md", "grep -rn PASSWORD .", "grep -r TOKEN sub", "grep x .env",
		"rg --pre sh x", "rg --pre=sh x", "rg --pre-glob '*' x", "rg -z x", "rg --search-zip x", "rg -L x", "rg --follow x", "rg --hostname-bin=x x", "rg --hidden PASSWORD",
		"rg -uu PASSWORD", "rg TODO", "rg x inj/*", "grep x -- *",
		// options that write, run or read a list of files
		"sort -o x notes.md", "sort --output=x notes.md", "sort -T /tmp notes.md", "sort --compress-program=sh notes.md", "sort --files0-from=x", "uniq notes.md out.txt",
		"wc --files0-from=x", "du --files0-from=x", "du -L", "tree -o x", "tree -l", "tree -R", "ls -L", "ls --dereference", "ls -R -L", "file -C -m x", "file -z x", "file -m x notes.md",
		"date -s 2020-01-01", "date --set=x", "date 0101", "date -f x", "printf -v PATH x", "tail -f notes.md", "diff -r sub clean", "diff --from-file=x notes.md", "head --lines",
		"cat --no-such-option notes.md", "ls -Z",
		// paths outside the folder, links out of it, secrets
		"cat /etc/passwd", "cat ../notes.txt", "cat ~/notes.txt", "cat ~", "ls ~", "ls /", "ls ..", "ls out", "ls out/", "cat out/thesis.md", "cat rc", "cat keylink", "ls up",
		"head ~/.ssh/id_rsa", "cat .env", "cat sub/.env.local", "cat .git/config", "cat server.pem", "stat /home", "du -sh ~", "cat /proc/self/environ", "cat /home/me/.pgpass",
		"ls a=~/x", "ls x:~/y", "ls ~root", "cat ~me/.bashrc", "diff notes.md ../notes.txt", "cmp notes.md /etc/hosts", "wc -l /etc/passwd", "grep x /etc/passwd",
		// cd that leaves the folder or that the parser can't follow
		"cd .. && ls", "cd / && ls", "cd out && ls", "cd ~ && ls", "cd && ls", "cd - && ls", "cd sub || cat ../../x", "cd sub; cat x.txt", "cd sub | ls", "ls | cd sub && ls",
		"cd sub && ls || cat x.txt", "cd sub ; ls", "cd sub other",
		// odd spellings of rm -rf ~
		"r\\m -rf ~", "\"rm\" -rf ~", "'r''m' -rf ~", "\\rm -rf ~", "ls; rm -rf ~", "ls && rm -rf ~", "ls || rm -rf ~", "ls | rm -rf ~", "ls\nrm -rf ~", "ls\r\nrm -rf ~",
		"ls # ; rm -rf ~", "echo hi;rm -rf ~", "ls\x00rm -rf ~",
		// globs, braces and patterns the shell expands
		"cat **/.env", "cat {a,b}", "cat [a].txt", "cat *", "ls inj/*", "cat .e?v", "ls 'x*'*", "ls \\**", "ls \"?\"*",
		// history expansion
		"!!", "!-1", "^ls^rm", "echo \"!!\"", "ls !$",
		// lines the parser can't read
		"", "   ", ";", "ls;;pwd", "| ls", "ls |", "ls &&", "echo 'x", "echo \"x", "ls \\",
	)
}

// A repository Git would find through a file the agent can write asks: a .git
// file, a bare layout, a commondir or config.worktree pointer, a config that
// includes another file, a repository above the working folder.
func TestAutoSafeCommandGitRepositories(t *testing.T) {
	f := newAutoFixture(t)
	f.asks(t, f.scope, "git -C pointer status", "cd pointer && git log", "git -C bare log", "cd bare && git status", "git -C bare diff")
	write := func(p, body string) {
		t.Helper()
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(f.work, ".git", "commondir"), "../bare\n")
	f.asks(t, f.scope, "git status")
	if err := os.Remove(filepath.Join(f.work, ".git", "commondir")); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(f.work, ".git", "config.worktree"), "[core]\n")
	f.asks(t, f.scope, "git status")
	if err := os.Remove(filepath.Join(f.work, ".git", "config.worktree")); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(f.work, ".git", "config"), "[core]\n[include]\n\tpath = ../extra.cfg\n")
	f.asks(t, f.scope, "git status", "git log")
	write(filepath.Join(f.work, ".git", "config"), "[core]\n")
	f.safe(t, f.scope, "git status")
	// a working folder inside a bigger repository
	inner := filepath.Join(f.home, "proj", "sub")
	if err := os.MkdirAll(inner, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(f.home, "proj", ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	f.asks(t, HostScope{Workspace: inner, Home: f.home}, "git status", "git log")
	// a .git that is a link
	linked := filepath.Join(f.home, "linked")
	if err := os.MkdirAll(linked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(f.work, ".git"), filepath.Join(linked, ".git")); err != nil {
		t.Fatal(err)
	}
	f.asks(t, HostScope{Workspace: linked, Home: f.home}, "git status")
}

// The folder the line runs in: outside the working folder, unknown (text
// typed into a running command), or a working folder that is the home.
func TestAutoSafeCommandFolder(t *testing.T) {
	f := newAutoFixture(t)
	outside := f.scope
	outside.Cwd = f.home
	f.asks(t, outside, "ls", "cat notes.txt", "git status", "find . -name x", "rg x", "tree", "du -sh", "grep -r x")
	f.safe(t, outside, "echo hi", "pwd", "date", "ls "+f.work, "cat "+filepath.Join(f.work, "notes.md"), "echo x | grep x", "find "+f.work+" -name x")
	inSub := f.scope
	inSub.Cwd = filepath.Join(f.work, "sub")
	f.safe(t, inSub, "ls", "cat x.txt", "cat ../notes.md", "git status")
	f.asks(t, inSub, "cat ../../notes.txt", "cat .env.local")
	stdin := f.scope
	stdin.CwdUnknown = true
	f.asks(t, stdin, "ls", "cat notes.md", "y", "yes", "rm -rf ~", "git status", "cd ./sub && ls")
	f.safe(t, stdin, "echo hi", "date", "cat "+filepath.Join(f.work, "notes.md"))
	homeWork := HostScope{Workspace: f.home, Home: f.home}
	f.asks(t, homeWork, "ls", "cat notes.txt", "git status")
	f.safe(t, homeWork, "echo hi", "date")
	// a search over more files than Timely checks first asks
	many := filepath.Join(f.work, "many")
	if err := os.MkdirAll(many, 0o755); err != nil {
		t.Fatal(err)
	}
	for i := range maxWalk + 5 {
		if err := os.WriteFile(filepath.Join(many, "f"+strconv.Itoa(i)), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	f.asks(t, f.scope, "grep -r x many", "rg x many")
	f.safe(t, f.scope, "ls many | wc -l")
}
