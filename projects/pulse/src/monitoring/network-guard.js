// SSRF protection. The backend requests URLs chosen by users, so without this
// anyone could point a monitor at http://localhost:5432, the cloud metadata
// endpoint (169.254.169.254) or other hosts on the private network, and read
// back status codes and timings.
//
// Every hostname is resolved and every resulting address is checked against
// private, loopback, link-local and reserved ranges before a request is made,
// on the first request and on every redirect hop.

import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { env } from '../config/env.js'

const blocked = new net.BlockList()

const IPV4_RANGES = [
    ['0.0.0.0', 8], // "this" network
    ['10.0.0.0', 8], // private
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, cloud metadata
    ['172.16.0.0', 12], // private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // documentation
    ['192.88.99.0', 24], // 6to4 relay
    ['192.168.0.0', 16], // private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // documentation
    ['203.0.113.0', 24], // documentation
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved, broadcast
]

const IPV6_RANGES = [
    ['::', 128], // unspecified
    ['::1', 128], // loopback
    ['64:ff9b::', 96], // NAT64
    ['100::', 64], // discard
    ['2001:db8::', 32], // documentation
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['ff00::', 8], // multicast
]

for (const [address, prefix] of IPV4_RANGES) blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of IPV6_RANGES) blocked.addSubnet(address, prefix, 'ipv6')

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost'])

export class BlockedTargetError extends Error {
    constructor(message) {
        super(message)
        this.name = 'BlockedTargetError'
    }
}

export function isPrivateAddress(address) {
    const family = net.isIP(address)
    if (family === 4) return blocked.check(address, 'ipv4')
    if (family === 6) {
        // IPv4-mapped IPv6 (::ffff:10.0.0.1) must be judged as IPv4.
        const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
        if (mapped) return blocked.check(mapped[1], 'ipv4')
        return blocked.check(address, 'ipv6')
    }
    return true
}

function stripBrackets(hostname) {
    return hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
}

// Throws BlockedTargetError for private targets. Lets DNS errors through
// untouched so the caller can report them as a DNS failure.
export async function assertPublicHost(hostname) {
    if (env.allowPrivateTargets) return

    const host = stripBrackets(hostname).toLowerCase()
    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
        throw new BlockedTargetError('Target host is not publicly reachable')
    }

    if (net.isIP(host)) {
        if (isPrivateAddress(host)) {
            throw new BlockedTargetError('Target address is in a private or reserved range')
        }
        return
    }

    const addresses = await lookup(host, { all: true, verbatim: true })
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new BlockedTargetError('Target resolves to a private or reserved address')
    }
}
