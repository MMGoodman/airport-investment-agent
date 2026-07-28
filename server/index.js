import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 3001

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Put it in .env and restart the server.')
}

const anthropic = new Anthropic()

const SYSTEM_PROMPT = `You are an analyst assistant for an investment firm that funds
US airport modernization projects. For now you are a plain chat shell: answer clearly and
briefly, and say plainly when you do not have the data to answer.`

app.get('/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) })
})

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body ?? {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must be { messages: [{ role, content }] }' })
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: messages.map(({ role, content }) => ({ role, content })),
    })

    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')

    res.json({ reply, stopReason: response.stop_reason, usage: response.usage })
  } catch (err) {
    // Fail loudly: surface the real status and message, never a fake answer.
    const status = err?.status ?? 500
    console.error('Anthropic API error:', status, err?.message)
    res.status(status).json({ error: err?.message ?? 'Unknown server error' })
  }
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})
