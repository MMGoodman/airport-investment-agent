import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { runAgent } from '../src/agent/agent.js'
import { runTool, placementOf } from '../src/agent/tools.js'
import { getStore } from '../src/data/store.js'
import { describeUpstreamError } from '../src/upstreamError.js'
import { mountWebhookToolRoute } from './webhookTools.js'
import { mountTagRoutes } from './tags.js'
import { mountVoiceRoutes } from './voice.js'
import { recordToolCall, callsForSession, reconcile, mostRecentSession } from './toolLog.js'
import { attachRelay } from './relay.js'
import { createServer } from 'node:http'

const app = express()
// The audit headers are custom, so a cross-origin caller cannot read them unless they are
// named here. Same-origin (the Vite proxy in dev) never needed it; a deployed split origin
// would have failed the reconciliation silently, which is the worst way for it to fail.
app.use(cors({ exposedHeaders: ['x-tool-call-id', 'x-tool-digest'] }))
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

// Live-voice transports. Same prompt, same tools, same scoring engine — only the pipe differs.
mountVoiceRoutes(app)

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

/**
 * Which models this key can actually reach. Free-tier quota is per model and per day, so a
 * chat that returns 429 while /api/rankings still works means this model is exhausted, not
 * that the app is broken — pick another name from here, set GEMINI_MODEL, restart.
 */
app.get('/api/models', async (req, res) => {
  if (!API_KEY) return res.status(400).json({ error: 'GEMINI_API_KEY is not set.' })
  try {
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': API_KEY },
    })
    const payload = await upstream.json()
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: payload?.error?.message ?? 'Model list failed' })
    }
    const usable = (payload.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .sort()
    res.json({
      current: MODEL,
      // Cheap, tool-calling-capable models are the realistic swaps; the rest are listed after.
      suggested: usable.filter((name) => /flash/.test(name) && !/thinking|image|audio|tts/.test(name)),
      all: usable,
    })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/airports', async (req, res) => {
  try {
    const store = await getStore()
    res.json(
      store.airports.map(({ iata, name, city, state, region }) => ({ iata, name, city, state, region })),
    )
  } catch (err) {
    res.status(500).json({ error: describeUpstreamError(err, 'the airport dataset') })
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
    res.status(500).json({ error: describeUpstreamError(err, 'the scoring engine') })
  }
})

/**
 * The tool endpoint, and the only loop that leaves this process.
 *
 * Every call is recorded before the result goes out, and the entry's id and digest ride
 * back on headers rather than in the body — the body is read verbatim into the model's
 * context, and audit metadata does not belong there costing tokens and inviting the model
 * to narrate it.
 */
mountWebhookToolRoute(app)
mountTagRoutes(app)

app.post('/api/tool', async (req, res) => {
  const { name, args } = req.body ?? {}
  const session = req.get('x-session-id') || null
  const started = Date.now()

  /**
   * A tool placed on the server is refused here, for every caller, always.
   *
   * This endpoint is how the browser reaches the engine on the WebRTC path, so "the browser
   * must not run this" and "this endpoint must not run this" are the same sentence. The
   * refusal is what makes the placement real: without it the tool would simply be absent
   * from one tool list and still one POST away.
   *
   * It is not offered on that transport either, so a model on the direct line cannot ask
   * for it — this catches anything that reaches the endpoint by another route.
   */
  if (placementOf(name) === 'server') {
    return res.status(403).json({
      error: `${name} runs only where the server holds the session. It is not reachable from a browser.`,
    })
  }

  try {
    const result = await runTool(name, args)
    const entry = recordToolCall({
      session,
      tool: name,
      args,
      result,
      ms: Date.now() - started,
      failed: Boolean(result?.data?.error),
    })
    res.setHeader('x-tool-call-id', entry.callId)
    res.setHeader('x-tool-digest', entry.digest)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: describeUpstreamError(err, 'the tool') })
  }
})

/**
 * What this server actually ran for a session, and whether the client's account of it
 * agrees. POST a claimed trace to check it; GET to just read the record.
 */
/**
 * A tool call this process did not run, reported by the webhook server.
 *
 * Recorded as ranOn: 'server', exactly as the OpenAI sideband records its own — so the
 * audit treats it the same way: counted in serverRun, and never accused of being a call
 * the browser hid, because the browser was never in a position to make it.
 *
 * Localhost only in practice: this port is not the one behind the tunnel. It is unguarded
 * for the same reason the rest of this file is, and it belongs in the same fix.
 */
app.post('/api/tool-log/external', (req, res) => {
  const { session, tool, args, result, ms, failed } = req.body ?? {}
  if (!tool) return res.status(400).json({ error: 'Body must name a tool.' })
  // No id of its own means the live conversation, not a session called nothing. See
  // mostRecentSession for what that inference costs.
  const attributed = session || mostRecentSession()
  const entry = recordToolCall({
    session: attributed,
    tool,
    args,
    result,
    ms,
    failed,
    ranOn: 'server',
  })
  res.json({ callId: entry.callId, session: attributed, inferred: !session })
})

app.get('/api/tool-log', (req, res) => {
  const session = req.query.session
  if (!session) return res.status(400).json({ error: 'Pass ?session=<id>' })
  res.json({ session, calls: callsForSession(session) })
})

app.post('/api/tool-log/reconcile', (req, res) => {
  const { session, claimed } = req.body ?? {}
  if (!session) return res.status(400).json({ error: 'Body must be { session, claimed: [] }' })
  res.json(reconcile(session, Array.isArray(claimed) ? claimed : []))
})

app.post('/api/chat', async (req, res) => {
  const { messages, lang } = req.body ?? {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Body must be { messages: [{ role, content }] }' })
  }

  try {
    const { reply, trace, turns, usage } = await runAgent(messages, { apiKey: API_KEY, lang: lang === 'he' ? 'he' : 'en' })
    res.json({ reply, toolCalls: trace, turns, usage, model: MODEL })
  } catch (err) {
    // Fail loudly: surface the real status and message, never a fake answer.
    const status = err?.status ?? 500
    console.error('agent error:', status, err?.message)
    res.status(status).json({ error: describeUpstreamError(err, 'the model') })
  }
})

// A plain http server rather than app.listen, so the realtime relay can take WebSocket
// upgrades on the same port the HTTP API answers on.
const server = createServer(app)
attachRelay(server)
server.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}  (model: ${MODEL})`)
})
