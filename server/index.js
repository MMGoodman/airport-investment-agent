import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { runAgent } from '../src/agent/agent.js'
import { runTool } from '../src/agent/tools.js'
import { getStore } from '../src/data/store.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const PORT = process.env.PORT || 3001
const API_KEY = process.env.GEMINI_API_KEY
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'

// ASSUMPTION: the model provider is the Google Gemini free tier. The assignment names no
// provider; the LLM is confined to agent.js, so swapping it touches one file.
if (!API_KEY) {
  console.error(
    '\n  GEMINI_API_KEY is not set.\n' +
      '  Put your key from aistudio.google.com in .env, then restart the server.\n',
  )
}

app.get('/health', async (req, res) => {
  try {
    const store = await getStore()
    res.json({
      ok: true,
      model: MODEL,
      hasApiKey: Boolean(API_KEY),
      airports: store.airports.length,
      weightsVersion: store.weights.version,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: `${err.message} — run "npm run ingest" first.` })
  }
})

app.get('/api/airports', async (req, res) => {
  try {
    const store = await getStore()
    res.json(
      store.airports.map(({ iata, name, city, state, region }) => ({ iata, name, city, state, region })),
    )
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * Direct access to the scoring engine, no model in the path. This is the proof that the
 * ranking is deterministic: same query, same numbers, with the LLM switched off entirely.
 */
app.get('/api/rankings', async (req, res) => {
  const { region, state, topN, ...rest } = req.query
  const weightKeys = ['utilization', 'growth', 'unmetDemand', 'constraint']
  const weights = {}
  for (const k of weightKeys) if (rest[k] !== undefined) weights[k] = Number(rest[k])

  try {
    const result = await runTool('rank_airports', {
      region,
      state,
      topN: topN ? Number(topN) : undefined,
      weights: Object.keys(weights).length ? weights : undefined,
    })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/** Escape hatch for the demo: call any tool directly and see the raw structured result. */
app.post('/api/tool', async (req, res) => {
  const { name, args } = req.body ?? {}
  try {
    res.json(await runTool(name, args))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body ?? {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must be { messages: [{ role, content }] }' })
  }

  try {
    const { reply, trace, turns, usage } = await runAgent(messages, { apiKey: API_KEY })
    res.json({ reply, toolCalls: trace, turns, usage, model: MODEL })
  } catch (err) {
    // Fail loudly: surface the real status and message, never a fake answer.
    const status = err?.status ?? 500
    console.error('agent error:', status, err?.message)
    res.status(status).json({ error: err?.message ?? 'Unknown server error' })
  }
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}  (model: ${MODEL})`)
})
