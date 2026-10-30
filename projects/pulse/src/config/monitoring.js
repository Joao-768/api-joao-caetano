// Tunables for the check engine. Plan intervals live in plans.js.

export const MONITORING = {
    // How often the scheduler looks for due monitors (node-cron, with seconds).
    schedulerCron: '*/5 * * * * *',
    // A failed normal check is retried once after this delay before the
    // monitor is declared DOWN. Deliberately much shorter than any plan interval.
    retryDelaySeconds: 15,
    // Hard limit for one check, redirects included.
    requestTimeoutMs: 10_000,
    maxRedirects: 5,
    // Checks running at the same time inside one process.
    concurrency: 20,
    userAgent: 'PulseMonitor/1.0 (+uptime check)',
    // Reachability probes used to tell "the site is down" from "we are
    // offline" (see monitoring/connectivity.js).
    canaryHosts: ['cloudflare.com', 'google.com'],
    canaryUrl: 'https://1.1.1.1/',
    // Daily retention sweep.
    retentionCron: '15 3 * * *',
}
