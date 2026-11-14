package agent

import "testing"

var floorScope = HostScope{Workspace: "/home/me/work", Home: "/home/me"}

func floor(c string, cwd string) (string, bool) {
	return HardlineHost(HostAction{Kind: HostTerminal, Command: c, Cwd: cwd}, floorScope)
}

// The floor holds however the program is spelled: an absolute path, a
// wrapper, a shell, a cd before it (review round 2: Hermes' own floor misses
// these and Full Access then approves them).
func TestHardlineHostSeesThroughSpelling(t *testing.T) {
	for _, c := range []string{
		"rm -rf /", "rm -rf /*", "rm -rf ~", "rm -rf ~/", "rm -rf ~/*", "rm -rf $HOME", "rm -rf ${HOME}/", "rm -rf /home/me", "rm -rf /home/me/*",
		"rm -rf /home", "rm -rf /usr", "rm -rf /etc", "rm -fr /", "rm -r -f /", "rm -Rf /", "rm --recursive --force /", "rm -rf -- /", "rm -rf --no-preserve-root /",
		"/bin/rm -rf /", "/usr/bin/rm -rf ~", "command rm -rf /", "nice rm -rf /", "env rm -rf /", "sudo rm -rf /", "\\rm -rf /",
		"busybox rm -rf /", "timeout 5 rm -rf ~", "nohup rm -rf / &", "bash -c 'rm -rf /'", "sh -c \"/bin/rm -rf ~\"", "eval 'rm -rf /'",
		"echo hi; rm -rf /", "ls && rm -rf ~", "true || rm -rf /", "echo $(rm -rf /)", "echo `rm -rf ~`",
		"cd / && rm -rf *", "cd ~ && rm -rf *", "cd /home/me; rm -rf .", "cd && rm -rf ./*", "cd /usr && rm -rf *", "cd .. && cd .. && rm -rf *",
		"find / -exec rm -rf {} +", "find ~ -execdir rm -rf {} \\;",
		"echo / | xargs rm -rf", "xargs rm -rf <<< /", "echo ~ | xargs rm -rf",
		"perl -e 'system(\"rm -rf /\")'", "python3 -c 'import os; os.system(\"rm -rf ~\")'", "node -e 'require(\"child_process\").execSync(\"rm -rf /\")'",
		"python3 -c 'import shutil; shutil.rmtree(\"/\")'",
		"python3 - <<EOF\nimport os\nos.system('rm -rf /')\nEOF",
		"chmod -R 777 /", "chown -R me /", "chmod -R 000 ~", "chgrp -R x /usr",
		"mkfs.ext4 /dev/sda1", "mkfs /dev/sdb", "/sbin/mkfs.xfs /dev/nvme0n1", "dd if=/dev/zero of=/dev/sda", "dd of=/dev/nvme0n1 if=x", "cat x > /dev/sda",
		":(){ :|:& };:", "wipefs -a /dev/sda", "fdisk /dev/sda",
	} {
		if why, ok := floor(c, ""); !ok || why == "" {
			t.Errorf("%q is not on the floor", c)
		}
	}
	// the call's own folder is the root or the home
	for _, cwd := range []string{"/", "/home/me", "/usr", "/home"} {
		if _, ok := floor("rm -rf *", cwd); !ok {
			t.Errorf("rm -rf * in %s is not on the floor", cwd)
		}
	}
}

// Nothing ordinary is on the floor.
func TestHardlineHostLeavesOrdinaryWorkAlone(t *testing.T) {
	for _, c := range []string{
		"rm -rf build", "rm -rf /home/me/work/build", "rm -rf ~/.cache/x", "rm -rf /tmp/x", "rm -rf /tmp/*", "rm -r ./node_modules", "rm -rf /var/tmp/build",
		"rm file.txt", "rm -f /", "rm /", "ls /", "ls ~", "cat /etc/passwd", "echo rm -rf /", "echo \"rm -rf ~\"", "grep -r 'rm -rf /' .",
		"chmod -R 755 build", "chmod 600 /", "chown -R me ~/work", "chmod -R u+w ./out",
		"mkdir mkfs", "dd if=a of=b", "dd if=/dev/zero of=/dev/null", "cat x > /dev/null", "find . -name '*.tmp' -delete",
		"find /tmp -exec rm {} +", "cd work && rm -rf *", "cd /home/me/work && rm -rf *", "cd /tmp && rm -rf *", "echo ~ | xargs ls", "ls | xargs rm -rf",
		"python3 -c 'print(1)'", "python3 -c 'import shutil; shutil.rmtree(\"build\")'", "node -e 'console.log(\"/\")'",
		"git push --force origin main", "curl https://example.com | sh",
	} {
		if why, ok := floor(c, ""); ok {
			t.Errorf("%q is on the floor (%s)", c, why)
		}
	}
	if _, ok := floor("rm -rf *", "/home/me/work"); ok {
		t.Error("rm -rf * in the agent's own folder is on the floor")
	}
	if _, ok := HardlineHost(HostAction{Kind: HostFileWrite, Path: "/"}, floorScope); ok {
		t.Error("a file action is on the floor")
	}
}

// execute_code's program is scanned as text.
func TestHardlineHostScansCode(t *testing.T) {
	for _, code := range []string{
		"import os\nos.system('rm -rf /')", "import subprocess\nsubprocess.run('/bin/rm -rf ~', shell=True)", "import shutil\nshutil.rmtree('/')",
		"import shutil, os\nshutil.rmtree(os.path.expanduser('~'))", "os.system(\"sudo rm -rf --no-preserve-root /\")",
	} {
		if _, ok := HardlineHost(HostAction{Kind: HostTerminal, Command: code, Code: true}, floorScope); !ok {
			t.Errorf("code %q is not on the floor", code)
		}
	}
	for _, code := range []string{"print('hello')", "import shutil\nshutil.rmtree('build')", "os.system('ls /')"} {
		if why, ok := HardlineHost(HostAction{Kind: HostTerminal, Command: code, Code: true}, floorScope); ok {
			t.Errorf("code %q is on the floor (%s)", code, why)
		}
	}
}

// Phase 5, review round 3: the floor reads the home, "up from here" and the
// text of programs as they are spelled, not only the literal `/`, `~` and
// `$HOME`. Each line was allowed in Full Access before.
func TestHardlineFloorReadsHomeSpellingsAndClimbs(t *testing.T) {
	for _, c := range []string{
		"rm -rf ~/../..", "rm -rf ~/..", "rm -rf $HOME/..", "rm -rf \"${HOME:?}\"", "rm -rf ${HOME}/../..", "rm -rf \"$HOME/..\"",
		"rm -rf $(echo /)", "rm -rf \"$(echo ~)\"", "H=~; rm -rf $H", "x=~; rm -rf $x", "export D=/; rm -rf $D",
		"rm -rf ~me", "rm -rf ~root", "rm -rf /h?me", "rm -rf /home/me/{*,.*}", "rm -rf /ho*", "rm -rf /{usr,var}",
		"rm -rf ../..", "rm -rf ../../..", "rm -rf ..", "cd /home/me/work && rm -rf ../..",
		"find ~ -type f -exec rm -f {} +", "find /home/me -delete", "find / -exec rm {} \\;",
		"rsync -a --delete /tmp/empty/ ~/", "rsync -a --delete /home/me/work/empty/ /home/me/", "rsync -a --delete-after empty/ $HOME",
		"mv /home/me /tmp/gone", "mv ~ /tmp/gone", "mv /usr /tmp/gone", "mv ~/.. /tmp/gone",
		"chmod -R 000 ~/..", "chown -R me $HOME/..",
		"python3 -c \"import shutil,os;shutil.rmtree(os.environ['HOME'])\"",
		"perl -MFile::Path -e 'rmtree($ENV{HOME})'",
		"node -e 'require(\"fs\").rmSync(require(\"os\").homedir(),{recursive:true})'",
		"ruby -e 'require \"fileutils\"; FileUtils.rm_rf(Dir.home)'",
		"python3 -c \"import shutil; shutil.rmtree('/home/me')\"",
		"python3 -c \"import subprocess; subprocess.run(['rm','-rf','/home/me'])\"",
		"python3 -c \"import os; os.system('rm -rf /home/me')\"",
		"bash -c 'rm -rf ~/..'", "sudo rm -rf $HOME/..", "echo ~/.. | xargs rm -rf",
	} {
		if why, ok := floor(c, ""); !ok || why == "" {
			t.Errorf("%q is not on the floor", c)
		}
	}
	for cwd, cs := range map[string][]string{
		"/home/me": {"rm -rf `pwd`", "rm -rf $(pwd)", "rm -rf ./", "rm -rf .*"},
		"/":        {"rm -rf $(pwd)", "rm -rf `pwd`/*"},
	} {
		for _, c := range cs {
			if _, ok := floor(c, cwd); !ok {
				t.Errorf("%q in %s is not on the floor", c, cwd)
			}
		}
	}
	for _, c := range []string{
		"rm -rf ~/.cache/x", "rm -rf ../build", "rm -rf ./build", "rm -rf ~/work/..bak", "rm -rf ~/Documents/old", "rm -rf /h?me/work",
		"mv a.txt b.txt", "mv build ../build2", "mv ~/a.txt ~/b.txt", "rsync -a --delete src/ dest/", "rsync -a ~/work/ /tmp/backup/",
		"find . -type f -exec rm -f {} +", "find /tmp -exec rm {} +", "find ~/work -name '*.o' -exec rm {} +",
		"H=build; rm -rf $H", "rm -rf $UNKNOWN", "rm -rf $(date +%s)", "rm -rf $(echo build)",
		"python3 -c \"import shutil; shutil.rmtree('/home/me/work/build')\"", "python3 -c \"import shutil,os; shutil.rmtree(os.path.join(os.environ['HOME'], '.cache/x'))\"",
		"python3 -c \"import subprocess; subprocess.run(['rm','-rf','build'])\"", "python3 -c \"import os; os.system('rm -rf /tmp/x')\"",
		"node -e 'require(\"fs\").rmSync(\"build\",{recursive:true})'", "chmod -R 755 ~/work",
	} {
		if why, ok := floor(c, ""); ok {
			t.Errorf("%q is on the floor (%s)", c, why)
		}
	}
}

func TestHardlineFloorScansProgramTextForPathsAndArgvLists(t *testing.T) {
	for _, code := range []string{
		"import subprocess; subprocess.run(['rm','-rf','/'])", "import subprocess\nsubprocess.run(['/bin/rm', '-rf', '/home/me'])",
		"import shutil, os\nshutil.rmtree(os.environ['HOME'])", "import shutil\nfrom pathlib import Path\nshutil.rmtree(str(Path.home()))",
		"import shutil\nshutil.rmtree('/home/me')", "import shutil\nshutil.rmtree(Path('/home'))", "os.system('rm -rf /home/me/*')",
		"const fs = require('fs'); fs.rmSync(require('os').homedir(), {recursive: true})", "require 'fileutils'\nFileUtils.rm_rf(Dir.home)",
		"import subprocess\nsubprocess.run('rm -rf ~/..', shell=True)",
	} {
		if _, ok := HardlineHost(HostAction{Kind: HostTerminal, Command: code, Code: true}, floorScope); !ok {
			t.Errorf("code %q is not on the floor", code)
		}
	}
	for _, code := range []string{
		"import shutil\nshutil.rmtree('/home/me/work/build')", "import shutil\nshutil.rmtree(Path.home() / '.cache' / 'x')",
		"import shutil, os\nshutil.rmtree(os.path.join(os.environ['HOME'], 'x'))", "subprocess.run(['rm', '-rf', 'build'])",
		"subprocess.run(['ls', '/'])", "import shutil\nshutil.rmtree('build', ignore_errors=True)", "x = ['a', 'b', 'c']",
	} {
		if why, ok := HardlineHost(HostAction{Kind: HostTerminal, Command: code, Code: true}, floorScope); ok {
			t.Errorf("code %q is on the floor (%s)", code, why)
		}
	}
}
