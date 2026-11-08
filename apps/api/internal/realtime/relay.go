package realtime

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/gorm"
)

// RelayPG passes on a database change channel to hub until ctx ends. Each
// notice is JSON {schema, user, id}, sent by a trigger; notices from another
// schema (an API with its own DB_SCHEMA on the same database) are skipped.
// Every API process on the database sends them, so a write made by another
// process (a check on a worker lane, a chat run another process claimed)
// still reaches this one's streams. A lost connection is retried after 1 s,
// doubling up to 30 s.
func RelayPG(ctx context.Context, db *gorm.DB, hub *Hub, channel, topic, kind string) {
	wait := time.Second
	for {
		err := listenPG(ctx, db, hub, channel, topic, kind)
		if ctx.Err() != nil {
			return
		}
		log.Printf("%s: %v; listening again in %s", channel, err, wait)
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = min(wait*2, 30*time.Second)
	}
}

type pgChange struct {
	Schema string `json:"schema"`
	User   string `json:"user"`
	ID     string `json:"id"`
}

func listenPG(ctx context.Context, db *gorm.DB, hub *Hub, channel, topic, kind string) error {
	pool, err := db.DB()
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
		if _, err := pg.Exec(ctx, "LISTEN "+pgx.Identifier{channel}.Sanitize()); err != nil {
			return err
		}
		for {
			n, err := pg.WaitForNotification(ctx)
			if err != nil {
				// Never hand a listening connection back to the pool.
				return errors.Join(err, driver.ErrBadConn)
			}
			var ch pgChange
			if json.Unmarshal([]byte(n.Payload), &ch) != nil || ch.Schema != schema || ch.User == "" {
				continue
			}
			hub.Publish(ch.User, topic, Event{Type: "changed", Kind: kind, ID: ch.ID})
		}
	})
}
