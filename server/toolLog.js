/**
 * A server-side record of every tool call the browser asked for.
 *
 * WHY THIS EXISTS
 *
 * On the live voice paths the model's function call arrives on the browser's data channel,
 * the browser runs it against POST /api/tool, and the browser hands the result back to the
 * model. The scoring engine is ours and the numbers are ours — but the trace shown under an
 * answer is assembled from what the CLIENT says happened, and a client is something a user
 * controls. "Every figure came from the engine" was, on those paths, a claim resting on the
 * browser being honest.
 *
 * The text path never had this gap: runAgent calls runTool in the same process, so nothing
 * can get between the two. That is why only /api/tool is recorded here — it is the only
 * loop that leaves the building.
 *
 * This closes it without changing the architecture. Every call is stamped server-side with
 * an id and a digest of the exact bytes returned; the client echoes those ids back and they
 * are checked against this record. A trace that claims a call we never ran, or a result we
 * never produced, no longer matches.
 *
 * Deliberately not a database. It is a bounded in-memory ring, plus an append-only JSONL
 * file when TOOL_LOG_FILE is set, which is what an audit trail needs to be readable as.
 */
import { createHash } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'

/** Enough to cover any single conversation several times over, and bounded. */
const MAX_ENTRIES = 500

const entries = []
let seq = 0

const LOG_FILE = process.env.TOOL_LOG_FILE || null

/**
 * Reload the trail on boot, so a restart does not turn history into a forgery.
 *
 * The ring is memory, and a server restart used to empty it while a browser kept its
 * session — the calls from before the restart were then absent from the record and the
 * panel reported them fabricated, in red, on a session that had done nothing wrong. That
 * is the worst failure mode an audit can have: crying wolf teaches people to ignore it.
 *
 * Only the tail is kept, matching the ring. A malformed line is skipped rather than
 * throwing: a truncated last write from a kill -9 must not stop the server from starting.
 */
async function restore() {
  if (!LOG_FILE) return
  try {
    const lines = (await readFile(LOG_FILE, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-MAX_ENTRIES)
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry?.callId) {
          entries.push(entry)
          const n = Number(String(entry.callId).replace(/^t/, ''))
          if (Number.isFinite(n) && n > seq) seq = n
        }
      } catch {
        /* a half-written line from an interrupted process */
      }
    }
    if (entries.length) console.log(`tool log: restored ${entries.length} entries from ${LOG_FILE}`)
  } catch (err) {
    // A missing file is the normal first run; anything else is worth seeing.
    if (err.code !== 'ENOENT') console.error('tool log restore failed:', err.message)
  }
}

await restore()

/** Short digest of the exact bytes handed back, so a substituted payload does not match. */
function digestOf(result) {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex').slice(0, 16)
}

/**
 * Record one execution. Returns the entry so the route can stamp its id onto the response.
 *
 * `args` is stored as received rather than normalised: the question this log answers is
 * "what was actually asked for", and normalising here would hide a client sending something
 * the engine then quietly repaired.
 */
/**
 * `ranOn` is who executed it, and it decides what the audit may accuse the client of.
 *
 * 'browser' — the page asked for it through POST /api/tool. It could have hidden the call
 *             from its own trace, so a missing claim is a finding.
 * 'server'  — this process ran it itself, over the relay or a sideband. The page never
 *             touched it and cannot be asked to account for it; treating those as hidden
 *             put a red "trace does not match the server log" on the first session where
 *             the hybrid worked exactly as designed.
 */
export function recordToolCall({ session, tool, args, result, ms, failed = false, ranOn = 'browser' }) {
  const entry = {
    callId: `t${++seq}`,
    ranOn,
    session: session || 'anonymous',
    at: new Date().toISOString(),
    tool,
    args: args ?? {},
    failed,
    ms,
    bytes: JSON.stringify(result).length,
    digest: digestOf(result),
  }

  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()

  if (LOG_FILE) {
    // Fire and forget: an audit line that cannot be written must not fail the tool call the
    // caller is waiting on. It is logged loudly instead.
    appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`).catch((err) =>
      console.error('tool log write failed:', err.message),
    )
  }

  return entry
}

/** Everything recorded for one session, oldest first. */
export function callsForSession(session) {
  return entries.filter((e) => e.session === session)
}

/**
 * The session most recently seen, for a caller that cannot name its own.
 *
 * ElevenLabs' webhook is the one path with no id of its own. Their docs say a tool's headers
 * may carry {{system__conversation_id}}; measured, they do not — the header arrives with the
 * placeholder still in it, and two weather calls were filed under the literal string
 * "{{system__conversation_id}}" while the browser's four sat correctly under the real
 * conversation id. So the call cannot say which conversation it belongs to.
 *
 * It can be inferred, because the browser adopted that same conversation id and is calling
 * this server throughout the same call. The most recent session with browser activity is the
 * one in progress.
 *
 * This is an inference and it has a limit worth stating plainly: with two callers at once it
 * can attribute a tool call to the wrong conversation. That is acceptable for a demo on one
 * laptop and is not acceptable in production — the right fix is an id ElevenLabs actually
 * substitutes, and this is here because the trace being empty is worse than the trace being
 * approximately right while it is one person talking.
 */
export function mostRecentSession() {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const s = entries[i].session
    if (s && s !== 'anonymous') return s
  }
  return null
}

/**
 * Compare what a client claims it ran against what this server actually ran.
 *
 * Three ways a claim can fail, and they are reported separately because they mean different
 * things: an id we never issued is a fabricated call, a digest that disagrees is a
 * substituted result, and a call we ran that the client did not show is a hidden one.
 */
export function reconcile(session, claimed = []) {
  const actual = callsForSession(session)
  const byId = new Map(actual.map((e) => [e.callId, e]))
  const claimedIds = new Set()

  const fabricated = []
  const altered = []

  for (const c of claimed) {
    if (!c?.callId) continue
    claimedIds.add(c.callId)
    const match = byId.get(c.callId)
    if (!match) fabricated.push(c.callId)
    else if (c.digest && c.digest !== match.digest) altered.push(c.callId)
  }

  // Only what the client was responsible for can be missing from its account.
  const omitted = actual
    .filter((e) => e.ranOn !== 'server' && !claimedIds.has(e.callId))
    .map((e) => e.callId)
  const serverRun = actual.filter((e) => e.ranOn === 'server').length

  return {
    ok: fabricated.length === 0 && altered.length === 0 && omitted.length === 0,
    serverCalls: actual.length,
    // Reported, not hidden: a reader should be able to see that some calls never went
    // through the browser at all, which is the point of placing them on the server.
    serverRun,
    /**
     * The server-run calls themselves, so a trace can show them rather than only count them.
     *
     * A count is enough to prove nothing was hidden and not enough to read. A caller who
     * heard "31 degrees at Phoenix" wants the row that says get_airport_weather ran, with
     * its arguments and its timing, next to the calls the browser made — the promise is
     * that every figure can be traced to a call, and a number in a summary line is not that.
     */
    serverEntries: actual
      .filter((e) => e.ranOn === 'server')
      .map(({ callId, tool, args, ms, digest, failed }) => ({ callId, tool, args, ms, digest, failed })),
    claimedCalls: claimed.length,
    fabricated,
    altered,
    omitted,
  }
}
