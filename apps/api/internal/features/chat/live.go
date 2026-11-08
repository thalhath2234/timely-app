package chat

import (
	"context"

	"github.com/labstack/echo/v5"
	"timely-api/internal/realtime"
)

// watchKey is the Hub topic for all of one person's chats.
const watchKey = "chats"

// SetLive turns on GET /chats/watch. Run then relays chat changes to it.
func (s *Service) SetLive(live *realtime.Hub) { s.live = live }

// watch streams a "changed" event, with the chat's id, whenever one of the
// person's chats is created, changes or is deleted. Clients refetch on it and
// keep a slow poll in case the stream drops.
func (s *Service) watch(c *echo.Context) error {
	uid := user(c)
	if uid == "" {
		return echo.NewHTTPError(401, "Sign in to use chat")
	}
	if s.live == nil {
		return echo.NewHTTPError(503, "realtime unavailable")
	}
	events, cancel := s.live.Subscribe(uid, watchKey)
	defer cancel()
	realtime.Stream(c.Request().Context(), c.Response(), realtime.Event{Type: "hello", Kind: "chat"}, events)
	return nil
}

// relayChanges passes on the database's chat change notices (the
// agent_conversations trigger) until ctx ends. They come from every API
// process on this database, so a run another process claimed still reaches
// this one's streams.
func (s *Service) relayChanges(ctx context.Context) {
	realtime.RelayPG(ctx, s.db, s.live, "timely_chats", watchKey, "chat")
}
