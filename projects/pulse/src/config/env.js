// Reads and validates environment variables once, at startup.
// Everything secret comes from the environment; nothing is hard-coded.

function required(name) {
    const value = process.env[name]
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`)
    }
    return value
}

function bool(name, fallback) {
    const value = process.env[name]
    if (value === undefined || value === '') return fallback
    return value === 'true' || value === '1'
}

function int(name, fallback) {
    const value = process.env[name]
    if (value === undefined || value === '') return fallback
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) {
        throw new Error(`Environment variable ${name} must be an integer`)
    }
    return parsed
}

const nodeEnv = process.env.NODE_ENV || 'development'
const isProduction = nodeEnv === 'production'

const jwtSecret = required('JWT_SECRET')
if (isProduction && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production')
}

export const env = {
    nodeEnv,
    isProduction,
    port: int('PORT', 4000),
    databaseUrl: required('DATABASE_URL'),
    databaseSsl: bool('DATABASE_SSL', isProduction),
    jwtSecret,
    // Public URL of the web app, used for reset links and the CSRF origin check.
    appUrl: (process.env.APP_URL || 'http://localhost:5174').replace(/\/$/, ''),
    resendApiKey: process.env.RESEND_API_KEY || '',
    emailFrom: process.env.EMAIL_FROM || 'Pulse Monitor <onboarding@resend.dev>',
    // Run the check scheduler inside the API process. Set to false when the
    // scheduler runs as its own process (npm run scheduler).
    runScheduler: bool('RUN_SCHEDULER', true),
    // Allows checking localhost and private networks. Keep false in production.
    allowPrivateTargets: bool('ALLOW_PRIVATE_TARGETS', false),
    // Serve the built client from Express (single Render web service).
    serveClient: bool('SERVE_CLIENT', isProduction),
    // Hosted demos: 'true' creates the demo account on startup if it is
    // missing; 'reset' rebuilds it on every start (set it for one deploy).
    seedDemo: ['true', 'reset'].includes(process.env.SEED_DEMO) ? process.env.SEED_DEMO : null,
    logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
}
