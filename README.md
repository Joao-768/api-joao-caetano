# api-joao-caetano

One Express service that hosts the backends of my portfolio projects, each under its own prefix:

| Project      | Prefix                                    | Frontend                                | Database                          |
| ------------ | ----------------------------------------- | --------------------------------------- | --------------------------------- |
| CollabCode   | `https://api.joao-caetano.com/collabcode` | `https://collabcode.joao-caetano.com`   | Neon                              |
| PulseMonitor | `https://api.joao-caetano.com/pulse`      | `https://pulsemonitor.joao-caetano.com` | Supabase, schema `pulse`          |
| FlowEngine   | `https://api.joao-caetano.com/workflow`   | `https://flowengine.joao-caetano.com`   | Supabase, schema `public` + Redis |

It runs as a single free Render web service, kept awake by an external ping to `/health`. The free tier gives 750 instance hours per workspace per month, which is enough for exactly one service running all month, so the projects share it.

## How it works

Each project lives in `projects/<name>` with its own `package.json`, lockfile and `node_modules`, so their dependency versions never mix (TypeScript 6 and 7, CommonJS and ESM, side by side). The code was copied from the original repositories; the commits that adapted it show every change, and none of them touch business logic beyond what is listed below.

A project exposes a mount module whose `start()` runs its migrations and resolves to:

| Field     | Purpose                                                             |
| --------- | ------------------------------------------------------------------- |
| `app`     | its Express app, mounted at `/<name>`                               |
| `ping()`  | one cheap database query, used by `/health/deep` and the keep-alive |
| `stop()`  | finishes in-flight work and closes connections on shutdown          |
| `sockets` | optional, registers handlers on the `/<name>` Socket.io namespace   |

The registry is [src/projects.js](src/projects.js); the mount modules are `projects/collabcode/src/mount.ts`, `projects/pulse/src/mount.js` and `projects/workflow/backend/src/mount.ts`.

### Isolation

- **Configuration.** Variables are prefixed per project (`COLLAB_`, `PULSE_`, `WORKFLOW_`); each project reads only its own. `NODE_ENV` is shared.
- **Startup.** The HTTP server listens first, then the projects start one at a time. A project whose variables are invalid is marked `failed`; one whose start fails (usually a database that is down) retries after 30 s, 1, 2, 5 and 10 minutes. Until it is up its prefix answers 503, and the other projects are unaffected.
- **Requests.** Every project keeps its own error handler, and the host adds a backstop after it.
- **Process.** `unhandledRejection` and `uncaughtException` are logged with the project they came from (read from the stack). The process keeps serving; only five uncaught exceptions within a minute make it exit, and Render restarts it.
- **Database connections.** Pulse and Workflow share one Supabase project, whose pooler has 15 backend connections on the free plan; in session mode each pooled client holds one. Their pools are 5 each (`PULSE_DATABASE_POOL_MAX`, `WORKFLOW_DATABASE_POOL_MAX`), leaving room for the dashboard and migrations.
- **Memory.** `npm start` caps the heap at 384 MB inside the 512 MB instance. Pulse runs 10 checks at a time (`PULSE_CHECK_CONCURRENCY`) and the Workflow worker 2 jobs at a time (`WORKFLOW_WORKER_CONCURRENCY`).

### Browser access

- **CORS** allows credentials only from each project's own frontend origin, read from the same variable the project uses (`COLLAB_CLIENT_ORIGIN`, `PULSE_APP_URL`, `WORKFLOW_FRONTEND_URL`). Set them to `http://localhost:<port>` in development.
- **Cookies** (CollabCode and Pulse) are host-only on `api.joao-caetano.com`: `HttpOnly`, `Secure` in production, `SameSite=Lax`, no `Domain`. A frontend on `<project>.joao-caetano.com` is same-site with the API, so it sends them with `credentials: 'include'`, and no other subdomain ever receives them.
- **Socket.io** is one server with one namespace per project. Only `/collabcode` uses it; the default namespace refuses connections.

### Workflow engine limits

The BullMQ worker runs in the same process, so a bad workflow must not starve the other projects:

| Variable                                  | Default | Effect                                                            |
| ----------------------------------------- | ------- | ----------------------------------------------------------------- |
| `WORKFLOW_NODE_TIMEOUT_MS`                | 30000   | Hard limit for one node (existing)                                |
| `WORKFLOW_EXECUTION_TIMEOUT_MS`           | 300000  | Active time per execution; delay nodes do not count               |
| `WORKFLOW_MAX_ATTEMPTS_CAP`               | 3       | Ceiling on attempts per node                                      |
| `WORKFLOW_MAX_ACTIVE_EXECUTIONS_PER_USER` | 5       | Queued or running executions per user; further triggers get a 429 |
| `WORKFLOW_WORKER_CONCURRENCY`             | 2       | Node jobs running at the same time                                |

Email goes through Resend's HTTP API because Render's free tier blocks outbound SMTP. Without `WORKFLOW_RESEND_API_KEY` delivery is simulated.

## Health

| Endpoint             | Use                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`        | Render's health check and the keep-alive ping. Touches no database and always answers 200 while the process runs, with each project's status. |
| `GET /health/deep`   | Pings every database, reports memory and event loop delay. Cached for 60 s. 503 if anything is down.                                          |
| `GET /<name>/health` | Each project's own health route, unchanged.                                                                                                   |

Supabase pauses free projects after a week without activity, so the host pings the Supabase projects (Pulse, Workflow) once a day. Neon is never pinged on a timer: its compute scales to zero when idle and its free plan meters compute hours.

## Running locally

Requires Node 24 and Docker.

```bash
# Throwaway databases: Postgres 17 and Redis
docker run -d --rm --name apijc-pg -e POSTGRES_PASSWORD=local -p 127.0.0.1:55432:5432 postgres:17-alpine
docker run -d --rm --name apijc-redis -p 127.0.0.1:56379:6379 redis:7-alpine

# Pulse gets a role whose search_path is its own schema, like in production
PGPASSWORD=local psql -h 127.0.0.1 -p 55432 -U postgres -c "create database supa"
PGPASSWORD=local psql -h 127.0.0.1 -p 55432 -U postgres -d supa \
    -c "create role pulse login password 'pulse'" \
    -c "create schema pulse authorization pulse" \
    -c "alter role pulse set search_path = pulse" \
    -c "revoke all on schema public from pulse"

cp .env.example .env    # then fill in the three JWT secrets
npm install
npm run build           # installs and builds every project
npm run dev             # http://localhost:4400
```

`npm run dev` restarts on changes to `src/`. After changing a TypeScript project (CollabCode, Workflow), run `npm run build` again.

The Workflow demo account (`demo@example.com` / `demo12345`) is created with:

```bash
cd projects/workflow/backend && set -a && source ../../../.env && set +a && npx tsx src/db/seed.ts
```

Pulse creates its demo account (`demo@pulsemonitor.dev` / `pulse-demo-2026`) on start when `PULSE_SEED_DEMO=true`.

## Environment variables

All of them are listed with local values in [.env.example](.env.example). In production:

| Variable                      | Value                                               |
| ----------------------------- | --------------------------------------------------- |
| `NODE_ENV`                    | `production`                                        |
| `COLLAB_DATABASE_URL`         | Neon connection string                              |
| `COLLAB_JWT_SECRET`           | 32+ random characters                               |
| `COLLAB_JWT_EXPIRES_IN`       | `7d`                                                |
| `COLLAB_CLIENT_ORIGIN`        | `https://collabcode.joao-caetano.com`               |
| `PULSE_DATABASE_URL`          | Supabase session pooler, as the `pulse` role        |
| `PULSE_DATABASE_SSL`          | `true`                                              |
| `PULSE_DATABASE_POOL_MAX`     | `5`                                                 |
| `PULSE_JWT_SECRET`            | 32+ random characters                               |
| `PULSE_APP_URL`               | `https://pulsemonitor.joao-caetano.com`             |
| `PULSE_RESEND_API_KEY`        | Resend API key (password reset emails)              |
| `PULSE_EMAIL_FROM`            | Sender, e.g. `PulseMonitor <onboarding@resend.dev>` |
| `PULSE_SEED_DEMO`             | `true`                                              |
| `PULSE_CHECK_CONCURRENCY`     | `10`                                                |
| `WORKFLOW_DATABASE_URL`       | Supabase session pooler, as `postgres`              |
| `WORKFLOW_DATABASE_SSL`       | `true`                                              |
| `WORKFLOW_DATABASE_POOL_MAX`  | `5`                                                 |
| `WORKFLOW_REDIS_URL`          | Internal URL of the Render Key Value instance       |
| `WORKFLOW_QUEUE_PREFIX`       | `wae`                                               |
| `WORKFLOW_JWT_SECRET`         | 32+ random characters                               |
| `WORKFLOW_FRONTEND_URL`       | `https://flowengine.joao-caetano.com`               |
| `WORKFLOW_RESEND_API_KEY`     | Resend API key (email node)                         |
| `WORKFLOW_EMAIL_FROM`         | Sender, e.g. `FlowEngine <onboarding@resend.dev>`   |
| `WORKFLOW_WORKER_CONCURRENCY` | `2`                                                 |

`PORT` is set by Render. With the `onboarding@resend.dev` sender, Resend only delivers to the address that owns the Resend account; verify a domain in Resend to send to anyone.

## Deploying

[render.yaml](render.yaml) describes the service: Frankfurt, free plan, `npm ci && npm run build`, `npm start`, health check on `/health`, custom domain `api.joao-caetano.com`.

## Adding a project

1. Copy its server into `projects/<name>` and give it a mount module as described above.
2. Prefix its variables and make invalid configuration throw instead of calling `process.exit`.
3. Add it to [src/projects.js](src/projects.js) and its install and build steps to [scripts/build.js](scripts/build.js).
4. Check the memory: `GET /health/deep` reports it, and the instance has 512 MB.
