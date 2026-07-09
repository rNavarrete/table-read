/** Shared toast copy for cross-cutting API errors (UI spec §7 / T6.2). */

export const llmUnavailableMessage =
  'The language model is unavailable — try again in a moment'

export const lockedObjectMessage =
  'A locked element was included — nothing was changed'

export function messageForApiError(code: string, fallback: string): string {
  switch (code) {
    case 'LLM_UNAVAILABLE':
      return llmUnavailableMessage
    case 'LOCKED_OBJECT':
      return lockedObjectMessage
    default:
      return fallback
  }
}
