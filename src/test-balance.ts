/**
 * Balance + recent transactions smoke test.
 *   npm run test:balance
 */
import './load-env.js'
import { getBalance, listTransactions, getTaxReserves } from './queries.js'

async function main() {
  console.log('--- Balance ---')
  const bal = await getBalance()
  console.log(JSON.stringify(bal, null, 2))

  console.log('\n--- Last 5 transactions ---')
  const { transactions } = await listTransactions({ limit: 5 })
  for (const t of transactions) {
    console.log(`  ${t.bookingDate ?? '?'.padEnd(10)} ${(t.amount / 100).toFixed(2).padStart(10)} EUR  ${t.name ?? '<no name>'}`)
  }

  console.log('\n--- Tax reserves ---')
  const r = await getTaxReserves()
  console.log(JSON.stringify(r, null, 2))
}

main().catch((err) => {
  console.error('❌ test failed:', err.message)
  process.exit(1)
})
