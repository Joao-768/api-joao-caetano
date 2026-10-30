-- V2: workflows become graphs, executions become step-by-step traces.
--
-- What this migration does, in order:
--   1. users:       timestamps become TIMESTAMPTZ
--   2. workflows:   add the graph `definition`, version, webhook id, soft delete
--   3.              convert every V1 row (trigger + condition + action) into a
--                   graph:  trigger -> [condition -true->] action
--   4. workflow_versions: immutable snapshot of every saved definition
--   5. executions:  richer lifecycle; stop cascading on workflow delete
--   6. execution_steps: one row per node attempt; V1 results are carried over
--   7. records:     the table the "Create record" node writes into
--
-- Everything runs in one transaction (see src/db/migrate.ts): either the whole
-- conversion succeeds, or the V1 database is left untouched.

-- 1. users ------------------------------------------------------------------

ALTER TABLE users
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz,
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN created_at SET NOT NULL;

-- 2. workflows: new columns -------------------------------------------------

ALTER TABLE workflows
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz,
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN name TYPE TEXT,
    ALTER COLUMN trigger_type TYPE TEXT,
    ALTER COLUMN trigger_type DROP NOT NULL,
    ALTER COLUMN is_active SET DEFAULT false,
    ADD COLUMN definition JSONB,
    ADD COLUMN version INT NOT NULL DEFAULT 1,
    ADD COLUMN trigger_event TEXT,
    ADD COLUMN webhook_id TEXT,
    ADD COLUMN webhook_secret_hash TEXT,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN deleted_at TIMESTAMPTZ;

UPDATE workflows SET is_active = false WHERE is_active IS NULL;
UPDATE workflows SET updated_at = created_at;

-- 3. workflows: convert V1 rows into graphs ---------------------------------
--
-- V1 trigger_type held the event name ("order.created"); V2 trigger_type holds
-- the kind of trigger and the event name moves to trigger_event.
-- V1 operators >, <, == map to gt, lt, equals.

UPDATE workflows w
SET
    trigger_event = w.trigger_type,
    trigger_type = 'event',
    definition = jsonb_build_object(
        'nodes',
        jsonb_build_array(
            jsonb_build_object(
                'id', 'trigger',
                'type', 'trigger',
                'label', 'Trigger',
                'position', jsonb_build_object('x', 0, 'y', 0),
                'config', jsonb_build_object('type', 'event', 'eventName', w.trigger_type)
            ),
            jsonb_build_object(
                'id', 'action',
                'type', CASE w.action_type
                    WHEN 'send_email' THEN 'email'
                    WHEN 'create_record' THEN 'create_record'
                    ELSE 'notification'
                END,
                'label', 'Action',
                'position', jsonb_build_object('x', 0, 'y', CASE WHEN w.conditions IS NULL THEN 160 ELSE 320 END),
                'config', CASE w.action_type
                    WHEN 'send_email' THEN jsonb_build_object(
                        'to', coalesce(w.action_config->>'to', ''),
                        'subject', coalesce(w.action_config->>'subject', ''),
                        'body', ''
                    )
                    WHEN 'create_record' THEN jsonb_build_object(
                        'collection', coalesce(
                            nullif(regexp_replace(lower(coalesce(w.action_config->>'table', '')), '[^a-z0-9_]', '_', 'g'), ''),
                            'records'
                        ),
                        'data', jsonb_build_object('fields', coalesce(w.action_config->>'fields', ''))
                    )
                    ELSE jsonb_build_object(
                        'message', coalesce(w.action_config->>'message', ''),
                        'level', 'info'
                    )
                END
            )
        ) || CASE WHEN w.conditions IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
            jsonb_build_object(
                'id', 'condition',
                'type', 'condition',
                'label', 'Condition',
                'position', jsonb_build_object('x', 0, 'y', 160),
                'config', jsonb_build_object(
                    'path', 'event.' || (w.conditions->>'field'),
                    'operator', CASE w.conditions->>'operator'
                        WHEN '>' THEN 'gt'
                        WHEN '<' THEN 'lt'
                        ELSE 'equals'
                    END,
                    'value', w.conditions->>'value'
                )
            )
        ) END,
        'edges',
        CASE WHEN w.conditions IS NULL THEN jsonb_build_array(
            jsonb_build_object('id', 'e_trigger_action', 'source', 'trigger', 'target', 'action')
        ) ELSE jsonb_build_array(
            jsonb_build_object('id', 'e_trigger_condition', 'source', 'trigger', 'target', 'condition'),
            jsonb_build_object('id', 'e_condition_action', 'source', 'condition', 'target', 'action', 'sourceHandle', 'true')
        ) END
    );

-- Public webhook ids are random, never derived from the numeric id.
UPDATE workflows SET webhook_id = replace(gen_random_uuid()::text, '-', '');

ALTER TABLE workflows
    ALTER COLUMN definition SET NOT NULL,
    ALTER COLUMN webhook_id SET NOT NULL,
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN is_active SET NOT NULL,
    ADD CONSTRAINT workflows_webhook_id_key UNIQUE (webhook_id),
    ADD CONSTRAINT workflows_trigger_type_check
        CHECK (trigger_type IN ('manual', 'event', 'webhook', 'schedule')),
    ADD CONSTRAINT workflows_version_check CHECK (version >= 1),
    DROP COLUMN conditions,
    DROP COLUMN action_type,
    DROP COLUMN action_config;

CREATE INDEX workflows_user_idx ON workflows (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX workflows_event_idx ON workflows (user_id, trigger_event)
    WHERE is_active AND deleted_at IS NULL AND trigger_type = 'event';

-- 4. workflow_versions --------------------------------------------------------
--
-- Every saved definition is kept. An execution points at (workflow, version),
-- so its trace can always be drawn against the graph that actually ran.

CREATE TABLE workflow_versions (
    workflow_id INT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version INT NOT NULL,
    definition JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workflow_id, version)
);

INSERT INTO workflow_versions (workflow_id, version, definition, created_at)
SELECT id, version, definition, created_at FROM workflows;

-- 5. executions ---------------------------------------------------------------

ALTER TABLE executions RENAME COLUMN executed_at TO created_at;
ALTER TABLE executions RENAME COLUMN event_data TO trigger_data;

ALTER TABLE executions
    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz,
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN status TYPE TEXT,
    DROP CONSTRAINT IF EXISTS executions_status_check,
    DROP CONSTRAINT IF EXISTS executions_workflow_id_fkey,
    ADD COLUMN user_id INT REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN workflow_version INT NOT NULL DEFAULT 1,
    ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'event',
    ADD COLUMN current_node_id TEXT,
    ADD COLUMN started_at TIMESTAMPTZ,
    ADD COLUMN finished_at TIMESTAMPTZ,
    ADD COLUMN duration_ms INT,
    ADD COLUMN error JSONB;

UPDATE executions e SET user_id = w.user_id FROM workflows w WHERE w.id = e.workflow_id;
DELETE FROM executions WHERE user_id IS NULL OR workflow_id IS NULL;
UPDATE executions SET started_at = created_at, finished_at = created_at, duration_ms = 0;

-- 6. execution_steps ----------------------------------------------------------

CREATE TABLE execution_steps (
    id BIGSERIAL PRIMARY KEY,
    execution_id INT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    node_type TEXT NOT NULL,
    status TEXT NOT NULL
        CHECK (status IN ('running', 'success', 'failed', 'retrying', 'waiting', 'skipped')),
    attempt INT NOT NULL DEFAULT 1,
    max_attempts INT NOT NULL DEFAULT 1,
    input JSONB,
    output JSONB,
    error JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    duration_ms INT
);

CREATE INDEX execution_steps_execution_idx ON execution_steps (execution_id, id);

-- Carry V1 results over as steps, so old executions still show what happened.
INSERT INTO execution_steps (execution_id, node_id, node_type, status, output, started_at, finished_at, duration_ms)
SELECT id, 'trigger', 'trigger', 'success', trigger_data, created_at, created_at, 0 FROM executions;

INSERT INTO execution_steps (execution_id, node_id, node_type, status, output, error, started_at, finished_at, duration_ms)
SELECT
    e.id,
    'action',
    (SELECT n->>'type' FROM jsonb_array_elements(w.definition->'nodes') n WHERE n->>'id' = 'action'),
    e.status,
    CASE WHEN e.status = 'success' THEN e.result END,
    CASE WHEN e.status = 'failed'
        THEN jsonb_build_object('code', 'action_failed', 'message', coalesce(e.result->>'error', 'Action failed'))
    END,
    e.created_at,
    e.created_at,
    0
FROM executions e
JOIN workflows w ON w.id = e.workflow_id;

-- V1 "skipped" meant "the condition was false": the run itself succeeded.
UPDATE executions
SET error = jsonb_build_object('code', 'action_failed', 'message', coalesce(result->>'error', 'Action failed'), 'nodeId', 'action')
WHERE status = 'failed';
UPDATE executions SET status = 'success' WHERE status = 'skipped';

ALTER TABLE executions
    DROP COLUMN result,
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN workflow_id SET NOT NULL,
    ALTER COLUMN workflow_version DROP DEFAULT,
    ALTER COLUMN trigger_type DROP DEFAULT,
    -- Deleting a workflow is a soft delete, so its history is never cascaded away.
    ADD CONSTRAINT executions_workflow_fkey
        FOREIGN KEY (workflow_id, workflow_version) REFERENCES workflow_versions (workflow_id, version),
    ADD CONSTRAINT executions_status_check
        CHECK (status IN ('queued', 'running', 'waiting', 'success', 'failed')),
    ADD CONSTRAINT executions_trigger_type_check
        CHECK (trigger_type IN ('manual', 'event', 'webhook', 'schedule'));

CREATE INDEX executions_user_created_idx ON executions (user_id, created_at DESC);
CREATE INDEX executions_workflow_created_idx ON executions (workflow_id, created_at DESC);
CREATE INDEX executions_user_status_idx ON executions (user_id, status);

-- 7. records ------------------------------------------------------------------

CREATE TABLE records (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workflow_id INT REFERENCES workflows(id) ON DELETE SET NULL,
    execution_id INT REFERENCES executions(id) ON DELETE SET NULL,
    node_id TEXT,
    collection TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A retried "Create record" step must not write the same record twice.
    CONSTRAINT records_step_unique UNIQUE (execution_id, node_id)
);

CREATE INDEX records_user_collection_idx ON records (user_id, collection, created_at DESC);
