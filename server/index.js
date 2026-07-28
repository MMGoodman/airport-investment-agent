import 'dotenv/config'
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 3001

// ASSUMPTION: the SPEC calls for the Anthropic SDK. No API budget was available for this
// build, so the LLM layer runs on the Google Gemini free tier. Every call goes through
// callModel() below, so swapping the provider back is a change in one function.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
const API_KEY = process.env.GEMINI_API_KEY

const SYSTEM_PROMPT = `You are an analyst assistant for an investment firm that funds
US airport modernization projects. For now you are a plain chat shell: answer clearly and
briefly, and say plainly when you do not have the data to answer.`

if (!API_KEY) {
  console.error(
    '\n  GEMINI_API_KEY is not set.\n' +
      '  Put your key from aistudio.google.com in .env, then restart the server.\n',
  )
}

/** Fails loudly on any non-2xx: the caller sees the real status and body. */
async function callModel(messages) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY ?? '' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? JSON.stringify(data))
    err.status = res.status
    throw err
  }

  const candidate = data.candidates?.[0]
  return {
    reply: (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join(''),
    stopReason: candidate?.finishReason ?? null,
    usage: data.usageMetadata ?? null,
    model: MODEL,
  }
}

app.get('/health', (req, res) => {
  res.json({ ok: true, model: MODEL, hasApiKey: Boolean(API_KEY) })
})

/** Debug helper: which models this key can actually reach. */
app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models',
      { headers: { 'x-goog-api-key': API_KEY ?? '' } },
    )
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json(
      (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name),
    )
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body ?? {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must be { messages: [{ role, content }] }' })
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set in .env.' })
  }

  try {
    res.json(await callModel(messages))
  } catch (err) {
    // Fail loudly: surface the real status and message, never a fake answer.
    const status = err?.status ?? 500
    console.error('Gemini API error:', status, err?.message)
    res.status(status).json({ error: err?.message ?? 'Unknown server error' })
  }
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}  (model: ${MODEL})`)
})
