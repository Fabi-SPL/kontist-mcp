/**
 * Kontist OAuth2 token management.
 *
 * Flow:
 *   1. One-time interactive setup (`npm run setup`) gets a refresh token
 *   2. Refresh token is stored in .env as KONTIST_REFRESH_TOKEN
 *   3. On every MCP request, we exchange refresh → access token (if cached one expired)
 *   4. Access tokens are cached in-memory for their lifetime (~5 min)
 */

import './load-env.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_CACHE_PATH = path.resolve(__dirname, '..', '.tokens-cache.json')

const AUTH_URL = process.env.KONTIST_AUTH_URL ?? 'https://api.kontist.com/api/oauth/token'

interface CachedToken {
  access_token: string
  expires_at: number // unix ms
}

let memCache: CachedToken | null = null

function loadDiskCache(): CachedToken | null {
  try {
    if (!fs.existsSync(TOKEN_CACHE_PATH)) return null
    const raw = fs.readFileSync(TOKEN_CACHE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as CachedToken
    if (parsed.expires_at > Date.now() + 30_000) return parsed
    return null
  } catch {
    return null
  }
}

function saveDiskCache(tok: CachedToken) {
  try {
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(tok, null, 2), 'utf8')
  } catch (err) {
    // Non-fatal; we'll still have memCache
    console.error('[kontist-mcp] could not write token cache:', err)
  }
}

/**
 * Exchange refresh token for fresh access token.
 * Uses Resource Owner Password Credentials grant variant — Kontist's documented flow.
 */
async function refreshAccessToken(): Promise<CachedToken> {
  const clientId = process.env.KONTIST_CLIENT_ID
  const clientSecret = process.env.KONTIST_CLIENT_SECRET
  const refreshToken = process.env.KONTIST_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      '[kontist-mcp] missing credentials. Set KONTIST_CLIENT_ID, KONTIST_CLIENT_SECRET, KONTIST_REFRESH_TOKEN in .env (run setup flow first).'
    )
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[kontist-mcp] token refresh failed (${res.status}): ${text}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  const tok: CachedToken = {
    access_token: json.access_token,
    expires_at: Date.now() + (json.expires_in - 60) * 1000, // 60s safety margin
  }

  memCache = tok
  saveDiskCache(tok)
  return tok
}

export async function getAccessToken(): Promise<string> {
  if (memCache && memCache.expires_at > Date.now() + 30_000) {
    return memCache.access_token
  }
  const fromDisk = loadDiskCache()
  if (fromDisk) {
    memCache = fromDisk
    return fromDisk.access_token
  }
  const fresh = await refreshAccessToken()
  return fresh.access_token
}

/**
 * Diagnostic helper — used by `npm run test:auth`
 */
export async function whoAmI() {
  const token = await getAccessToken()
  return {
    has_token: !!token,
    token_preview: token.slice(0, 12) + '…',
    expires_at: memCache?.expires_at ? new Date(memCache.expires_at).toISOString() : 'unknown',
  }
}
