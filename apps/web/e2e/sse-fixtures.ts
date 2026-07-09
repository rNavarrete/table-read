/** Builds an SSE response body (data contract §4 wire format:
 * `event: <name>\ndata: <json>\n\n`) for Playwright route interception —
 * used only by the error-state specs that need an outcome
 * `MockLlmClient`'s always-succeeds responses can't produce on their own
 * (see error-states.spec.ts). The happy-path specs never use this: they hit
 * the real api. */
export function sseBody(
  events: Array<{ event: string; data: unknown }>,
): string {
  return events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join('')
}
