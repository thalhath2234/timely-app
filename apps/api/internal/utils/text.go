package utils

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// ClipUTF8 cuts s to at most n bytes without splitting a character and adds
// "…" when anything was cut. n <= 0 leaves s as it is.
func ClipUTF8(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	end := n
	for end > 0 && !utf8.RuneStart(s[end]) {
		end--
	}
	return s[:end] + "…"
}

var (
	secretKey   = regexp.MustCompile(`\b(sk|pk|rk)-[A-Za-z0-9][A-Za-z0-9_\-]{7,}`)
	bearerToken = regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._~+/\-]{8,}=*`)
)

// RedactSecrets hides API keys and bearer tokens in outside text, such as a
// provider's error message that quotes the key it refused, before the text is
// saved or shown.
func RedactSecrets(s string) string {
	s = secretKey.ReplaceAllString(s, "$1-…")
	return bearerToken.ReplaceAllString(s, "Bearer …")
}

// StorableText makes outside text, such as a provider's error message, safe
// to save in a Postgres text or jsonb column: Postgres rejects invalid UTF-8
// and NUL characters, so both are dropped, and the result is clipped to n
// bytes on a character boundary (see ClipUTF8).
func StorableText(s string, n int) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	s = strings.ReplaceAll(s, "\x00", "")
	return ClipUTF8(s, n)
}
