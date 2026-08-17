/**
 * One-shot OAuth helper for Kontist using their official SDK.
 *
 *   npm run setup
 *
 * Flow:
 *   1. Spin up local server on localhost:8765
 *   2. Open browser to Kontist OAuth authorize URL (via SDK)
 *   3. User logs in + approves
 *   4. Capture callback URL with ?code=...
 *   5. Exchange code for initial access token (SDK handles)
 *   6. Trigger MFA push notification → user confirms on phone
 *   7. Receive confirmed refresh token (lifetime-valid)
 *   8. Print to paste into .env
 *
 * Prereq: Set KONTIST_CLIENT_ID + KONTIST_CLIENT_SECRET in .env first.
 *         Mobile Kontist app must be installed + logged in for MFA push.
 */
import './load-env.js'
import http from 'node:http'
import { exec } from 'node:child_process'
import { Client } from 'kontist'

const SCOPES = ['transactions', 'transfers', 'accounts', 'offline']

const PORT = Number(process.env.OAUTH_CALLBACK_PORT ?? 8765)
const REDIRECT = `http://localhost:${PORT}/callback`

async function main() {
  const clientId = process.env.KONTIST_CLIENT_ID
  const clientSecret = process.env.KONTIST_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('❌ Set KONTIST_CLIENT_ID and KONTIST_CLIENT_SECRET in .env first.')
    console.error('Get them at: https://kontist.dev/client-management/')
    console.error(`Authorized redirect URI must be: ${REDIRECT}`)
    process.exit(1)
  }

  const state = Math.random().toString(36).slice(2)

  const client = new Client({
    clientId,
    clientSecret,
    redirectUri: REDIRECT,
    scopes: SCOPES,
    state,
  })

  const authUri = await client.auth.tokenManager.getAuthUri()

  console.log('\n🔗 Opening browser for Kontist auth...')
  console.log('If it does not open automatically, visit:\n')
  console.log(`  ${authUri}\n`)

  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  exec(`${opener} "${authUri}"`)

  const callbackUrl: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
      if (url.pathname === '/callback') {
        const err = url.searchParams.get('error')
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end(`OAuth error: ${err}`)
          server.close()
          reject(new Error(`OAuth error: ${err}`))
          return
        }
        if (!url.searchParams.get('code')) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Missing code')
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h2>✅ OAuth approved. Now check your phone for the MFA push…</h2></body></html>')
        server.close()
        resolve(`${REDIRECT}?${url.search.slice(1)}`)
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    server.listen(PORT, () => console.log(`👂 Waiting for OAuth callback on ${REDIRECT}...\n`))
    server.on('error', reject)
  })

  console.log('✅ OAuth callback received.')
  console.log('🔄 Exchanging code for initial access token...\n')

  // Step 1: Initial token exchange via SDK
  await client.auth.tokenManager.fetchToken(callbackUrl)

  console.log('📲 Triggering MFA push notification — CHECK YOUR PHONE NOW.')
  console.log('   Tap the notification → open Kontist app → tap Confirm.')
  console.log('   Waiting up to 5 minutes for confirmation...\n')

  // Step 2: Push MFA — blocks until user approves on phone
  const { refreshToken } = await client.auth.push.getConfirmedToken()

  console.log('\n✅ MFA confirmed!\n')
  console.log('Add this line to your .env file:\n')
  console.log(`KONTIST_REFRESH_TOKEN=${refreshToken}\n`)
  console.log('(Refresh token is lifetime-valid — no need to re-MFA.)')
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
