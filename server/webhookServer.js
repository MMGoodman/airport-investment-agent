/**
 * A second, deliberately tiny server: the only thing that ever faces the public internet.
 *
 * WHY NOT JUST TUNNEL PORT 3001
 *
 * Because of what is on it. The main server mints an OpenAI ephemeral key, an ElevenLabs
 * signed URL and a Soniox temporary key, all without authentication, because everything
 * reaching it comes from the browser on this machine. Put a tunnel in front of that and
 * anyone who finds the address is spending your money — realtime minutes, voice minutes,
 * Gemini quota — and can POST documents into the knowledge base while they are at it.
 *
 * A quick-tunnel hostname is random, which is a reason it is unlikely to be found and not a
 * reason it is safe: they get scanned, and "unlikely" is not a security property.
 *
 * So the webhook gets its own process on its own port, mounting exactly one route. Tunnel
 * THIS. What is published is then: two read-only lookups, behind a shared secret, refusing
 * every tool that is not server-placed. Nothing else is reachable because nothing else is
 * listening.
 *
 *   npm run webhook            # this, on WEBHOOK_PORT (default 3002)
 *   cloudflared tunnel --url http://localhost:3002
 */
import 'dotenv/config'
import express from 'express'
import { mountWebhookToolRoute, webhookHybridStatus } from './webhookTools.js'

const PORT = Number(process.env.WEBHOOK_PORT) || 3002

const app = express()
app.use(express.json({ limit: '256kb' }))

// A liveness check with nothing in it. Useful for confirming a tunnel is up without
// needing the secret, and it says nothing a caller could not already guess.
app.get('/health', (_req, res) => res.json({ ok: true, service: 'webhook-tools' }))

mountWebhookToolRoute(app)

// Anything else is not here. Said plainly rather than served a 404 page, so a misconfigured
// PUBLIC_BASE_URL pointing at the main server's paths fails with a readable reason.
app.use((req, res) =>
  res.status(404).json({
    error: `${req.method} ${req.path} is not on this server. It hosts the webhook tool route only.`,
  }),
)

const status = webhookHybridStatus()
app.listen(PORT, () => {
  console.log(`\n  webhook tool server on http://localhost:${PORT}`)
  console.log(`  ${status.enabled ? 'ready' : 'NOT READY'} — ${status.reason}`)
  if (!status.enabled) {
    console.log('\n  It will refuse every call until PUBLIC_BASE_URL and ELEVENLABS_WEBHOOK_SECRET are set.')
  }
  console.log(`\n  Expose it:  cloudflared tunnel --url http://localhost:${PORT}\n`)
})
