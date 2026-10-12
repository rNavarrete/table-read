import { ApiError } from '../../api/errors'

const MESSAGES: Record<string, string> = {
  CONFLICT_STALE_HEAD:
    'The script changed while checking. Reload and try again.',
  SCHEMA_INVALID_LLM:
    'The check came back malformed twice. Nothing was saved; try again.',
  LLM_UNAVAILABLE:
    'The AI service is unavailable right now. Nothing was saved.',
  STRUCTURE_CHECK_NOT_READY: 'This script has no beats to check yet.',
}

/** Writer copy for a failed structure check (data contract §4 codes). */
export function structureErrorMessage(err: unknown): string {
  return (
    (err instanceof ApiError && MESSAGES[err.code]) ||
    'The check failed. Nothing was saved.'
  )
}
