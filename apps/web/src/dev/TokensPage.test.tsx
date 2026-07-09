import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EXPECTED_TOKENS } from '../styles/tokens.expected'
import TokensPage from './TokensPage'

// Drift guard for the /tokens accept criterion: TOKEN_GROUPS in TokensPage is
// hand-maintained, so a token added to tokens.css (and tokens.expected.ts)
// would otherwise silently never appear on the page. Rendering server-side
// keeps this in the default node test environment; resolvedValue() no-ops
// without a window, but every token's <code> label still renders.
describe('TokensPage', () => {
  const html = renderToStaticMarkup(<TokensPage />)

  it('renders a sample for every expected token', () => {
    for (const name of Object.keys(EXPECTED_TOKENS)) {
      // Token names are element text (<code>--tr-x</code>), so match with
      // tag boundaries — a bare substring check would let e.g. --tr-border
      // pass on the strength of --tr-border-strong.
      expect(html).toContain(`>${name}<`)
    }
  })
})
