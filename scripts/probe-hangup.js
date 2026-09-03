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
  { say: 'ביי, להתראות.', end: true, note: 'an actual goodbye' },
  { say: 'סיימתי, תודה. אפשר לנתק.', end: true, note: 'explicitly asking to end' },
]

/** One exchange on a fresh session, reporting only whether end_call was reached for. */
async function runOne({ say }) {
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
          // The first answer is out. Now say the thing under test.
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

console.log(`\n  Probing ${MODEL} with the session the server actually mints.\n`)

let failures = 0
for (const testCase of CASES) {
  try {
    const { endCalled, reply } = await runOne(testCase)
    const ok = endCalled === testCase.end
    if (!ok) failures += 1
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  "${testCase.say}"\n` +
        `        ${testCase.note} — expected ${testCase.end ? 'end_call' : 'no end_call'}, ` +
        `got ${endCalled ? 'end_call' : 'none'}` +
        (reply ? `\n        said: ${reply.slice(0, 110)}` : ''),
    )
  } catch (err) {
    failures += 1
    console.log(`  ERROR "${testCase.say}" — ${err.message}`)
  }
}

console.log(
  failures === 0
    ? '\n  All six behaved. The rule is in hand before the decision it governs.\n'
    : `\n  ${failures} of ${CASES.length} did not.\n`,
)
process.exit(failures === 0 ? 0 : 1)
