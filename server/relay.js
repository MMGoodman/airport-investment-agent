/**
 * The server-side realtime transport — the architecture experiment.
 *
 * On the WebRTC path the browser holds the session: audio goes browser <-> OpenAI
 * directly, function calls land on the browser's data channel, and the browser posts them
 * to /api/tool. This path is the same session with the connection moved here:
 *
 *   browser mic ── ws ──> this server ── ws ──> OpenAI
 *   browser spk <── ws ── this server <── ws ── OpenAI
 *                              │
 *                              └── runTool, in this process — no HTTP, no client in the loop
 *
 * What it buys: a closed tool loop (nothing between the model's request and the engine),
 * and the shape telephony needs. What it costs: every audio frame makes one extra hop,
 * and the browser's WebRTC echo cancellation and jitter handling are gone. The point of
 * keeping both paths on ONE session config (buildRealtimeSession) is that a latency
 * comparison between them measures exactly that trade and nothing else.
 *
 * Audio format: PCM16 mono 24 kHz both ways — the realtime WebSocket default. The browser
 * sends raw Int16 frames as binary messages; OpenAI's base64 stays server-side.
 */
import { WebSocketServer, WebSocket } from 'ws'
import { buildRealtimeSession } from './voice.js'
import { runTool } from '../src/agent/tools.js'
import { recordToolCall } from './toolLog.js'

const UPSTREAM = 'wss://api.openai.com/v1/realtime'

export function attachRelay(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/api/relay' })

  wss.on('connection', async (client, req) => {
    if (!process.env.OPENAI_API_KEY) {
      client.close(1011, 'OPENAI_API_KEY is not set')
      return
    }

    const query = Object.fromEntries(new URL(req.url, 'http://relay').searchParams)
    // The browser's audit session id, so tools this relay runs land in the same log the
    // trace panel reconciles against. In-process calls cannot be tampered with, but a
    // trace that skips them would look emptier than the session was.
    const sessionId = query.session || null

    const tell = (obj) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(obj))
    }

    let built
    try {
      built = await buildRealtimeSession(query)
    } catch (err) {
      tell({ type: 'error', message: err.message })
      client.close()
      return
    }

    tell({ type: 'status', text: `turn detection: ${built.vadSummary}` })
    tell({ type: 'status', text: `vocabulary bias: ${built.useVocabulary ? 'on' : 'off'}` })

    const upstream = new WebSocket(`${UPSTREAM}?model=${encodeURIComponent(built.model)}`, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    })
    const up = (obj) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(obj))
    }

    // Same batching discipline as the browser transport (see src/live/openaiRealtime.js):
    // a response's tool calls are answered together at response.done, and a barge-in
    // drops the request to speak but never the outputs.
    let pendingCalls = []
    let bargedIn = false

    upstream.on('open', () => {
      // The model is fixed by the URL; session.update carries everything else.
      const { model: _model, ...sessionConfig } = built.session
      up({ type: 'session.update', session: sessionConfig })
    })

    upstream.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      // The agent's voice: decoded here, forwarded as binary. Base64 in the browser would
      // be decode work per frame for no benefit.
      if (msg.type === 'response.output_audio.delta') {
        if (client.readyState === WebSocket.OPEN) client.send(Buffer.from(msg.delta ?? '', 'base64'))
        return
      }

      tell({ type: 'event', event: msg.type })

      switch (msg.type) {
        case 'session.created':
          tell({ type: 'ready' })
          break

        case 'response.created':
          bargedIn = false
          tell({ type: 'responseStart' })
          break

        case 'input_audio_buffer.speech_started':
          bargedIn = true
          tell({ type: 'speaking', who: 'user' })
          break
        case 'input_audio_buffer.speech_stopped':
          tell({ type: 'speaking', who: null })
          break

        case 'conversation.item.input_audio_transcription.completed':
          if (msg.transcript?.trim()) tell({ type: 'userTranscript', text: msg.transcript.trim() })
          break

        case 'response.output_audio_transcript.delta':
          tell({ type: 'assistantDelta', text: msg.delta ?? '' })
          break
        case 'response.output_audio_transcript.done':
          tell({ type: 'assistantFinal', text: msg.transcript ?? '' })
          break

        case 'response.function_call_arguments.done': {
          let args = {}
          try {
            args = msg.arguments ? JSON.parse(msg.arguments) : {}
          } catch {
            args = {}
          }
          pendingCalls.push(
            (async () => {
              const started = Date.now()
              const result = await runTool(msg.name, args)
              const ms = Date.now() - started
              const entry = recordToolCall({
                session: sessionId,
                tool: msg.name,
                args,
                result,
                ms,
                failed: Boolean(result?.data?.error),
              })
              // The same record shape callTool produces, so the trace panel and the audit
              // treat both transports' tools identically.
              tell({
                type: 'tool',
                record: { tool: msg.name, args, result, ms, callId: entry.callId, digest: entry.digest },
              })
              return { callId: msg.call_id, result }
            })(),
          )
          break
        }

        case 'response.done': {
          if (pendingCalls.length === 0) break
          const batch = pendingCalls
          pendingCalls = []
          for (const { callId, result } of await Promise.all(batch)) {
            up({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
            })
          }
          if (!bargedIn) up({ type: 'response.create' })
          break
        }

        case 'error':
          tell({ type: 'error', message: msg.error?.message ?? 'Realtime error' })
          break
        default:
          break
      }
    })

    upstream.on('error', (err) => {
      tell({ type: 'error', message: `upstream: ${err.message}` })
      client.close()
    })
    upstream.on('close', () => client.close())

    client.on('message', (data, isBinary) => {
      // Binary is microphone audio, verbatim PCM16 frames. Everything else is control.
      if (isBinary) {
        up({ type: 'input_audio_buffer.append', audio: Buffer.from(data).toString('base64') })
        return
      }
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (msg.type === 'text' && msg.text) {
        up({
          type: 'conversation.item.create',
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: msg.text }] },
        })
        up({ type: 'response.create' })
      }
    })

    client.on('close', () => {
      try {
        upstream.close()
      } catch {
        /* already closed */
      }
    })
  })

  return wss
}
