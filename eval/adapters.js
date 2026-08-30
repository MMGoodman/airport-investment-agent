/**
 * One adapter per path. Each takes a list of user turns and returns the same shape:
 *
 *   { reply, toolCalls: [{tool, args, result}], lastTurnToolCalls, ms }
 *
 * so the assertions do not care which model produced the answer. That symmetry is the
 * point of the exercise: the three paths are only comparable if they are measured the
 * same way.
 *
 * The live paths are driven by TEXT, not speech. Both accept text on the same session
 * they accept audio on, with the same prompt and the same tools, so this measures tool
 * selection and phrasing — the parts that can silently regress. It does not measure
 * speech recognition, and does not pretend to.
 */
import WebSocket from 'ws'
import { runTool, toolSchemas } from '../src/agent/tools.js'
import { SYSTEM_PROMPT, VOICE_ADDENDUM, languageInstruction } from '../src/agent/prompt.js'

const API = process.env.EVAL_API ?? 'http://localhost:3001'

/** The text path, over the HTTP endpoint the UI uses. */
export async function gemini(turns, lang = 'en') {
  const started = Date.now()
  const messages = []
  let reply = ''
  let toolCalls = []
  let lastTurnToolCalls = []

  for (const turn of turns) {
    messages.push({ role: 'user', content: turn })
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, lang }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? `chat returned ${res.status}`)

    reply = data.reply
    lastTurnToolCalls = data.toolCalls ?? []
    toolCalls = [...toolCalls, ...lastTurnToolCalls]
    messages.push({ role: 'assistant', content: reply })
  }

  return { reply, toolCalls, lastTurnToolCalls, ms: Date.now() - started }
}

/**
 * OpenAI Realtime over WebSocket rather than WebRTC — same session shape, same tools,
 * no browser and no audio. Output is forced to text so a run costs no synthesis.
 */
export async function openai(turns, lang = 'en') {
  const started = Date.now()
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set')

  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, {
    headers: { Authorization: `Bearer ${key}` },
  })

  const toolCalls = []
  let lastTurnToolCalls = []
  let reply = ''

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
      instructions: SYSTEM_PROMPT + VOICE_ADDENDUM + languageInstruction(lang),
      tools: toolSchemas.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters:
          t.parameters && Object.keys(t.parameters.properties ?? {}).length > 0
            ? t.parameters
            : { type: 'object', properties: {} },
      })),
      tool_choice: 'auto',
    },
  })

  /**
   * One user turn: ask, service every tool call, resolve when it has stopped talking.
   *
   * Not on the first completed response. A voice model fills the silence before a slow
   * tool — "let me pull that up" — and that preamble is a complete response with text and
   * no function call in it, indistinguishable from an answer by shape alone. Taking it as
   * the reply made a Hebrew case fail for dropping a caveat the model had not reached yet.
   *
   * So: accumulate every piece of prose in the turn and settle once the model has been
   * quiet for a beat. The preamble stays in the transcript, where it belongs, and the
   * answer that follows it is what gets asserted on.
   */
  const askOnce = (text) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for a reply')), 60_000)
      let text_ = ''
      let settle = null

      const quietFor = (ms) => {
        clearTimeout(settle)
        settle = setTimeout(() => {
          clearTimeout(timer)
          ws.off('message', onMessage)
          resolve(text_.trim())
        }, ms)
      }

      const onMessage = async (raw) => {
        const msg = JSON.parse(raw.toString())

        // Any activity means it has not finished thinking.
        if (msg.type.startsWith('response.') || msg.type.startsWith('conversation.')) {
          clearTimeout(settle)
        }

        if (msg.type === 'response.function_call_arguments.done') {
          const args = msg.arguments ? JSON.parse(msg.arguments) : {}
          const result = await runTool(msg.name, args)
          const record = { tool: msg.name, args, result }
          toolCalls.push(record)
          lastTurnToolCalls.push(record)
          send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: msg.call_id, output: JSON.stringify(result) },
          })
          send({ type: 'response.create' })
        }

        if (msg.type === 'response.output_text.done') text_ += `${msg.text ?? ''} `

        // Quiet after a completed response means the turn is genuinely over.
        if (msg.type === 'response.done' && text_.trim()) quietFor(1500)

        if (msg.type === 'error') {
          clearTimeout(timer)
          clearTimeout(settle)
          ws.off('message', onMessage)
          reject(new Error(msg.error?.message ?? 'realtime error'))
        }
      }

      ws.on('message', onMessage)
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      })
      send({ type: 'response.create' })
    })

  try {
    for (const turn of turns) {
      lastTurnToolCalls = []
      reply = await askOnce(turn)
    }
  } finally {
    ws.close()
  }

  return { reply, toolCalls, lastTurnToolCalls, ms: Date.now() - started }
}

export const adapters = { gemini, openai }
