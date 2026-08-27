/**
 * The one place the browser reaches the deterministic engine.
 *
 * Both live providers route their function calls through here, and it posts to
 * POST /api/tool — the endpoint that already existed for the demo. No scoring logic
 * crosses into the client; this is a pipe, and it records how long the pipe took.
 */
export async function callTool(name, args) {
  const started = performance.now()
  try {
    const res = await fetch('/api/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args: args ?? {} }),
    })
    const result = await res.json()
    return { tool: name, args: args ?? {}, result, ms: Math.round(performance.now() - started) }
  } catch (err) {
    return {
      tool: name,
      args: args ?? {},
      result: { data: { error: 'tool_transport_failed', message: err.message }, meta: {} },
      ms: Math.round(performance.now() - started),
      failed: true,
    }
  }
}

/** Arguments arrive as a JSON string from both providers, and can be empty. */
export function parseArgs(raw) {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
