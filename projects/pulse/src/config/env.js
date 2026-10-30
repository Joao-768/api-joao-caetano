// Reads and validates environment variables once, at startup.
// Everything secret comes from the environment; nothing is hard-coded.
//
// Hosted by api-joao-caetano next to other projects, so every variable of this
// one carries the PULSE_ prefix (PULSE_DATABASE_URL, PULSE_JWT_SECRET...) and
// cannot collide with another project's. NODE_ENV is shared.

const PREFIX = 'PULSE_'

function read(name) {
    return process.env[PREFIX + name]
}

function required(name) {
    const value = read(name)
    if (!value) {
        throw new Error(`Missing required environment variable: ${PREFIX}${name}`)
    }
    return value
}

function bool(name, fallback) {
    const value = read(name)
    if (value === undefined || value === '') return fallback
    return value === 'true' || value === '1'
}

function int(name, fallback) {
    const value = read(name)
    if (value === undefined || value === '') return fallback
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) {
        throw new Error(`Environment variable ${PREFIX}${name} must be an integer`)
    }
    return parsed
}

const nodeEnv = process.env.NODE_ENV || 'development'
const isProduction = nodeEnv === 'production'

const jwtSecret = required('JWT_SECRET')
if (isProduction && jwtSecret.length < 32) {
    throw new Error(`${PREFIX}JWT_SECRET must be at least 32 characters in production`)
}

export const env = {
    nodeEnv,
    isProduction,
    databaseUrl: required('DATABASE_URL'),
    databaseSsl: bool('DATABASE_SSL', isProduction),
    // Shares the Supabase pooler with the Workflow engine: in session mode
    // every pooled connection holds one of the project's backend connections.
    databasePoolMax: int('DATABASE_POOL_MAX', 5),
    jwtSecret,
    // Public URL of the web app, used for reset links and the CSRF origin check.
    appUrl: (read('APP_URL') || 'http://localhost:5174').replace(/\/$/, ''),
    resendApiKey: read('RESEND_API_KEY') || '',
    emailFrom: read('EMAIL_FROM') || 'Pulse Monitor <onboarding@resend.dev>',
    // Run the check scheduler inside the API process. Set to false when the
    // scheduler runs as its own process (npm run scheduler).
    runScheduler: bool('RUN_SCHEDULER', true),
    // Allows checking localhost and private networks. Keep false in production.
    allowPrivateTargets: bool('ALLOW_PRIVATE_TARGETS', false),
    // Serve the built client from Express. Off by default: the client is a
    // static site on Vercel and only the API runs inside the host.
    serveClient: bool('SERVE_CLIENT', false),
    // Checks running at the same time. The standalone default was 20; the
    // host shares 512 MB with other projects, so it starts lower.
    checkConcurrency: int('CHECK_CONCURRENCY', 10),
    // Hosted demos: 'true' creates the demo account on startup if it is
    // missing; 'reset' rebuilds it on every start (set it for one deploy).
    seedDemo: ['true', 'reset'].includes(read('SEED_DEMO')) ? read('SEED_DEMO') : null,
    logLevel: read('LOG_LEVEL') || (isProduction ? 'info' : 'debug'),
}
