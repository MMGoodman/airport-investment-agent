/**
 * Does the agent hang up on things that are not goodbyes?
 *
 * Four premature end_calls happened before the cause was found: call-control was a lazily
 * loaded skill, so the rule against hanging up arrived as a consequence of hanging up. This
 * checks the fix on the actual model, with the actual session, without a microphone.
 *
 * WHY IT DOES NOT USE eval/adapters.js
 *
 * That adapter builds its own instructions — SYSTEM_PROMPT + VOICE_ADDENDUM — which is what
 * the live path used to send and no longer does. Testing against it would have reported the
 * fix working or failing for a prompt nobody runs. This asks the server for the session it
 * would actually mint, and drives that.
 *
 *   node scripts/probe-hangup.js
 */
import 'dotenv/config'
import { WebSocket } from 'ws'
import { toolSchemas } from '../src/agent/tools.js'

const API = process.env.PROBE_API || 'http://localhost:3001'
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'

/**
 * The four utterances that ended a call they should not have, and two that should.
 *
 * Every one of the first four is real, transcribed from a live session. "שדה תעופה" is two
 * words a caller said in the middle of a conversation; the last is a turn where the
 * transcript recorded nothing at all and the agent said goodbye anyway.
 */
const CASES = [
  { say: 'אה, תודה רבה.', end: false, note: 'a bare thank-you after an answer' },
  { say: 'אוקיי, מגניב. אממ, טוב, תודה רבה לך.', end: false, note: 'thanks, with filler' },
  { say: 'שדה תעופה.', end: false, note: 'two words, mid-conversation' },
  { say: 'אוקיי.', end: false, note: 'an acknowledgement' },
  {
    // The one the first version of this probe missed: "תודה רבה" on its own passed, and the
    // same words after a frustrated remark ended the call. Two reasons to stay, read as one
    // to leave.
    before: 'יאו, אתה דפוק לגמרי.',
    say: 'תודה רבה.',
    end: false,
    note: 'thanks, right after being told the agent is useless',
  },
  { say: 'ביי, להתראות.', end: true, note: 'an actual goodbye' },
  { say: 'סיימתי, תודה. אפשר לנתק.', end: true, note: 'explicitly asking to end' },
]

/** One exchange on a fresh session, reporting only whether end_call was reached for. */
async function runOne({ say, before }) {
  const built = await (await fetch(`${API}/api/realtime/session?lang=he`)).json()
  if (!built.baseInstructions) throw new Error('the server did not return a session')

  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  })
  const send = (o) => ws.send(JSON.stringify(o))

  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  send({
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['text'],
      // Exactly what the browser is handed, eager skills included.
      instructions: built.baseInstructions,
      // The endpoint reports which tools this transport offers, by name; the schemas come
      // from the same list the placement is enforced from, so the probe cannot accidentally
      // hand the model a tool the browser would not have.
      tools: toolSchemas
        .filter((t) => built.toolNames.includes(t.name))
        .map((t) => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      tool_choice: 'auto',
    },
  })

  // A first exchange, so the "thank you" lands after an answer rather than opening the call —
  // which is the situation the rule is actually about.
  send({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'אילו שדות תעופה מועמדים חזקים להרחבה?' }],
    },
  })
  send({ type: 'response.create' })

  let stage = 'first'
  let endCalled = false
  let reply = ''

  await new Promise((resolve, reject) => {
    const done = setTimeout(() => resolve(), 60000)
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw)
      if (msg.type === 'error') return reject(new Error(msg.error?.message ?? 'realtime error'))

      if (msg.type === 'response.function_call_arguments.done') {
        if (stage === 'second' && msg.name === 'end_call') endCalled = true
        // Answer every tool call with something plausible so the conversation can continue.
        send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: msg.call_id,
            output: JSON.stringify({ data: { ok: true }, meta: {} }),
          },
        })
      }

      if (msg.type === 'response.done') {
        if (stage === 'first') {
          // The first answer is out. Some cases need a turn of context before the line under
          // test — an insult, say — because the rule reads them together.
          stage = before ? 'context' : 'second'
          send({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: before ?? say }],
            },
          })
          send({ type: 'response.create' })
          return
        }
        if (stage === 'context') {
          stage = 'second'
          send({
            type: 'conversation.item.create',
            item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: say }] },
          })
          send({ type: 'response.create' })
          return
        }
        if (stage === 'second') {
          reply = (msg.response?.output ?? [])
            .flatMap((o) => o.content ?? [])
            .map((c) => c.text ?? c.transcript ?? '')
            .join(' ')
            .trim()
          // A tool call ends a response; the reply comes on the next one. Wait for it unless
          // end_call has already told us what we came to find out.
          if (!endCalled && !reply) return
          clearTimeout(done)
          resolve()
        }
      }
    })
    ws.once('error', reject)
  })

  ws.close()
  return { endCalled, reply }
}

/**
 * Each case several times, because one run is not an answer.
 *
 * The first version ran everything once and printed PASS or FAIL. Then a case that had
 * passed failed on the next run with nothing changed — which is what a sampled model does,
 * and which means the single pass had never proved anything. It was an instrument reporting
 * a probability as though it were a property.
 *
 * Three tells "reliably" from "sometimes" and is cheap enough to run after a prompt change.
 * It is not enough to call 3/3 a guarantee, and the summary says so rather than implying it.
 */
const RUNS = Number(process.env.PROBE_RUNS) || 3

console.log(`\n  Probing ${MODEL} with the session the server mints — ${RUNS} runs each.\n`)

let wrong = 0
for (const testCase of CASES) {
  const outcomes = []
  for (let i = 0; i < RUNS; i += 1) {
    try {
      const { endCalled, reply } = await runOne(testCase)
      outcomes.push({ ok: endCalled === testCase.end, reply })
    } catch (err) {
      outcomes.push({ ok: false, error: err.message })
    }
  }

  const good = outcomes.filter((o) => o.ok).length
  if (good < RUNS) wrong += 1
  // FLAKY is the interesting verdict: the rule is present and losing, not absent.
  const mark = good === RUNS ? 'PASS' : good === 0 ? 'FAIL' : 'FLAKY'
  const sample = outcomes.find((o) => o.reply)?.reply
  const failed = outcomes.find((o) => o.error)

  console.log(
    `  ${mark.padEnd(5)} ${good}/${RUNS}  "${testCase.say}"\n` +
      `        ${testCase.note} — expected ${testCase.end ? 'end_call' : 'no end_call'}` +
      (sample ? `\n        said: ${sample.slice(0, 100)}` : '') +
      (failed ? `\n        error: ${failed.error}` : ''),
  )
}

console.log(
  wrong === 0
    ? `\n  Every case held across all ${RUNS} runs. Not a guarantee — a sampled model can still\n  surprise you — but the rule is reaching it before the decision it governs.\n`
    : `\n  ${wrong} of ${CASES.length} did not hold across ${RUNS} runs.\n`,
)
process.exit(wrong === 0 ? 0 : 1)
