// Password hashing with scrypt from node:crypto (memory-hard, no native
// dependency to compile on Render). Stored format:
//   scrypt$N$r$p$saltBase64$hashBase64
// Parameters live in the hash, so they can be raised later without breaking
// existing passwords.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

const N = 16384
const R = 8
const P = 1
const KEY_LENGTH = 64

export async function hashPassword(password) {
    const salt = randomBytes(16)
    const hash = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P })
    return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password, stored) {
    const [algorithm, n, r, p, saltB64, hashB64] = String(stored).split('$')
    if (algorithm !== 'scrypt') return false

    const expected = Buffer.from(hashB64, 'base64')
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
    })
    return timingSafeEqual(expected, actual)
}

// Used when the email does not exist, so login takes the same time either way.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'))

export async function burnVerificationTime(password) {
    await verifyPassword(password, DUMMY_HASH)
}
