/**
 * A second connection to a WebRTC session, held by this server.
 *
 * WHY THIS EXISTS
 *
 * The direct path is fast because the browser holds the peer connection: audio goes
 * browser-to-OpenAI with nothing in between. The cost had seemed to be that every tool call
 * arrives on the browser's data channel, so a tool the browser must not invoke could only be
 * withheld from that transport — which is what tools.js `placement` does, and what the caller
 * hears as "that needs the relayed line".
 *
 * That trade is not necessary. A Realtime session accepts TWO connections: the client's
 * WebRTC peer connection, and a WebSocket from an application server addressed by call id.
 * OpenAI calls it a sideband control channel. Both see the session; either can answer a tool
 * call. So the audio can stay on the fast path while a sensitive tool is executed here,
 * against this server's credentials, with the browser never invoking it.
 *
 *   browser  ──WebRTC (audio + the tools it owns)──▶  OpenAI
 *   server   ──WebSocket ?call_id=rtc_…────────────▶  OpenAI      (this file)
 *
 * WHAT THIS CHANGES AND WHAT IT DOES NOT
 *
 * The browser no longer runs the server-placed tools, and POST /api/tool still refuses them,
 * so there is no browser-originated call to one anywhere. What it does NOT do is hide the
 * exchange: both connections are on one session, so the browser can still observe that the
 * call happened and see the result the model was given. If a result must not reach the
 * client at all, the session itself has to live on the server — that is relay.js, and it
 * costs four to five times the latency.
 *
 * The division of labour is fixed and one-directional: this side answers a function call
 * ONLY for a tool marked placement:'server'. Anything else belongs to the browser, and both
 * sides answering would create two function_call_output items for one call_id.
 */
import { WebSocket } from 'ws'
import { runTool, placementOf, toolSchemasFor } from '../src/agent/tools.js'
import { recordToolCall } from './toolLog.js'

const UPSTREAM = 'wss://api.openai.com/v1/realtime'

/**
 * Live sidebands by call id.
 *
 * A browser that reloads mid-call leaves its peer connection to be torn down by OpenAI, and
 * the socket here closes with it. The map exists so a second attach for the same call is a
 * no-op rather than a duplicate answerer.
 */
const attached = new Map()

/** Tools this side is responsible for. The browser must not run these, and does not. */
const serverTools = () =>
  toolSchemasFor('relay').tools.filter((t) => placementOf(t.name) === 'server')

/**
 * Attach to a live WebRTC session and take over its server-placed tools.
 *
 * Returns as soon as the socket is open and the tools have been declared, so the caller can
 * tell the browser the sideband is live rather than leaving it to guess.
 */
export function attachSideband({ callId, session, ephemeralKey, onEvent = () => {} }) {
  if (attached.has(callId)) return attached.get(callId).ready

  const tools = serverTools()
  if (tools.length === 0) {
    // Nothing placed on the server, so there is nothing for this connection to do and
    // opening it would only add a second listener to somebody's call.
    return Promise.resolve({ attached: false, tools: [] })
  }

  /**
   * The EPHEMERAL key, not the account key.
   *
   * The account key is what mints the session and what relay.js connects with, so it was
   * the obvious thing to reach for here — and it is refused. The first live attempt came
   * back "refused after 5681ms — HTTP 404", which reads like a call id that does not exist
   * and is in fact an authentication failure wearing the wrong status code. A sideband
   * joins a session that already belongs to a client secret, and it has to present that
   * secret to be let in.
   */
  const ws = new WebSocket(`${UPSTREAM}?call_id=${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${ephemeralKey}` },
  })

  const entry = { ws, callId }
  attached.set(callId, entry)

  const send = (event) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
  }

  const openedAt = Date.now()
  const since = () => `${Date.now() - openedAt}ms`

  entry.ready = new Promise((resolve, reject) => {
    const fail = (err) => {
      attached.delete(callId)
      reject(err)
    }

    /**
     * Say what happened, on the server, where the answer actually is.
     *
     * The first live attempt timed out at the browser's four-second deadline with nothing
     * to show for it: a client-side timeout says only that no answer arrived, never why. A
     * handshake that stalls, one refused with a status, and one that opens and is closed
     * again are three different faults with one symptom.
     */
    ws.once('unexpected-response', (_req, res) => {
      console.log(`sideband ${callId}: refused after ${since()} — HTTP ${res.statusCode}`)
      fail(new Error(`OpenAI refused the sideband: HTTP ${res.statusCode}`))
    })

    ws.once('error', (err) => {
      console.log(`sideband ${callId}: error after ${since()} — ${err.message}`)
      fail(new Error(`sideband could not attach: ${err.message}`))
    })

    ws.once('close', (code, reason) => {
      console.log(`sideband ${callId}: closed after ${since()} — ${code} ${reason?.toString() ?? ''}`)
    })

    ws.once('open', () => {
      console.log(`sideband ${callId}: open after ${since()}`)
      /**
       * Add the tools to the session the browser is already talking on.
       *
       * The session was minted without them precisely so the browser could not be handed
       * one. Declaring them here is what makes the capability exist for the model, and the
       * ordering matters: until this lands, the model would say the tool is unavailable,
       * which is the honest answer for the moments before it is true.
       */
      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          tools: tools.map((t) => ({
            type: 'function',
            name: t.name,
            description: t.description,
            parameters:
              t.parameters && Object.keys(t.parameters.properties ?? {}).length > 0
                ? t.parameters
                : { type: 'object', properties: {} },
          })),
        },
      })
      console.log(`sideband ${callId}: declared ${tools.map((t) => t.name).join(', ')}`)
      resolve({ attached: true, tools: tools.map((t) => t.name) })
    })
  })

  ws.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type !== 'response.function_call_arguments.done') return

    /**
     * Answer only what belongs to this side.
     *
     * The browser is on the same session and answers its own tools. If both answered, one
     * call_id would receive two function_call_output items and the conversation item list
     * would be malformed for every later turn.
     */
    if (placementOf(msg.name) !== 'server') return

    let args = {}
    try {
      args = msg.arguments ? JSON.parse(msg.arguments) : {}
    } catch {
      // Malformed arguments still need an output, or the function call is left dangling.
    }

    const started = Date.now()
    let result
    try {
      result = await runTool(msg.name, args)
    } catch (err) {
      result = { data: { error: err.message } }
    }
    const ms = Date.now() - started

    // Same record as every other path, so a session's tool calls reconcile as one set
    // whichever side of the connection ran them.
    const entryLog = recordToolCall({
      session,
      tool: msg.name,
      args,
      result,
      ms,
      failed: Boolean(result?.data?.error),
    })

    send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: msg.call_id,
        output: JSON.stringify(result),
      },
    })
    // A function call ends the response, so the model is not waiting — it has to be asked
    // for the answer that uses the result.
    send({ type: 'response.create' })

    console.log(`sideband ${callId}: ran ${msg.name} in ${ms}ms → ${entryLog.callId}`)
    onEvent({ tool: msg.name, args, ms, callId: entryLog.callId, digest: entryLog.digest })
  })

  const done = () => attached.delete(callId)
  ws.on('close', done)
  ws.on('error', done)

  return entry.ready
}

/** Close a sideband early — the browser hanging up does not always close it upstream. */
export function detachSideband(callId) {
  const entry = attached.get(callId)
  if (!entry) return false
  try {
    entry.ws.close()
  } catch {
    /* already gone */
  }
  attached.delete(callId)
  return true
}

/** Which calls this server is currently sitting on, for the health view and for tests. */
export const sidebandCount = () => attached.size
