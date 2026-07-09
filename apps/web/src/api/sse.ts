import { toApiError } from './errors'

export interface RawSseEvent {
  event: string
  data: unknown
}

/**
 * Parses a `text/event-stream` POST response into decoded frames. The api's
 * generation endpoints (data contract §4: `POST .../candidates`,
 * `POST .../candidates/tune`) are POST-with-a-JSON-body, which the browser's
 * native `EventSource` can't send (GET only) — this reads the same wire
 * format directly off `fetch`'s streamed body instead. One shared transport
 * for both endpoints; see write/candidateReducer.ts for how each interprets
 * the frames (obligation: "SSE client as a hook/module reusable by tune").
 *
 * Frames are `event: <name>\n` + `data: <json>\n\n` (apps/api/sse.py) — text
 * is decoded incrementally so a frame split across network chunks
 * reassembles before parsing.
 *
 * Throws `ApiError` if the connection itself never opens (non-2xx, or no
 * body). Once streaming has started, transport failures (a dropped
 * connection mid-stream) surface as a thrown plain `Error` from the `for
 * await` loop — callers translate both into the reducer's
 * `connection_error` pseudo-event (never emitted by the server itself).
 */
export async function* streamSse(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<RawSseEvent, void, void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok || !response.body) {
    throw await toApiError(response)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const parsed = parseFrame(frame)
        if (parsed) yield parsed
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseFrame(frame: string): RawSseEvent | null {
  let event: string | null = null
  let data: string | null = null
  for (const line of frame.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice('event: '.length)
    else if (line.startsWith('data: ')) data = line.slice('data: '.length)
  }
  if (event === null || data === null) return null
  return { event, data: JSON.parse(data) }
}
