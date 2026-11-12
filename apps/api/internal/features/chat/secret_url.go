package chat

import (
	"regexp"
	"strings"
)

// secretPrefixes are the shapes of API keys and tokens Hermes refuses in a
// web_extract URL (agent/redact.py _PREFIX_PATTERNS, through _PREFIX_RE in
// tools/web_tools_extract.py _validate_extract_urls), copied from the
// vendored Hermes. TestSecretPrefixesMatchHermes fails when a Hermes sync
// changes that list, so the two never drift apart.
var secretPrefixes = []string{
	`sk-[A-Za-z0-9_-](?:\.?[A-Za-z0-9_-]){9,}`,
	`ctx7sk-[A-Za-z0-9_-]{10,}`,
	`ghp_[A-Za-z0-9]{10,}`,
	`github_pat_[A-Za-z0-9_]{10,}`,
	`gho_[A-Za-z0-9]{10,}`,
	`ghu_[A-Za-z0-9]{10,}`,
	`ghs_[A-Za-z0-9]{10,}`,
	`ghr_[A-Za-z0-9]{10,}`,
	`xapp-\d+-[A-Za-z0-9-]{10,}`,
	`xox[baprs]-[A-Za-z0-9-]{10,}`,
	`AIza[A-Za-z0-9_-]{30,}`,
	`pplx-[A-Za-z0-9]{10,}`,
	`fal_[A-Za-z0-9_-]{10,}`,
	`fc-[A-Za-z0-9]{10,}`,
	`bb_live_[A-Za-z0-9_-]{10,}`,
	`gAAAA[A-Za-z0-9_=-]{20,}`,
	`AKIA[A-Z0-9]{16}`,
	`sk_live_[A-Za-z0-9]{10,}`,
	`sk_test_[A-Za-z0-9]{10,}`,
	`rk_live_[A-Za-z0-9]{10,}`,
	`SG\.[A-Za-z0-9_-]{10,}`,
	`hf_[A-Za-z0-9]{10,}`,
	`r8_[A-Za-z0-9]{10,}`,
	`npm_[A-Za-z0-9]{10,}`,
	`pypi-[A-Za-z0-9_-]{10,}`,
	`dop_v1_[A-Za-z0-9]{10,}`,
	`doo_v1_[A-Za-z0-9]{10,}`,
	`am_(?:org_)?[A-Za-z0-9]{20,}`,
	`sk_[A-Za-z0-9_]{10,}`,
	`tvly-[A-Za-z0-9]{10,}`,
	`exa_[A-Za-z0-9]{10,}`,
	`gsk_[A-Za-z0-9]{10,}`,
	`syt_[A-Za-z0-9]{10,}`,
	`retaindb_[A-Za-z0-9]{10,}`,
	`hsk-[A-Za-z0-9]{10,}`,
	`mem0_[A-Za-z0-9]{10,}`,
	`brv_[A-Za-z0-9]{10,}`,
	`xai-[A-Za-z0-9]{30,}`,
	`ntn_[A-Za-z0-9]{10,}`,
	`fw-[A-Za-z0-9]{30,}`,
	`fw_[A-Za-z0-9]{30,}`,
	`fpk_[A-Za-z0-9]{30,}`,
	`glpat-[A-Za-z0-9_\-]{10,}`,
	`gloas-[A-Za-z0-9_\-]{10,}`,
	`gldt-[A-Za-z0-9_\-]{10,}`,
	`glrt-[A-Za-z0-9_.\-]{10,}`,
	`glrtr-[A-Za-z0-9_.\-]{10,}`,
	`glcbt-[A-Za-z0-9_\-]{10,}`,
	`glptt-[A-Za-z0-9_\-]{10,}`,
	`glft-[A-Za-z0-9_\-]{10,}`,
	`glimt-[A-Za-z0-9_\-]{10,}`,
	`glagent-[A-Za-z0-9_\-]{10,}`,
	`glsoat-[A-Za-z0-9_\-]{10,}`,
	`glffct-[A-Za-z0-9_\-]{10,}`,
	`glwt-[A-Za-z0-9_\-]{10,}`,
	`GR1348941[A-Za-z0-9_\-]{10,}`,
	`pk-lf-[A-Za-z0-9\-]{8,}`,
}

// secretInURL is Hermes' _PREFIX_RE: a known prefix and its token body, not
// glued to a longer word on either side. Hermes writes the edges as a
// lookbehind and a lookahead, which RE2 has not; matching the edge
// character instead finds a token exactly when Hermes does.
var secretInURL = regexp.MustCompile(`(?:^|[^A-Za-z0-9_-])(?:` + strings.Join(secretPrefixes, "|") + `)(?:[^A-Za-z0-9_-]|$)`)

// carriesSecret is whether a URL, as written or with its percent escapes
// decoded, holds what looks like an API key or token: Hermes refuses such a
// web_extract before any backend is asked, and preview_bot, which Go fetches
// the moment the model calls it, refuses it the same way.
func carriesSecret(raw string) bool {
	return secretInURL.MatchString(raw) || secretInURL.MatchString(unquote(raw))
}

// unquote decodes every valid %XX escape and keeps anything else as it is,
// as Python's urllib.parse.unquote does ("+" stays "+"), so a malformed
// escape elsewhere cannot hide an encoded token.
func unquote(s string) string {
	if !strings.Contains(s, "%") {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '%' && i+2 < len(s) && isHex(s[i+1]) && isHex(s[i+2]) {
			b.WriteByte(unhex(s[i+1])<<4 | unhex(s[i+2]))
			i += 2
			continue
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

func isHex(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F'
}

func unhex(c byte) byte {
	switch {
	case c >= 'a':
		return c - 'a' + 10
	case c >= 'A':
		return c - 'A' + 10
	}
	return c - '0'
}
