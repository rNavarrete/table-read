// Data contract §4 error envelope: `{error: {code, message, details?}}`
// (apps/api/errors.py). One shared shape for both plain JSON responses and
// the SSE transport's initial-connect failures (write/api/sse.ts).

export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}

function isErrorEnvelope(body: unknown): body is { error: ApiErrorBody } {
  if (typeof body !== 'object' || body === null || !('error' in body))
    return false
  const error = (body as { error?: unknown }).error
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error
  )
}

/**
 * Builds an `ApiError` from a non-OK `Response`. Falls back to a generic
 * `UNKNOWN` code when the body isn't the contract's envelope (e.g. a bare
 * 502 from the dev proxy if the api process isn't up) — every caller can
 * still rely on `.status`/`.message` either way.
 */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // non-JSON body (e.g. a proxy error page) — fall through to the generic case
  }
  if (isErrorEnvelope(body)) {
    return new ApiError(response.status, body.error)
  }
  return new ApiError(response.status, {
    code: 'UNKNOWN',
    message: `request failed with status ${response.status}`,
  })
}
