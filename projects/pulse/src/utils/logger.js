// Minimal leveled logger: JSON lines in production (easy to search in Render
// logs), readable lines in development.

import { env } from '../config/env.js'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = LEVELS[env.logLevel] ?? LEVELS.info

function write(level, message, meta = {}) {
    if (LEVELS[level] < threshold) return
    const time = new Date().toISOString()
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout

    if (env.isProduction) {
        stream.write(JSON.stringify({ time, level, message, ...meta }) + '\n')
        return
    }

    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''
    stream.write(`${time.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${message}${extra}\n`)
}

export const logger = {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
}
