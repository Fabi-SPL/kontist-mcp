/**
 * Kontist GraphQL client wrapper.
 * Single entry point for all queries. Handles auth header injection automatically.
 */

import { GraphQLClient } from 'graphql-request'
import { getAccessToken } from './auth.js'

const API_URL = process.env.KONTIST_API_URL ?? 'https://api.kontist.com/api/graphql'

let cachedClient: GraphQLClient | null = null

export async function getClient(): Promise<GraphQLClient> {
  const token = await getAccessToken()

  // Always re-create to ensure fresh token in headers (cheap)
  cachedClient = new GraphQLClient(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return cachedClient
}

/**
 * Lower-level escape hatch for raw GraphQL.
 * Most code should call the typed helpers in `queries.ts`.
 */
export async function rawQuery<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const client = await getClient()
  return client.request<T>(query, variables)
}
