/**
 * The tool-calling loop.
 *
 * The model gets the tool declarations and the conversation; when it asks for a tool we run
 * the deterministic handler and hand the result back. Every tool call and result is recorded
 * in `trace` so the UI can show exactly which figures the answer was built from — that trace
 * is what makes "the model never computes a number" verifiable rather than a claim.
 */
import { runTool, toolSchemas } from './tools.js'
import { SYSTEM_PROMPT } from './prompt.js'

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const MAX_TURNS = 6

/** Gemini rejects an empty parameter object, so no-argument tools declare none. */
const functionDeclarations = toolSchemas.map((t) => {
  const decl = { name: t.name, description: t.description }
  if (t.parameters && Object.keys(t.parameters.properties ?? {}).length > 0) {
    decl.parameters = t.parameters
  }
  return decl
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The free tier allows only a handful of requests a minute, and a multi-tool answer
 *  spends several. Google returns the wait it wants; honour it instead of failing. */
function retryDelayMs(payload) {
  const detail = payload?.error?.details?.find((d) => d['@type']?.includes('RetryInfo'))
  const fromDetail = Number(String(detail?.retryDelay ?? '').replace('s', ''))
  if (Number.isFinite(fromDetail) && fromDetail > 0) return Math.ceil(fromDetail * 1000)

  const fromMessage = String(payload?.error?.message ?? '').match(/retry in ([\d.]+)s/i)
  return fromMessage ? Math.ceil(Number(fromMessage[1]) * 1000) : 20_000
}

async function callModel(contents, apiKey, attempt = 1) {
  const MAX_ATTEMPTS = 3

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: [{ functionDeclarations }],
    }),
  })

  const data = await res.json()

  if (res.status === 429 && attempt < MAX_ATTEMPTS) {
    const wait = Math.min(retryDelayMs(data), 30_000)
    console.warn(`  rate limited, waiting ${Math.round(wait / 1000)}s (attempt ${attempt})`)
    await sleep(wait + 500)
    return callModel(contents, apiKey, attempt + 1)
  }

  if (!res.ok) {
    const err = new Error(data?.error?.message ?? JSON.stringify(data))
    err.status = res.status
    throw err
  }
  return data
}

/**
 * @param {{role: 'user'|'assistant', content: string}[]} messages conversation so far
 * @returns {{reply: string, trace: object[], turns: number}}
 */
export async function runAgent(messages, { apiKey } = {}) {
  if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY is not set in .env.'), { status: 500 })

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const trace = []

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const data = await callModel(contents, apiKey)
    const parts = data.candidates?.[0]?.content?.parts ?? []
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall)

    if (calls.length === 0) {
      return {
        reply: parts.map((p) => p.text ?? '').join('').trim(),
        trace,
        turns: turn,
        usage: data.usageMetadata ?? null,
      }
    }

    // Echo the model's tool request back, then answer every call in one user turn.
    contents.push({ role: 'model', parts })

    const responseParts = []
    for (const call of calls) {
      const started = Date.now()
      const result = await runTool(call.name, call.args)
      trace.push({
        tool: call.name,
        args: call.args ?? {},
        ms: Date.now() - started,
        result,
      })
      responseParts.push({
        functionResponse: { name: call.name, response: result },
      })
    }

    contents.push({ role: 'user', parts: responseParts })
  }

  return {
    reply:
      'I could not finish this within the tool-call budget. Try asking about one airport or one region at a time.',
    trace,
    turns: MAX_TURNS,
    truncated: true,
  }
}
