/**
 * Path-aware dotenv loader.
 *
 * MCP servers run with CWD = Claude's process dir, NOT the script's dir.
 * `import 'dotenv/config'` loads from CWD which means the .env file is missed.
 *
 * This module resolves .env relative to its own location (../  for src/, ../.env for dist/).
 */
import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const candidates = [
  path.resolve(__dirname, '..', '.env'),    // dist/load-env.js → ../.env
  path.resolve(__dirname, '..', '..', '.env'), // src/load-env.ts → ../../.env when run via tsx
  path.resolve(__dirname, '.env'),           // sibling fallback
]

for (const p of candidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p })
    break
  }
}
