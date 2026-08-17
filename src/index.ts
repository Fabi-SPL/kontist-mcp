#!/usr/bin/env node
/**
 * Kontist MCP server.
 *
 * Exposes Kontist banking data as MCP tools over stdio.
 *
 * Tools:
 *   - kontist_whoami            — verify auth + return account holder
 *   - kontist_get_balance       — current balance + IBAN
 *   - kontist_list_transactions — list recent transactions with filters
 *   - kontist_get_transaction   — single transaction by ID
 *   - kontist_get_tax_reserves  — VAT + income tax sub-account balances
 *   - kontist_annotate_transaction — add a note to a transaction
 *   - kontist_summarize         — high-level financial summary for date range
 *
 * Setup:
 *   1. cp .env.example .env
 *   2. Fill in credentials (see SETUP.md once written)
 *   3. npm install && npm run build
 *   4. Add to claude config (mcp.json):
 *        { "kontist": { "command": "node", "args": ["/absolute/path/to/kontist-mcp/dist/index.js"] } }
 */

import './load-env.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { whoAmI } from './auth.js'
import {
  getBalance,
  listTransactions,
  getTransaction,
  getTaxReserves,
  annotateTransaction,
} from './queries.js'

const server = new Server(
  {
    name: 'kontist-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// ─────────────────────────────────────────────────────────────────────
// Tool list
// ─────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'kontist_whoami',
      description:
        'Verify Kontist auth is working and return basic identity. Run this first to confirm credentials before any other call.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'kontist_get_balance',
      description:
        'Return the current Kontist business account balance, IBAN, and available balance (in EUR).',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'kontist_list_transactions',
      description:
        'List recent Kontist transactions with optional filters. Default returns last 50. Amounts are in EUR (positive = inflow, negative = outflow).',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max number of transactions to return (default 50, max 200)' },
          cursor: { type: 'string', description: 'Pagination cursor from previous call' },
          from: { type: 'string', description: 'ISO date (YYYY-MM-DD) — filter transactions on/after this booking date' },
          to: { type: 'string', description: 'ISO date — filter transactions on/before this booking date' },
          min_amount: { type: 'number', description: 'Minimum transaction amount in EUR (negative for outflows)' },
          max_amount: { type: 'number', description: 'Maximum transaction amount in EUR' },
        },
        required: [],
      },
    },
    {
      name: 'kontist_get_transaction',
      description: 'Fetch a single Kontist transaction by its ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Transaction ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'kontist_get_tax_reserves',
      description:
        'Get current balances of the Kontist VAT and income tax reserve sub-accounts. Returns null fields if not enabled or if Kleinunternehmer (no VAT).',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'kontist_annotate_transaction',
      description:
        'Add a note/annotation to a transaction. Useful for tagging Stripe payouts with the originating customer or invoice.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Transaction ID' },
          note: { type: 'string', description: 'Annotation text (max 200 chars recommended)' },
        },
        required: ['id', 'note'],
      },
    },
    {
      name: 'kontist_summarize',
      description:
        'High-level financial summary for a date range: inflows, outflows, net, top counterparties, category breakdown. Default = last 30 days.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO date (default: 30 days ago)' },
          to: { type: 'string', description: 'ISO date (default: today)' },
        },
        required: [],
      },
    },
  ],
}))

// ─────────────────────────────────────────────────────────────────────
// Tool handlers
// ─────────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  try {
    switch (name) {
      case 'kontist_whoami': {
        const auth = await whoAmI()
        return wrapJson(auth)
      }

      case 'kontist_get_balance': {
        const bal = await getBalance()
        return wrapJson(bal)
      }

      case 'kontist_list_transactions': {
        const a = (args ?? {}) as {
          limit?: number
          cursor?: string
          from?: string
          to?: string
          min_amount?: number
          max_amount?: number
        }
        const result = await listTransactions({
          limit: Math.min(a.limit ?? 50, 200),
          cursor: a.cursor,
          filter: {
            from: a.from,
            to: a.to,
            minAmount: a.min_amount,
            maxAmount: a.max_amount,
          },
        })
        // Convert cents → EUR for clarity
        const formatted = {
          transactions: result.transactions.map((t) => ({
            ...t,
            amount_eur: t.amount / 100,
            amount_cents: t.amount,
          })),
          has_next: result.has_next,
          next_cursor: result.next_cursor,
          count: result.transactions.length,
        }
        return wrapJson(formatted)
      }

      case 'kontist_get_transaction': {
        const a = args as { id: string }
        const tx = await getTransaction(a.id)
        return wrapJson({
          ...tx.viewer.mainAccount.transaction,
          amount_eur: tx.viewer.mainAccount.transaction.amount / 100,
        })
      }

      case 'kontist_get_tax_reserves': {
        const r = await getTaxReserves()
        return wrapJson({
          vat_balance_eur: r.vatBalance != null ? r.vatBalance / 100 : null,
          income_tax_balance_eur: r.incomeTaxBalance != null ? r.incomeTaxBalance / 100 : null,
          vat_rate: r.vatRate,
          income_tax_rate: r.incomeTaxRate,
          note: r.vatBalance == null && r.incomeTaxBalance == null
            ? 'Tax reserves not configured (or Kleinunternehmer = VAT exempt). Toggle in Kontist app.'
            : null,
        })
      }

      case 'kontist_annotate_transaction': {
        const a = args as { id: string; note: string }
        const result = await annotateTransaction(a.id, a.note)
        return wrapJson(result.updateTransaction)
      }

      case 'kontist_summarize': {
        const a = (args ?? {}) as { from?: string; to?: string }
        const to = a.to ?? new Date().toISOString().slice(0, 10)
        const from =
          a.from ??
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

        const { transactions } = await listTransactions({
          limit: 200,
          filter: { from, to },
        })

        const inflow = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0) / 100
        const outflow = transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0) / 100

        // Top counterparties (by absolute volume)
        const byCounterparty = new Map<string, number>()
        for (const t of transactions) {
          const key = t.name ?? 'Unknown'
          byCounterparty.set(key, (byCounterparty.get(key) ?? 0) + Math.abs(t.amount))
        }
        const topCounterparties = [...byCounterparty.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([name, cents]) => ({ name, volume_eur: cents / 100 }))

        // Category breakdown
        const byCategory = new Map<string, number>()
        for (const t of transactions) {
          const key = t.category ?? 'uncategorized'
          byCategory.set(key, (byCategory.get(key) ?? 0) + t.amount)
        }
        const categoryBreakdown = [...byCategory.entries()]
          .map(([category, cents]) => ({ category, net_eur: cents / 100 }))
          .sort((a, b) => Math.abs(b.net_eur) - Math.abs(a.net_eur))

        return wrapJson({
          period: { from, to },
          totals: {
            inflow_eur: inflow,
            outflow_eur: outflow,
            net_eur: inflow + outflow,
            transaction_count: transactions.length,
          },
          top_counterparties: topCounterparties,
          category_breakdown: categoryBreakdown,
        })
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    }
  }
})

function wrapJson(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[kontist-mcp] server running on stdio')
