import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 3001
const PLACEHOLDER = 'your-key-here'

// ASSUMPTION: the SPEC calls for the Anthropic SDK. No API budget was available for this
// build, so the default provider is Google Gemini, which has a free tier. The provider is
// a single swappable layer — set LLM_PROVIDER=anthropic once a key exists. Document this
// in docs/DESIGN.md under assumptions.
const PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase()
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5'

const SYSTEM_PROMPT = `You are an analyst assistant for an investment firm that funds
US airport modernization projects. For now you are a plain chat shell: answer clearly and
briefly, and say plainly when you do not have the data to answer.`

function keyFor(provider) {
  const raw =
    provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY
  return raw && raw !== PLACEHOLDER ? raw : null
}

if (!keyFor(PROVIDER)) {
  const name = PROVIDER === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'
  console.error(
    `\n  ${name} is missing or still the placeholder.\n` +
      '  Open .env, paste the real key, then restart the server.\n',
  )
}

/** Fails loudly on any non-2xx: the caller sees the real status and body. */
async function callGemini(messages) {
  const apiKey = keyFor('gemini')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey ?? '' },
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
  const reply = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')

  return {
    reply,
    stopReason: candidate?.finishReason ?? null,
    usage: data.usageMetadata ?? null,
    model: GEMINI_MODEL,
  }
}

async function callAnthropic(messages) {
  const anthropic = new Anthropic({ apiKey: keyFor('anthropic') ?? undefined })

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages,
  })

  return {
    reply: response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(''),
    stopReason: response.stop_reason,
    usage: response.usage,
    model: ANTHROPIC_MODEL,
  }
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    model: PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : GEMINI_MODEL,
    hasApiKey: Boolean(keyFor(PROVIDER)),
  })
})

/** Debug helper: which Gemini models the key can actually reach. */
app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models',
      { headers: { 'x-goog-api-key': keyFor('gemini') ?? '' } },
    )
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    res.json((data.models ?? []).map((m) => m.name))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body ?? {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must be { messages: [{ role, content }] }' })
  }

  if (!keyFor(PROVIDER)) {
    const name = PROVIDER === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'
    return res.status(500).json({ error: `${name} is not set in .env (or is still the placeholder).` })
  }

  try {
    const result =
      PROVIDER === 'anthropic'
        ? await callAnthropic(messages.map(({ role, content }) => ({ role, content })))
        : await callGemini(messages)
    res.json(result)
  } catch (err) {
    // Fail loudly: surface the real status and message, never a fake answer.
    const status = err?.status ?? 500
    console.error(`${PROVIDER} API error:`, status, err?.message)
    res.status(status).json({ error: err?.message ?? 'Unknown server error' })
  }
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}  (provider: ${PROVIDER})`)
})
