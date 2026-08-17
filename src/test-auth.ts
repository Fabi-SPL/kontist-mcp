/**
 * Quick auth smoke test. Run after filling in .env credentials:
 *   npm run test:auth
 *
 * Should print token info + viewer details.
 */
import './load-env.js'
import { whoAmI } from './auth.js'
import { getMe } from './queries.js'

async function main() {
  console.log('--- Step 1: token refresh ---')
  const auth = await whoAmI()
  console.log(JSON.stringify(auth, null, 2))

  console.log('\n--- Step 2: viewer query ---')
  const me = await getMe()
  console.log(JSON.stringify(me, null, 2))

  console.log('\n✅ auth + query both work')
}

main().catch((err) => {
  console.error('❌ auth test failed:', err.message)
  process.exit(1)
})
