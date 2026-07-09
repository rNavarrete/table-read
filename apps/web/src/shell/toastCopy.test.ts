import { describe, expect, it } from 'vitest'
import {
  llmUnavailableMessage,
  lockedObjectMessage,
  messageForApiError,
} from './toastCopy'

describe('toastCopy', () => {
  it('exposes the UI-spec LLM_UNAVAILABLE and LOCKED_OBJECT strings', () => {
    expect(llmUnavailableMessage).toBe(
      'The language model is unavailable — try again in a moment',
    )
    expect(lockedObjectMessage).toBe(
      'A locked element was included — nothing was changed',
    )
  })

  it('messageForApiError maps known codes and falls back otherwise', () => {
    expect(messageForApiError('LLM_UNAVAILABLE', 'ignored')).toBe(
      llmUnavailableMessage,
    )
    expect(messageForApiError('LOCKED_OBJECT', 'ignored')).toBe(
      lockedObjectMessage,
    )
    expect(messageForApiError('SCHEMA_INVALID_LLM', 'use this')).toBe(
      'use this',
    )
  })
})
