// Installs and builds every hosted project in its own folder, with its own
// lockfile and node_modules, so their dependency versions never mix.
// Render runs this as part of the build command: npm ci && npm run build.

import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const steps = [
    // Dev dependencies too: TypeScript builds it, and the Prisma CLI runs
    // `migrate deploy` at start.
    ['projects/collabcode', 'npm ci --include=dev --no-audit --no-fund'],
    ['projects/collabcode', 'npm run build'],
    // Plain JavaScript, nothing to build.
    ['projects/pulse', 'npm ci --omit=dev --no-audit --no-fund'],
    // Its .npmrc installs dev dependencies (TypeScript); postinstall builds shared/.
    ['projects/workflow', 'npm ci --no-audit --no-fund'],
    ['projects/workflow', 'npm run build'],
]

for (const [dir, command] of steps) {
    console.log(`\n> ${dir}: ${command}`)
    execSync(command, { cwd: resolve(root, dir), stdio: 'inherit' })
}
