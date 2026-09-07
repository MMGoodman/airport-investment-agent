/**
 * Driving the ElevenLabs agent by text, so its cases can be run like everyone else's.
 *
 * I SAID THIS COULD NOT BE DONE, AND HAD NOT CHECKED
 *
 * The claim was that their platform holds the conversation and drives the turn, so an
 * adapter would be a different shape of thing rather than a third entry in a list. Half of
 * that is true and the conclusion was wrong: their conversation socket takes
 * `{type:"user_message", text}` and answers with `agent_response`, and the six client tools
 * arrive as `client_tool_call` for this side to run and answer. Every piece needed is in the
 * protocol; nothing had to be invented.
 *
 * WHAT IT DOES AND DOES NOT MEASURE
 *
 * Text in, text out — the same limit the other two adapters carry, and it matters more here.
 * On the OpenAI paths the model hears audio and the transcript is a display, so driving by
 * text skips a stage that was never in the answer's way. On THIS path the transcriber IS
 * the input, so a text-driven run is the agent with its hardest problem removed. It measures
 * tool selection and phrasing. It says nothing about whether "בנגור" survives the microphone,
 * and a comparison that forgets this flatters the cascade.
 */
import WebSocket from 'ws'
import { runTool, toolSchemasFor } from '../src/agent/tools.js'

const API = process.env.EVAL_API ?? 'http://localhost:3001'

/** Long enough for a cascade that has been measured at seventeen seconds on one turn. */
const TURN_TIMEOUT_MS = 45_000

/**
 * @param opts.hybrid  the 8/8 agent rather than the 6/8 one
 * @param opts.lang    which language preset to open under
 */
export async function elevenlabs(turns, lang = 'he', opts = {}) {
  const started = Date.now()
  const agent = opts.hybrid ? 'hybrid' : 'direct'

  // The same signed URL the browser uses, minted by the same route, so the key stays on the
  // server and an eval cannot drift onto a different agent than the one you talk to.
  const res = await fetch(`${API}/api/voice/signed-url?lang=${lang}&agent=${agent}`)
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'could not mint a signed URL')

  const ws = new WebSocket(body.signedUrl)
  const send = (o) => ws.send(JSON.stringify(o))

  const toolCalls = []
  let lastTurnToolCalls = []
  let reply = ''

  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  // Which tools this agent expects THIS side to run. The placed ones are fetched by their
  // cloud from the server and never reach here, which is the whole point of that split.
  const clientTools = new Set(toolSchemasFor('browser').tools.map((t) => t.name))

  /** One question, answered. Resolves when the agent has finished its reply. */
  const ask = (text) =>
    new Promise((resolve, reject) => {
      lastTurnToolCalls = []
      let settled = false
      const done = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ws.off('message', onMessage)
        err ? reject(err) : resolve()
      }
      const timer = setTimeout(() => done(new Error('the agent did not answer in 45s')), TURN_TIMEOUT_MS)

      async function onMessage(raw) {
        let msg
        try {
          msg = JSON.parse(raw)
        } catch {
          return
        }

        if (msg.type === 'client_tool_call') {
          const call = msg.client_tool_call ?? {}
          const name = call.tool_name
          const args = call.parameters ?? {}
          try {
            // Run it here exactly as the browser would, against the same engine.
            const result = clientTools.has(name)
              ? await runTool(name, args)
              : { data: { error: 'not a client tool on this transport' }, meta: {} }
            const record = { tool: name, args, result }
            toolCalls.push(record)
            lastTurnToolCalls.push(record)
            send({
              type: 'client_tool_result',
              tool_call_id: call.tool_call_id,
              result: JSON.stringify(result),
              is_error: false,
            })
          } catch (err) {
            send({
              type: 'client_tool_result',
              tool_call_id: call.tool_call_id,
              result: String(err.message),
              is_error: true,
            })
          }
          return
        }

        /**
         * A tool their cloud ran, reported back rather than requested.
         *
         * The webhook tools never come through as client_tool_call — the server answered
         * them directly. They still belong in the record, or a case asserting that
         * get_airport_weather ran would fail on the one path where it demonstrably did.
         */
        if (msg.type === 'agent_tool_response') {
          const t = msg.agent_tool_response ?? {}
          /**
           * ONLY the ones this side did not run.
           *
           * A client tool arrives twice — once as the request to run it, once as the
           * platform reporting what came back — and recording both counted every call
           * twice. One case listed compare_airports three times for a single comparison,
           * which is the same double-entry bug the live trace had, in a new place.
           *
           * A webhook tool has no client_tool_call at all: their cloud fetched it from the
           * server directly. This is the only place it can be seen from here, which is why
           * the branch exists.
           */
          /**
           * NAME ONLY. THE ARGUMENTS ARE NOT IN THIS MESSAGE.
           *
           * This read `t.tool_details ?? {}` and `tool_details` is not a field ElevenLabs
           * sends. Dumped in full, an agent_tool_response carries exactly:
           *
           *   tool_name, tool_call_id, tool_type, is_error, is_blocked, event_id,
           *   is_called, status
           *
           * — and nothing else, for a webhook tool or a client one. So every server-run
           * call was recorded as `args: {}`, which is not "unknown", it is the false claim
           * that the tool was called with no arguments. A case asserting
           * `expectArgs: {iata: 'SJU'}` failed against a run that had demonstrably passed
           * SJU: the agent was right, the record was wrong, and the eval blamed the agent.
           *
           * The arguments do exist — their cloud POSTed them to the webhook server, which
           * is the only place they can be seen. Correlating the two would need the
           * conversation id that server already receives and currently fails to read.
           * Until then this omits `args` rather than inventing one, so an assertion about
           * arguments fails as unmeasured instead of passing on a fiction.
           */
          if (t.tool_name && !clientTools.has(t.tool_name)) {
            const record = { tool: t.tool_name, ranOn: 'server', argsUnreported: true }
            toolCalls.push(record)
            lastTurnToolCalls.push(record)
          }
          return
        }

        if (msg.type === 'agent_response') {
          reply = msg.agent_response_event?.agent_response ?? reply
          done()
        }
      }

      ws.on('message', onMessage)
      ws.once('error', (err) => done(err))
      send({ type: 'user_message', text })
    })

  try {
    for (const turn of turns) await ask(turn)
  } finally {
    ws.close()
  }

  return { reply, toolCalls, lastTurnToolCalls, ms: Date.now() - started }
}
