import { describe, expect, it } from 'vitest'
import { llmUnavailableMessage, lockedObjectMessage } from './toastCopy'

describe('toastCopy', () => {
  it('exposes the UI-spec LLM_UNAVAILABLE and LOCKED_OBJECT strings', () => {
    expect(llmUnavailableMessage).toBe(
      'The language model is unavailable — try again in a moment',
    )
    expect(lockedObjectMessage).toBe(
      'A locked element was included — nothing was changed',
    )
  })
})
