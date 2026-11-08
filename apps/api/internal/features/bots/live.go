package bots

import (
	"context"

	"github.com/labstack/echo/v5"
	"timely-api/internal/realtime"
)

// liveTopic is the Hub topic for all of one person's Bots. Chat streams use
// their own topic, so a bot change never reaches them.
const liveTopic = "bots"

// SetLive turns on GET /bots/watch. Relay feeds it.
func (s *Service) SetLive(live *realtime.Hub) { s.live = live }

// Relay passes on the database's bot change notices (the triggers on bots,
// bot_watches, bot_alerts and bot_lessons) to the live streams until ctx
// ends. Checks run on worker lanes in any API process on this database, so
// the notices, not this process's own writes, are what the streams follow.
func (s *Service) Relay(ctx context.Context) {
	if s.live == nil {
		return
	}
	realtime.RelayPG(ctx, s.db, s.live, "timely_bots", liveTopic, "bot")
}

// watch streams a "changed" event, with the Bot's id, whenever one of the
// person's Bots, its watches, alerts or lessons is written: a check claimed
// or saved, an alert, an edit. Clients refetch on it and keep a slow poll in
// case the stream drops.
func (s *Service) watch(c *echo.Context) error {
	uid := user(c)
	if uid == "" {
		return echo.NewHTTPError(401, "Sign in to use Bots")
	}
	if s.live == nil {
		return echo.NewHTTPError(503, "realtime unavailable")
	}
	events, cancel := s.live.Subscribe(uid, liveTopic)
	defer cancel()
	realtime.Stream(c.Request().Context(), c.Response(), realtime.Event{Type: "hello", Kind: "bot"}, events)
	return nil
}
