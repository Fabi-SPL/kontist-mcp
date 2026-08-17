# Kontist MCP, setup guide

Start to finish this takes about fifteen minutes, most of it waiting on the Kontist developer-app
form and the MFA push.

---

## 1. Install dependencies

```bash
npm install
```

## 2. Get Kontist API credentials

After your Kontist account is open (post-Gewerbeanmeldung):

1. Log into [Kontist](https://kontist.com) web app
2. Go to **Settings → Developers** (or visit [kontist.dev](https://kontist.dev) directly)
3. **Register a new OAuth application:**
   - Name: `kontist-mcp` (any name works, it is only shown on the consent screen)
   - Redirect URI: `http://localhost:8765/callback` (for one-time setup)
   - Scopes: `accounts`, `transactions`, `transfers` (read-only is fine for v1)
4. Copy the **Client ID** and **Client Secret**

## 3. One-time OAuth flow to get refresh token

Kontist issues a long-lived refresh token through a one-time interactive consent. Only that token
goes in `.env`. Access tokens are exchanged and cached automatically after that.

**Option A, the helper script.** Put `KONTIST_CLIENT_ID` and `KONTIST_CLIENT_SECRET` in `.env`
first, then:

```bash
npm run setup
```

It starts a local server on `:8765`, opens the browser at the authorize URL, captures the callback
code, exchanges it, waits for the MFA push to be confirmed on the Kontist mobile app, then prints
the confirmed refresh token to paste into `.env`. The mobile app has to be installed and logged in,
because the refresh token is only issued after that push is approved.

**Option B, by hand.** Useful if the callback port is blocked or the browser handoff fails.

1. Open this URL, substituting your client id:
   ```
   https://api.kontist.com/api/oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=http://localhost:8765/callback&scope=transactions+accounts+transfers
   ```
2. Log in and approve.
3. You land on `http://localhost:8765/callback?code=XXX`. Copy the `code` param.
4. Exchange it:
   ```bash
   curl -X POST https://api.kontist.com/api/oauth/token \
     -d grant_type=authorization_code \
     -d code=XXX \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET \
     -d redirect_uri=http://localhost:8765/callback
   ```
5. The response carries `refresh_token`.

## 4. Fill in `.env`

```bash
cp .env.example .env
# Edit .env and paste:
#   KONTIST_CLIENT_ID=...
#   KONTIST_CLIENT_SECRET=...
#   KONTIST_REFRESH_TOKEN=...
```

## 5. Smoke test

```bash
npm run test:auth
```

Expected output: token info + your viewer details (name, email, IBAN).

```bash
npm run test:balance
```

Expected output: current balance, last 5 transactions, tax reserve balances (or null if not enabled).

## 6. Build for production

```bash
npm run build
```

This produces `dist/index.js`, the server entry point.

## 7. Register the server

Add it to your MCP client's config:

```json
{
  "mcpServers": {
    "kontist": {
      "command": "node",
      "args": ["/absolute/path/to/kontist-mcp/dist/index.js"],
      "env": {
        "KONTIST_CLIENT_ID": "${KONTIST_CLIENT_ID}",
        "KONTIST_CLIENT_SECRET": "${KONTIST_CLIENT_SECRET}",
        "KONTIST_REFRESH_TOKEN": "${KONTIST_REFRESH_TOKEN}"
      }
    }
  }
}
```

Restart the client. The `kontist_*` tools should appear in its tool list.

## 8. Verify

Call `kontist_whoami`. If it returns your account identity and IBAN, the chain is working end to
end.

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `kontist_whoami` | Verify auth, return identity |
| `kontist_get_balance` | Current balance + IBAN |
| `kontist_list_transactions` | Recent transactions with filters |
| `kontist_get_transaction` | Single transaction by ID |
| `kontist_get_tax_reserves` | VAT + income tax sub-account balances |
| `kontist_annotate_transaction` | Add note to transaction |
| `kontist_summarize` | Period summary (inflows, outflows, top counterparties, categories) |

---

## Troubleshooting

**`token refresh failed (401)`.** The refresh token expired or was revoked. Redo step 3.

**`No mainAccount`.** The `viewer.mainAccount` field differs between the Solo and Premium plans. Run a raw introspection query and adjust `queries.ts`.

**`Tax reserves all null`.** Expected if you are Kleinunternehmer, so no VAT, or if the auto-reserve toggle is off. It lives in the Kontist app under Settings, then Tax.

**Schema mismatches.** Kontist's GraphQL schema moves. Run an introspection query and update the field names in `queries.ts` to match:

```bash
curl -X POST https://api.kontist.com/api/graphql \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"{__schema{types{name}}}"}'
```

---

## Ideas not built yet

- **Match Stripe payouts to customers.** Incoming Kontist transactions carry the Stripe payout
  reference, so the counterparty could be resolved automatically instead of annotated by hand.
- **Outflow alerting.** A daily digest when anything above a threshold leaves the account.
- **Monthly reserve report.** Projected EÜR row totals, formatted for ELSTER prep.
- **Privatentnahme suggestions.** Derived from the tax reserve balance and remaining runway.
