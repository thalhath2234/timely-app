package decide

import (
	"io"
	"net/http"
	"regexp"
	"strings"
)

// readReply reads a provider's reply, at most 1 MB. A refusal's text goes to
// the server log and to Settings → Agent → Test, and some providers quote the
// key they refused, so keys are taken out of it first.
func readReply(res *http.Response, key string) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil || res.StatusCode/100 == 2 {
		return raw, err
	}
	return []byte(hideKeys(string(raw), key)), nil
}

// keyLike matches API keys and bearer tokens in outside text.
var keyLike = regexp.MustCompile(`(?i)\b(?:sk|pk|rk)-[a-z0-9][a-z0-9_\-]{7,}|\bbearer\s+[a-z0-9._~+/\-]{8,}=*`)

// hideKeys takes keys out of text: the one the call sent, whatever its
// shape, and anything that reads like a key or a bearer token.
func hideKeys(text, key string) string {
	if len(key) >= 8 {
		text = strings.ReplaceAll(text, key, "…")
	}
	return keyLike.ReplaceAllString(text, "…")
}
