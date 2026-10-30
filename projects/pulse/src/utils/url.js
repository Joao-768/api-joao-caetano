import net from 'node:net'

const MAX_URL_LENGTH = 2048

// Validates and normalizes a monitor URL. Returns { url } or { error }.
// Only checks the shape of the URL: an unreachable URL is still valid.
export function normalizeMonitorUrl(input) {
    if (typeof input !== 'string' || input.trim() === '') {
        return { error: 'Enter a URL.' }
    }

    const raw = input.trim()
    if (raw.length > MAX_URL_LENGTH) {
        return { error: `URL must be at most ${MAX_URL_LENGTH} characters.` }
    }
    if (!/^https?:\/\//i.test(raw)) {
        return { error: 'URL must start with http:// or https://.' }
    }

    let parsed
    try {
        parsed = new URL(raw)
    } catch {
        return { error: 'This is not a valid URL.' }
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: 'URL must start with http:// or https://.' }
    }
    if (parsed.username || parsed.password) {
        return { error: 'URLs with embedded credentials are not supported.' }
    }

    const host = parsed.hostname.replace(/^\[|\]$/g, '')
    const isIp = net.isIP(host) !== 0
    // A public hostname needs at least one dot and a letter-based TLD
    // ("google" alone is rejected). IP literals are allowed.
    if (!isIp && !/^([a-z0-9-]+\.)+[a-z][a-z0-9-]*[a-z0-9]$/i.test(host)) {
        return { error: 'URL must include a full domain name, like example.com.' }
    }

    // Fragments are never sent to the server, so they only create duplicates.
    parsed.hash = ''
    return { url: parsed.href }
}
