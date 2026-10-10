package agent

import "context"

// Clients the in-app chat runs for. Saved task views differ per client: the
// phone keeps its own views (config.mobileTaskViews, list and board only)
// apart from the web and desktop ones.
const (
	ClientPhone = "phone"
	ClientWeb   = "web"
)

type clientKey struct{}

// NormalizeClient keeps "phone"; anything else is the web (and desktop) app.
func NormalizeClient(name string) string {
	if name == ClientPhone {
		return ClientPhone
	}
	return ClientWeb
}

// WithClient records which app sent the chat message the run answers. MCP
// requests from external clients carry none and act like the web app.
func WithClient(ctx context.Context, name string) context.Context {
	return context.WithValue(ctx, clientKey{}, NormalizeClient(name))
}

// ClientFrom returns the client set by WithClient, or ClientWeb.
func ClientFrom(ctx context.Context) string {
	name, _ := ctx.Value(clientKey{}).(string)
	return NormalizeClient(name)
}
