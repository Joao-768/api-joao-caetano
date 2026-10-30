-- Pulse Monitor initial schema.
-- gen_random_uuid() is built into PostgreSQL 13+.

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT NOT NULL,
    password_hash       TEXT NOT NULL,
    plan                TEXT NOT NULL DEFAULT 'FREE'
                        CHECK (plan IN ('FREE', 'PRO', 'BUSINESS')),
    -- Sessions issued before this moment are rejected (set on password reset).
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_email_format CHECK (email = lower(email) AND position('@' IN email) > 1)
);

CREATE UNIQUE INDEX users_email_unique ON users (email);

CREATE TABLE monitors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    url             TEXT NOT NULL CHECK (char_length(url) <= 2048 AND url ~ '^https?://'),
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'UP', 'DOWN', 'PAUSED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    paused_at       TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    -- Scheduling state. next_check_at doubles as a lease: claiming a monitor
    -- pushes it forward, so a second scheduler instance skips it.
    next_check_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    retry_pending   BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT monitors_user_url_unique UNIQUE (user_id, url),
    CONSTRAINT monitors_paused_consistency CHECK ((status = 'PAUSED') = (paused_at IS NOT NULL))
);

CREATE INDEX monitors_user_idx ON monitors (user_id, created_at);
CREATE INDEX monitors_due_idx ON monitors (next_check_at) WHERE status <> 'PAUSED';

-- Pause intervals, so paused time can be excluded from uptime and downtime
-- for any period, not only the current pause.
CREATE TABLE monitor_pauses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monitor_id UUID NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
    paused_at  TIMESTAMPTZ NOT NULL,
    resumed_at TIMESTAMPTZ,
    CONSTRAINT monitor_pauses_order CHECK (resumed_at IS NULL OR resumed_at >= paused_at)
);

CREATE INDEX monitor_pauses_monitor_idx ON monitor_pauses (monitor_id, paused_at);
CREATE UNIQUE INDEX monitor_pauses_one_open ON monitor_pauses (monitor_id) WHERE resumed_at IS NULL;

CREATE TABLE checks (
    id            BIGSERIAL PRIMARY KEY,
    monitor_id    UUID NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
    status        TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILURE')),
    status_code   INTEGER CHECK (status_code BETWEEN 100 AND 599),
    response_time INTEGER CHECK (response_time >= 0),
    -- Machine-readable failure category (TIMEOUT, DNS, HTTP_5XX, ...).
    error_type    TEXT,
    error_message TEXT,
    is_retry      BOOLEAN NOT NULL DEFAULT false,
    checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT checks_failure_has_reason CHECK (status = 'SUCCESS' OR error_type IS NOT NULL)
);

CREATE INDEX checks_monitor_time_idx ON checks (monitor_id, checked_at DESC);
CREATE INDEX checks_time_idx ON checks (checked_at);

CREATE TABLE incidents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    monitor_id  UUID NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    reason      TEXT NOT NULL,
    -- How the incident ended: a successful check, or the monitor being paused
    -- (we stop observing, so we stop counting downtime).
    resolution  TEXT CHECK (resolution IN ('RECOVERED', 'PAUSED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT incidents_order CHECK (resolved_at IS NULL OR resolved_at >= started_at),
    CONSTRAINT incidents_resolution_consistency CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

CREATE INDEX incidents_monitor_idx ON incidents (monitor_id, started_at DESC);
-- At most one active incident per monitor.
CREATE UNIQUE INDEX incidents_one_active ON incidents (monitor_id) WHERE resolved_at IS NULL;

CREATE TABLE notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    monitor_id UUID REFERENCES monitors (id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('INCIDENT', 'RECOVERY')),
    message    TEXT NOT NULL,
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE NOT is_read;

CREATE TABLE password_reset_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
