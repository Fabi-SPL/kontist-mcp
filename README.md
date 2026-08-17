# kontist-mcp

An OAuth2 client and a typed GraphQL layer over [Kontist](https://kontist.com) business banking,
exposed over the Model Context Protocol so balances, transactions and tax reserves can be read and
annotated from a tool client instead of the web app.

## Why it exists

Kontist is a German business account aimed at freelancers, and it keeps two things most banks do
not expose usefully: automatic VAT and income-tax reserve sub-accounts, and a per-transaction
annotation field used for bookkeeping. Both matter at Steuererklärung time and both are tedious to
work with by hand.

The interesting part is the auth chain rather than the queries. Kontist gates its long-lived
refresh token behind an interactive consent plus an MFA push confirmed on the phone, so the token
has to be captured once through a local callback server and then treated as the only credential
worth persisting. Everything after that is token exchange, caching and expiry handling.

## Tools

| Tool | Does |
|---|---|
| `kontist_whoami` | Account identity and IBAN, the auth smoke test |
| `kontist_get_balance` | Current balance |
| `kontist_list_transactions` | Recent transactions, filtered by date, amount or category |
| `kontist_get_transaction` | One transaction in full |
| `kontist_get_tax_reserves` | VAT and income-tax reserve sub-account balances |
| `kontist_annotate_transaction` | Write the bookkeeping note back onto a transaction |
| `kontist_summarize` | Inflows, outflows, top counterparties and category totals over a range |

Every tool input is validated with a `zod` schema before a query goes out, so a malformed date range
fails locally rather than as a GraphQL error.

## How it works

```
tool client
  |  MCP over stdio
kontist-mcp (Node + TypeScript)
  |  GraphQL over fetch, OAuth2 bearer, token refreshed and cached
api.kontist.com/api/graphql
```

Auth is OAuth2 with a one-time interactive consent that yields a long-lived refresh token. Only
that refresh token goes in `.env`. Access tokens are fetched on demand, cached in
`.tokens-cache.json` and refreshed when they expire, so the interactive flow runs exactly once.

## Run it

```bash
npm install
cp .env.example .env        # client id, client secret
npm run setup               # one-time OAuth consent, writes the refresh token
npm run test:auth           # confirms the token works
npm run build
```

Then register it with your MCP client, pointing at `dist/index.js`. Full walkthrough including the
Kontist developer-app registration is in [SETUP.md](./SETUP.md).

## Stack

Node 18+, TypeScript, `@modelcontextprotocol/sdk`, `graphql-request`, the official `kontist` SDK
for the OAuth dance, `zod` for tool input validation. No ORM and no framework.

The one-time consent step needs the Kontist mobile app installed and logged in, because the refresh
token is only issued after an MFA push is confirmed on the phone.

## Limitations

- **Read-mostly by design.** The only write is the annotation field. Transfers are deliberately not
  exposed, even though the API supports them and the `transfers` scope exists, because an agent
  that can move money is a bad idea.
- **Not yet exercised against a live account.** The OAuth2 flow, the GraphQL client and all seven
  tools are written and typecheck, but the account itself opens once the Gewerbeanmeldung clears.
  Expect the first real run to turn up schema drift in the transaction fields.
- **No test suite.** Two smoke scripts, `test:auth` and `test:balance`, and nothing else.
- **Single account.** No multi-account handling, no pagination beyond what Kontist returns by
  default.

## License

MIT
