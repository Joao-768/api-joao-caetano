-- The original V1 schema, kept verbatim so that:
--   * a fresh database is built by replaying history (001 then 002), and
--   * an existing V1 database, created by hand from the old schema.sql,
--     is adopted as-is (every statement is IF NOT EXISTS).
--
-- V1 modelled a workflow as exactly one trigger, one optional condition and
-- one action. Migration 002 converts that into the graph model.

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflows (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    trigger_type VARCHAR(50) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    action_config JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    conditions JSONB
);

CREATE TABLE IF NOT EXISTS executions (
    id SERIAL PRIMARY KEY,
    workflow_id INT REFERENCES workflows(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'skipped', 'failed')),
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    event_data JSONB,
    result JSONB
);
