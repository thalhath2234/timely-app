-- +goose Up
-- Bots (ADR 0021). bots.next_check_at is the only schedule: the job sweep
-- queues due Bots as bot_check jobs and a check never queues the next one, so
-- a failed job, a restart or a restore cannot stop a Bot. Every account table
-- cascades from users (no accountCleanup entry needed). bot_sites and
-- bot_robots are shared caches with no user_id: per-site spacing and
-- robots.txt hold across processes and accounts, and stay out of backups.
CREATE TABLE bots (
    id TEXT PRIMARY KEY,                                   -- bot_<uuid>
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'chat', 'mcp')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    pause_reason TEXT CHECK (pause_reason IN ('person', 'strikes', 'mcp')),
    judge_mode TEXT NOT NULL DEFAULT 'rules' CHECK (judge_mode IN ('rules', 'ai')),
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 300 AND 604800),
    urgent BOOLEAN NOT NULL DEFAULT false,
    notify_desktop BOOLEAN NOT NULL DEFAULT true,
    notify_phone BOOLEAN NOT NULL DEFAULT true,
    snoozed_until TIMESTAMPTZ,
    next_check_at TIMESTAMPTZ,
    check_started_at TIMESTAMPTZ,
    checking_job_id TEXT,
    last_check_at TIMESTAMPTZ,
    last_ok_at TIMESTAMPTZ,
    strikes INTEGER NOT NULL DEFAULT 0 CHECK (strikes >= 0),
    offline_since TIMESTAMPTZ,
    health TEXT NOT NULL DEFAULT 'new',
    health_detail TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bots_pause_check CHECK ((status = 'paused') = (pause_reason IS NOT NULL)),
    CONSTRAINT bots_schedule_check CHECK ((status = 'active') = (next_check_at IS NOT NULL))
);
CREATE UNIQUE INDEX bots_user_name_idx ON bots (user_id, lower(name));
CREATE INDEX bots_due_idx ON bots (next_check_at) WHERE status = 'active';
CREATE INDEX bots_user_idx ON bots (user_id, created_at);

CREATE TABLE bot_watches (
    id TEXT PRIMARY KEY,                                   -- bw_<uuid>
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL CHECK (kind IN ('page', 'feed', 'price')),
    url TEXT NOT NULL DEFAULT '',
    read_mode TEXT NOT NULL DEFAULT '' CHECK (read_mode IN ('', 'text', 'selector', 'product_price')),
    selector TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',                        -- Go registry (price.Sources); no CHECK so sources can be added
    symbol TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT '',
    rules JSONB NOT NULL DEFAULT '[]',                      -- []bots.Rule
    rule_state JSONB NOT NULL DEFAULT '{}',                 -- map[ruleID]bots.RuleState
    last_reading JSONB,                                     -- bots.Reading, <= 64 KB
    last_reading_at TIMESTAMPTZ,
    baseline_pending BOOLEAN NOT NULL DEFAULT true,         -- next clean reading is recorded quietly
    config_version INTEGER NOT NULL DEFAULT 1,              -- bumped by an edit; an older check's reading is discarded
    etag TEXT NOT NULL DEFAULT '',
    last_modified TEXT NOT NULL DEFAULT '',
    validators_url TEXT NOT NULL DEFAULT '',                -- the URL the validators belong to
    health TEXT NOT NULL DEFAULT 'new',
    health_detail TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT bot_watches_shape_check CHECK (
        (kind = 'page' AND url <> '' AND read_mode <> '' AND source = '' AND (read_mode <> 'selector' OR selector <> ''))
        OR (kind = 'feed' AND url <> '' AND read_mode = '' AND source = '')
        OR (kind = 'price' AND url = '' AND read_mode = '' AND source <> '' AND symbol <> ''))
);
CREATE INDEX bot_watches_bot_idx ON bot_watches (bot_id, position);

CREATE TABLE bot_checks (                                   -- the log: 30 days or the last 500 per Bot; not backed up
    id TEXT PRIMARY KEY,                                   -- bchk_<uuid>
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id TEXT,
    trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'wake', 'run_now')),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('baseline', 'unchanged', 'not_modified', 'changed', 'fired', 'offline', 'rate_limited', 'site_busy', 'robots', 'strike', 'superseded')),
    error_kind TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',                        -- utils.StorableText(utils.RedactSecrets(..), 500)
    watches JSONB NOT NULL DEFAULT '[]',                   -- [{watchId,status,bytes,ms,outcome,errorKind}]
    reading JSONB,                                         -- only on baseline/changed/fired, <= 64 KB in total
    fired JSONB NOT NULL DEFAULT '[]',                     -- [{watchId,ruleId,kind}]
    alert_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_checks_bot_idx ON bot_checks (bot_id, started_at DESC);
CREATE INDEX bot_checks_started_idx ON bot_checks (started_at);

CREATE TABLE bot_alerts (                                   -- survives Clear all (notify/repository.go:132)
    id TEXT PRIMARY KEY,                                   -- bal_<uuid>
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    check_id TEXT REFERENCES bot_checks(id) ON DELETE SET NULL,
    notification_id TEXT,                                  -- no FK: notifications are deletable
    kind TEXT NOT NULL CHECK (kind IN ('alert', 'more', 'paused')),
    held TEXT NOT NULL DEFAULT '' CHECK (held IN ('', 'snoozed', 'cap')),
    local_day DATE NOT NULL,                               -- day in the notification timezone
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',                          -- only ever a watched address
    figures JSONB NOT NULL DEFAULT '{}',
    urgent BOOLEAN NOT NULL DEFAULT false,
    more_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bot_alerts_more_idx ON bot_alerts (bot_id, local_day) WHERE kind = 'more';
CREATE INDEX bot_alerts_bot_day_idx ON bot_alerts (bot_id, local_day);
CREATE INDEX bot_alerts_user_idx ON bot_alerts (user_id, created_at DESC);

CREATE TABLE bot_findings (                                 -- G1 findings board: typed notes, never raw page text
    id TEXT PRIMARY KEY,                                   -- bfd_<uuid>
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    check_id TEXT REFERENCES bot_checks(id) ON DELETE SET NULL,
    watch_id TEXT REFERENCES bot_watches(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('change', 'price', 'item', 'status')),
    title TEXT NOT NULL CHECK (char_length(title) <= 120),
    why TEXT NOT NULL DEFAULT '' CHECK (char_length(why) <= 400),
    url TEXT NOT NULL DEFAULT '',
    price NUMERIC,
    currency TEXT NOT NULL DEFAULT '',
    change_pct NUMERIC,
    urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high')),
    outside_data BOOLEAN NOT NULL DEFAULT true,
    alerted BOOLEAN NOT NULL DEFAULT false,
    digested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_findings_user_idx ON bot_findings (user_id, created_at DESC);
CREATE INDEX bot_findings_bot_idx ON bot_findings (bot_id, created_at DESC);

-- One row per watch per UTC day: 25 Bots at 5 minutes would be ~2.6M point
-- rows a year, past the backup's maxRows (portability/backup.go:21).
CREATE TABLE bot_price_days (
    watch_id TEXT NOT NULL REFERENCES bot_watches(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT '',
    points JSONB NOT NULL DEFAULT '[]',                    -- [[unixSeconds, price], ...] <= 288
    open NUMERIC, high NUMERIC, low NUMERIC, close NUMERIC,
    PRIMARY KEY (watch_id, day)
);
CREATE INDEX bot_price_days_day_idx ON bot_price_days (day);

CREATE TABLE bot_lessons (                                  -- written from branch 4 (teaching); here so backups carry it
    id TEXT PRIMARY KEY,                                   -- bls_<uuid>
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_id TEXT REFERENCES bot_alerts(id) ON DELETE SET NULL,
    text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bot_lessons_bot_idx ON bot_lessons (bot_id, created_at);

CREATE TABLE bot_sites (                                    -- per-site spacing (registrable domain)
    site TEXT PRIMARY KEY,
    next_slot_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX bot_sites_used_idx ON bot_sites (used_at);

CREATE TABLE bot_robots (                                   -- RFC 9309 cache keyed by scheme://host:port
    origin TEXT PRIMARY KEY,
    status INTEGER NOT NULL,
    body TEXT NOT NULL DEFAULT '',                         -- <= 512 KB
    fetched_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- +goose Down
DROP TABLE IF EXISTS bot_robots;
DROP TABLE IF EXISTS bot_sites;
DROP TABLE IF EXISTS bot_lessons;
DROP TABLE IF EXISTS bot_price_days;
DROP TABLE IF EXISTS bot_findings;
DROP TABLE IF EXISTS bot_alerts;
DROP TABLE IF EXISTS bot_checks;
DROP TABLE IF EXISTS bot_watches;
DROP TABLE IF EXISTS bots;
