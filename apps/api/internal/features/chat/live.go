package chat

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/stdlib"
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
	wait := time.Second
	for {
		err := s.listen(ctx)
		if ctx.Err() != nil {
			return
		}
		log.Printf("chat changes: %v; listening again in %s", err, wait)
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = min(wait*2, 30*time.Second)
	}
}

type change struct {
	Schema string `json:"schema"`
	User   string `json:"user"`
	ID     string `json:"id"`
}

func (s *Service) listen(ctx context.Context) error {
	pool, err := s.db.DB()
	if err != nil {
		return err
	}
	conn, err := pool.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	return conn.Raw(func(dc any) error {
		std, ok := dc.(*stdlib.Conn)
		if !ok {
			return fmt.Errorf("unexpected driver connection %T", dc)
		}
		pg := std.Conn()
		var schema string
		if err := pg.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
			return err
		}
		if _, err := pg.Exec(ctx, "LISTEN timely_chats"); err != nil {
			return err
		}
		for {
			n, err := pg.WaitForNotification(ctx)
			if err != nil {
				// Never hand a listening connection back to the pool.
				return errors.Join(err, driver.ErrBadConn)
			}
			var ch change
			if json.Unmarshal([]byte(n.Payload), &ch) != nil || ch.Schema != schema {
				continue
			}
			s.live.Publish(ch.User, watchKey, realtime.Event{Type: "changed", Kind: "chat", ID: ch.ID})
		}
	})
}
