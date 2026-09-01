/**
 * A server-held record of what was said on a call.
 *
 * WHY THIS EXISTS
 *
 * The relayed transport gets this for free: the server is in the middle, so every
 * transcript passes through it. The direct WebRTC transport does not — audio and events go
 * browser-to-OpenAI, and until the sideband existed the only server-side record of a call
 * was its tool calls. "What did the agent tell the caller" was answerable from the browser
 * alone, which is the same class of gap that toolLog.js was written to close for tool
 * results: a record the client could edit is not a record.
 *
 * The sideband already receives every event on the session. It acted on exactly one of
 * them and dropped the rest. This keeps the two that matter.
 *
 * Deliberately not the whole event stream. A realtime session emits hundreds of deltas a
 * minute and almost none of them are worth keeping; what a reader or an auditor wants is
 * the turns. The raw feed stays where it is useful — in the browser, in the trace panel.
 */

/** Bounded, like the tool log. Enough for a long call several times over. */
const MAX_TURNS = 1000

const turns = []

const LOG_FILE = process.env.SESSION_LOG_FILE || null

/**
 * Record one spoken turn.
 *
 * `who` is 'caller' or 'agent'. The transcript for a caller is the transcriber's output,
 * which is a SECOND listener and not what the model heard — that distinction is worth
 * keeping visible, so it is stored under its own name rather than as "the question".
 */
export function recordTurn({ session, callId, who, text }) {
  if (!text?.trim()) return null
  const turn = {
    session: session || 'anonymous',
    callId: callId || null,
    at: new Date().toISOString(),
    who,
    text: text.trim(),
  }
  turns.push(turn)
  if (turns.length > MAX_TURNS) turns.shift()

  if (LOG_FILE) {
    // Fire and forget, same as the tool log: a record that cannot be written must not
    // interrupt the call it is recording.
    import('node:fs/promises')
      .then(({ appendFile }) => appendFile(LOG_FILE, `${JSON.stringify(turn)}\n`))
      .catch((err) => console.error('session log write failed:', err.message))
  }
  return turn
}

/** Everything recorded for one session, oldest first. */
export function turnsForSession(session) {
  return turns.filter((t) => t.session === session)
}

/** How many turns are held, for the health view and for tests. */
export const turnCount = () => turns.length
