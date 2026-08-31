/**
 * The one place the browser reaches the deterministic engine.
 *
 * Both live providers route their function calls through here, and it posts to
 * POST /api/tool — the endpoint that already existed for the demo. No scoring logic
 * crosses into the client; this is a pipe, and it records how long the pipe took.
 *
 * It also carries the session id out and the server's audit stamp back. The stamp is what
 * lets the trace under an answer be checked against the server's own record rather than
 * taken on the client's word — see server/toolLog.js for why that distinction matters on
 * the voice paths and not on the text one.
 */

/**
 * Which session these calls belong to. Module-level because exactly one live session runs
 * at a time and threading it through both provider adapters would buy nothing.
 */
let sessionId = null

export function setToolSession(id) {
  sessionId = id
}

/** The relay passes this to the server so its in-process tools land in the same log. */
export function getToolSession() {
  return sessionId
}

export async function callTool(name, args) {
  const started = performance.now()
  try {
    const res = await fetch('/api/tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'x-session-id': sessionId } : {}),
      },
      body: JSON.stringify({ name, args: args ?? {} }),
    })
    const result = await res.json()
    return {
      tool: name,
      args: args ?? {},
      result,
      ms: Math.round(performance.now() - started),
      // Absent when the response was not stamped — an older server, or a proxy that dropped
      // the headers. Recorded as absent rather than invented, so reconciliation can say
      // "unverified" instead of quietly passing.
      callId: res.headers.get('x-tool-call-id'),
      digest: res.headers.get('x-tool-digest'),
    }
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

/**
 * Ask the server whether its record of this session matches what we are about to show.
 *
 * Returns null when there is nothing to check or the check itself could not run — a failed
 * audit request is not a failed audit, and reporting it as one would cry wolf on every
 * dropped connection.
 */
export async function reconcileTools(claimed) {
  if (!sessionId || claimed.length === 0) return null
  try {
    const res = await fetch('/api/tool-log/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: sessionId,
        claimed: claimed.map(({ callId, digest }) => ({ callId, digest })),
      }),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
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
