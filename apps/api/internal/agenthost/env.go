package agenthost

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

// EnvConfig holds the host values that go into every worker's environment.
// Everything else is built per account; nothing is inherited (plan 6.4).
type EnvConfig struct {
	// Path is the worker's PATH. The desktop supervisor passes the login
	// shell's PATH to the API; servers use the API's own.
	Path string
	// Lang and TZ are passed through when set.
	Lang string
	TZ   string
	// RealHome is the OS user's home (HERMES_REAL_HOME). HOME itself is the
	// account's profile home.
	RealHome string
	// BundledSkills is the generated seed tree (HERMES_BUNDLED_SKILLS, plan
	// 9.1); OptionalSkills is HERMES_OPTIONAL_SKILLS. Empty leaves them unset.
	BundledSkills  string
	OptionalSkills string
	// Packaged adds PYTHONDONTWRITEBYTECODE=1 (the packaged runtime is
	// read-only). New sets it whenever Config.Runtime.Packaged is.
	Packaged bool
	// windowsBase is SYSTEMROOT and friends, which CPython needs on Windows
	// to start at all. Filled from the API's environment by envFromHost.
	windowsBase map[string]string
}

// windowsBaseNames are copied from the API's environment on Windows only:
// without SYSTEMROOT CPython cannot seed its random module or open sockets.
// None of them is a secret.
var windowsBaseNames = []string{"SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT"}

// envFromHost fills the host values from the API's own environment.
func envFromHost(getenv func(string) string) EnvConfig {
	home, _ := os.UserHomeDir()
	env := EnvConfig{
		Path:     getenv("PATH"),
		Lang:     getenv("LANG"),
		TZ:       getenv("TZ"),
		RealHome: home,
	}
	if runtime.GOOS == "windows" {
		env.windowsBase = map[string]string{}
		for _, name := range windowsBaseNames {
			if value := getenv(name); value != "" {
				env.windowsBase[name] = value
			}
		}
	}
	return env
}

// keyName is the shape of a tool key's Hermes name (EXA_API_KEY and so on).
var keyName = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)

// A tool key is a credential: its name ends in one of keySuffixes (Hermes'
// OPTIONAL_ENV_VARS name keys that way), or it is one of the few tool
// settings in toolSettingNames. Anything else, such as BASH_ENV,
// NODE_OPTIONS, HTTPS_PROXY or SSL_CERT_FILE, would change how the worker's
// shells, interpreters or TLS behave, so it is refused.
var (
	keySuffixes      = []string{"_API_KEY", "_TOKEN", "_KEY", "_SECRET"}
	toolSettingNames = map[string]bool{
		"BROWSERBASE_PROJECT_ID": true, "FIRECRAWL_API_URL": true, "SEARXNG_URL": true,
	}
)

// toolKeyName reports whether name may carry a tool key.
func toolKeyName(name string) bool {
	if !keyName.MatchString(name) || Denied(name) {
		return false
	}
	if toolSettingNames[name] {
		return true
	}
	for _, suffix := range keySuffixes {
		if strings.HasSuffix(name, suffix) && len(name) > len(suffix) {
			return true
		}
	}
	return false
}

// deniedPrefixes and deniedNames may never reach a worker, whatever the
// caller asks for (plan 6.4): Timely's own secrets, database settings, and
// Hermes or interpreter behaviour switches.
var (
	deniedPrefixes = []string{
		"DB_", "TIMELY_", "API_", "HERMES_", "PYTHON", "LD_", "DYLD_", "XDG_", "TERMINAL_", "GIT_",
		"SSL_", "UV_", "PIP_", "NODE_", "NPM_", "PERL", "RUBY", "GCONV_", "AWS_", "GOOGLE_APPLICATION_",
		// Messaging platforms (decision 6): the worker refuses to start with any of them
		// (apps/agent/timely_agent/env_check.py FORBIDDEN_PREFIXES). make hermes-sync-check
		// fails when a kind: platform manifest reads a name neither list refuses.
		"TELEGRAM_", "DISCORD_", "SLACK_", "WHATSAPP_", "SIGNAL_", "MATRIX_", "MATTERMOST_",
		"FEISHU_", "LARK_", "WECOM_", "WEIXIN_", "DINGTALK_", "TEAMS_", "MSGRAPH_", "TWILIO_",
		"IMESSAGE_", "BLUEBUBBLES_", "PHOTON_", "LINE_", "EMAIL_", "SMTP_", "IMAP_", "QQ_",
		"QQBOT_", "SMS_", "YUANBAO_", "A2A_", "NTFY_", "IRC_", "SIMPLEX_", "BUZZ_", "RAFT_",
		"GOOGLE_CHAT_",
	}
	deniedNames = map[string]bool{
		"JWT_SECRET": true, "DATABASE_URL": true, "PGPASSWORD": true, "PGHOST": true, "PGUSER": true,
		"PGDATABASE": true, "PGPORT": true, "PGSERVICEFILE": true, "PGPASSFILE": true,
		"CORS_ORIGINS": true, "PORT": true, "PATH": true, "HOME": true, "LANG": true, "TZ": true,
		"TMPDIR": true, "TEMP": true, "TMP": true, "USERPROFILE": true, "APPDATA": true, "LOCALAPPDATA": true,
		"SHELL": true, "SSH_AUTH_SOCK": true, "SUDO_ASKPASS": true, "SUDO_PASSWORD": true,
		"BASH_ENV": true, "ENV": true, "PROMPT_COMMAND": true, "BROWSER": true, "EDITOR": true,
		"HTTP_PROXY": true, "HTTPS_PROXY": true, "ALL_PROXY": true, "NO_PROXY": true,
		"http_proxy": true, "https_proxy": true, "all_proxy": true, "no_proxy": true,
		"REQUESTS_CA_BUNDLE": true, "CURL_CA_BUNDLE": true,
	}
)

// Denied reports whether an environment variable must never be set in a
// worker's environment by a tool key. The base variables BuildEnv sets
// itself (PATH, HOME, HERMES_HOME, ...) are in this list too, so a key can
// never override them.
func Denied(name string) bool {
	if deniedNames[name] {
		return true
	}
	for _, prefix := range deniedPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	for _, name2 := range windowsBaseNames {
		if name == name2 {
			return true
		}
	}
	return false
}

// hostEnv is the part of every worker (and helper command) environment that
// does not depend on the account. HOME and TMPDIR point into the agent
// folder; BuildEnv moves them into the account home.
func hostEnv(layout Layout, host EnvConfig) map[string]string {
	env := map[string]string{
		"HOME":                    layout.PrepareHome(),
		"TMPDIR":                  layout.HelperTemp(),
		"HERMES_RUNTIME_DIR":      layout.Runtime(),
		"HERMES_GATEWAY_LOCK_DIR": layout.Locks(),
		"XDG_STATE_HOME":          layout.State(),
		"HERMES_MANAGED_DIR":      layout.Managed(),
		"PYTHONNOUSERSITE":        "1",
	}
	set := func(name, value string) {
		if value != "" {
			env[name] = value
		}
	}
	set("PATH", host.Path)
	set("LANG", host.Lang)
	set("TZ", host.TZ)
	set("HERMES_REAL_HOME", host.RealHome)
	set("HERMES_BUNDLED_SKILLS", host.BundledSkills)
	set("HERMES_OPTIONAL_SKILLS", host.OptionalSkills)
	if host.Packaged {
		env["PYTHONDONTWRITEBYTECODE"] = "1"
	}
	if runtime.GOOS == "windows" {
		// Hermes' Windows bootstrap setdefaults these two once it is imported;
		// set here, the worker's environment is the same before and after
		// the import, as the self-test's env_drift check requires.
		env["PYTHONUTF8"] = "1"
		env["PYTHONIOENCODING"] = "utf-8"
		for _, name := range windowsBaseNames {
			value, ok := host.windowsBase[name]
			if !ok {
				value = os.Getenv(name)
			}
			set(name, value)
		}
		env["USERPROFILE"] = layout.PrepareHome()
		env["APPDATA"] = filepath.Join(layout.PrepareHome(), "AppData", "Roaming")
		env["LOCALAPPDATA"] = filepath.Join(layout.PrepareHome(), "AppData", "Local")
		env["TEMP"] = layout.HelperTemp()
		env["TMP"] = layout.HelperTemp()
	}
	return env
}

// BuildEnv returns a worker's whole environment ("NAME=value" entries,
// sorted). It starts from nothing: no variable of the API's own environment
// is inherited except PATH, LANG and TZ (and the Windows base names on
// Windows), so JWT_SECRET, DB_PASSWORD and TIMELY_BACKUP_KEY never reach the
// worker or its terminal children.
//
// Deliberate differences from the plan's 6.4 list:
//   - HERMES_BUNDLED_LOCALES is not set: the copy keeps only locales/en.yaml
//     at Hermes' default path, and leaving it (and HERMES_LANGUAGE) unset
//     keeps every worker on English (sync-stage locale finding).
//   - On Windows, SYSTEMROOT, SYSTEMDRIVE, WINDIR, COMSPEC and PATHEXT are
//     passed through (CPython needs them), USERPROFILE, APPDATA and
//     LOCALAPPDATA point into the profile home, and TEMP/TMP equal TMPDIR.
func BuildEnv(layout Layout, account string, host EnvConfig, toolKeys map[string]string) ([]string, error) {
	if account == "" {
		return nil, fmt.Errorf("agenthost: no account")
	}
	env := hostEnv(layout, host)
	profile := layout.ProfileHome(account)
	temp := layout.Temp(account)
	env["HERMES_HOME"] = layout.Home(account)
	env["HOME"] = profile
	env["TMPDIR"] = temp
	env["TERMINAL_CWD"] = layout.Workspace(account)
	if runtime.GOOS == "windows" {
		env["USERPROFILE"] = profile
		env["APPDATA"] = filepath.Join(profile, "AppData", "Roaming")
		env["LOCALAPPDATA"] = filepath.Join(profile, "AppData", "Local")
		env["TEMP"] = temp
		env["TMP"] = temp
	}
	for name, value := range toolKeys {
		if !toolKeyName(name) {
			return nil, fmt.Errorf("agenthost: tool key %q is not allowed in a worker environment", name)
		}
		if strings.ContainsRune(value, 0) {
			return nil, fmt.Errorf("agenthost: tool key %q has a NUL byte", name)
		}
		if value != "" {
			env[name] = value
		}
	}
	return envList(env)
}

func envList(env map[string]string) ([]string, error) {
	out := make([]string, 0, len(env))
	for name, value := range env {
		if strings.ContainsRune(value, 0) {
			return nil, fmt.Errorf("agenthost: %s has a NUL byte", name)
		}
		out = append(out, name+"="+value)
	}
	sort.Strings(out)
	return out, nil
}
