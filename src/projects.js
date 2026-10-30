// The projects this service hosts. Each one lives in projects/<name>, keeps
// its own dependencies, and exposes a mount module whose start() resolves to:
//
//   app       Express app, mounted at /<name>
//   ping()    one cheap database query, for /health/deep and the keep-alive
//   stop()    finish in-flight work and close connections
//   sockets   optional: registers handlers on the /<name> Socket.io namespace
//             (the registry entry sets `sockets: true` so CORS allows its origin)
//
// Variables are prefixed per project (COLLAB_, PULSE_, WORKFLOW_), and the
// browser origin each project accepts is read from its own variable, so CORS
// and the project agree on a single value.

export const projects = [
    {
        name: 'collabcode',
        originsVar: 'COLLAB_CLIENT_ORIGIN',
        sockets: true,
        // Neon: never pinged on a timer, so its compute can scale to zero.
        keepAlive: false,
        load: () => import('../projects/collabcode/dist/mount.js'),
    },
    {
        name: 'pulse',
        originsVar: 'PULSE_APP_URL',
        // Supabase pauses a free project after a week without activity.
        keepAlive: true,
        load: () => import('../projects/pulse/src/mount.js'),
    },
    {
        name: 'workflow',
        originsVar: 'WORKFLOW_FRONTEND_URL',
        keepAlive: true,
        load: () => import('../projects/workflow/backend/dist/mount.js'),
    },
]

export function originsOf(project) {
    return (process.env[project.originsVar] ?? '')
        .split(',')
        .map((origin) => origin.trim().replace(/\/$/, ''))
        .filter(Boolean)
}
