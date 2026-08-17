/**
 * Typed query helpers for Kontist GraphQL.
 *
 * NOTE: Schema is approximate based on Kontist's public docs. Some fields will need
 * verification once we have real credentials and can introspect the live schema.
 * Run `npm run dev` once authenticated and inspect — adjust field names as needed.
 */

import { z } from 'zod'
import { rawQuery } from './client.js'

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export const TransactionSchema = z.object({
  id: z.string(),
  amount: z.number(), // in cents (Kontist convention) — divide by 100 for euros
  name: z.string().nullable(), // counterparty name
  iban: z.string().nullable(),
  type: z.string().nullable(), // SEPA_CT, SEPA_DD, CARD, FEE, etc.
  valutaDate: z.string().nullable(), // ISO date
  bookingDate: z.string().nullable(),
  purpose: z.string().nullable(),
  category: z.string().nullable(), // Kontist's auto-category
  userSelectedBookingDate: z.string().nullable(),
})
export type Transaction = z.infer<typeof TransactionSchema>

export const AccountSchema = z.object({
  id: z.string(),
  iban: z.string(),
  balance: z.number(), // cents
  availableBalance: z.number(),
  cardHolderRepresentation: z.string().nullable(),
})
export type Account = z.infer<typeof AccountSchema>

export const TaxReserveSchema = z.object({
  vatBalance: z.number().nullable(), // cents
  incomeTaxBalance: z.number().nullable(), // cents
  vatRate: z.number().nullable(), // e.g. 0.19
  incomeTaxRate: z.number().nullable(), // e.g. 0.25
})
export type TaxReserve = z.infer<typeof TaxReserveSchema>

// ─────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────

export async function getMe() {
  const query = /* GraphQL */ `
    query Me {
      viewer {
        publicId
        email
        firstName
        lastName
        mainAccount {
          publicId
          iban
          bic
          balance
          availableBalance
        }
      }
    }
  `
  return rawQuery<{
    viewer: {
      publicId: string
      email: string
      firstName: string
      lastName: string
      mainAccount: Account
    }
  }>(query)
}

export async function getBalance() {
  const me = await getMe()
  return {
    iban: me.viewer.mainAccount.iban,
    balance_cents: me.viewer.mainAccount.balance,
    balance_eur: me.viewer.mainAccount.balance / 100,
    available_eur: me.viewer.mainAccount.availableBalance / 100,
  }
}

export async function listTransactions(opts: {
  limit?: number
  cursor?: string
  filter?: { from?: string; to?: string; minAmount?: number; maxAmount?: number }
} = {}) {
  const query = /* GraphQL */ `
    query Transactions($first: Int, $after: String) {
      viewer {
        mainAccount {
          transactions(first: $first, after: $after) {
            edges {
              cursor
              node {
                id
                amount
                name
                iban
                type
                valutaDate
                bookingDate
                purpose
                category
                userSelectedBookingDate
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `
  const result = await rawQuery<{
    viewer: {
      mainAccount: {
        transactions: {
          edges: Array<{ cursor: string; node: Transaction }>
          pageInfo: { hasNextPage: boolean; endCursor: string | null }
        }
      }
    }
  }>(query, {
    first: opts.limit ?? 50,
    after: opts.cursor,
  })

  let txs = result.viewer.mainAccount.transactions.edges.map((e) => e.node)

  // Client-side filter (Kontist may not support all filter combinations server-side)
  if (opts.filter) {
    if (opts.filter.from) txs = txs.filter((t) => (t.bookingDate ?? '') >= opts.filter!.from!)
    if (opts.filter.to) txs = txs.filter((t) => (t.bookingDate ?? '') <= opts.filter!.to!)
    if (opts.filter.minAmount !== undefined)
      txs = txs.filter((t) => t.amount >= (opts.filter!.minAmount! * 100))
    if (opts.filter.maxAmount !== undefined)
      txs = txs.filter((t) => t.amount <= (opts.filter!.maxAmount! * 100))
  }

  return {
    transactions: txs,
    has_next: result.viewer.mainAccount.transactions.pageInfo.hasNextPage,
    next_cursor: result.viewer.mainAccount.transactions.pageInfo.endCursor,
  }
}

export async function getTransaction(id: string) {
  const query = /* GraphQL */ `
    query Transaction($id: ID!) {
      viewer {
        mainAccount {
          transaction(id: $id) {
            id
            amount
            name
            iban
            type
            valutaDate
            bookingDate
            purpose
            category
            userSelectedBookingDate
          }
        }
      }
    }
  `
  return rawQuery<{
    viewer: { mainAccount: { transaction: Transaction } }
  }>(query, { id })
}

/**
 * Tax reserve sub-account balances.
 * Schema field names may differ — verify against live introspection.
 */
export async function getTaxReserves(): Promise<TaxReserve> {
  const query = /* GraphQL */ `
    query TaxReserves {
      viewer {
        taxReserve {
          vatBalance
          incomeTaxBalance
          vatRate
          incomeTaxRate
        }
      }
    }
  `
  try {
    const result = await rawQuery<{ viewer: { taxReserve: TaxReserve | null } }>(query)
    return (
      result.viewer.taxReserve ?? {
        vatBalance: null,
        incomeTaxBalance: null,
        vatRate: null,
        incomeTaxRate: null,
      }
    )
  } catch {
    // Field may not exist on free plan or for Kleinunternehmer accounts — return null shape
    return {
      vatBalance: null,
      incomeTaxBalance: null,
      vatRate: null,
      incomeTaxRate: null,
    }
  }
}

/**
 * Categorize / annotate a transaction.
 * Useful for Lucid: tag a Stripe payout as "Stripe payout — Voice Agent Premium / Praxis Müller"
 */
export async function annotateTransaction(id: string, note: string) {
  const mutation = /* GraphQL */ `
    mutation UpdateTransaction($id: ID!, $note: String) {
      updateTransaction(id: $id, note: $note) {
        id
        note
      }
    }
  `
  return rawQuery<{ updateTransaction: { id: string; note: string } }>(mutation, { id, note })
}
