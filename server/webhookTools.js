/**
 * The ElevenLabs hybrid: their cloud calls this server for the tools the browser may not run.
 *
 * WHY THIS IS A SECOND MECHANISM, NOT THE SAME ONE
 *
 * The OpenAI hybrid works by opening a SECOND connection to the same realtime session, from
 * here, and answering the placed tools on it. ElevenLabs has nothing like that — there is no
 * sideband, and for a long time the honest answer was that a server-placed tool simply could
 * not exist on that platform.
 *
 * That was wrong, and in an instructive way: the platform does support it, from the other
 * direction. A tool declared `type: "webhook"` is called by ELEVENLABS' backend over HTTP —
 * server to server, the browser never in the path. Same guarantee, opposite arrow.
 *
 *   OpenAI hybrid     our server  →  opens a second connection to the session
 *   ElevenLabs hybrid their cloud →  calls an endpoint on our server
 *
 * Worth having both precisely because they are different: one keeps every credential inside
 * a connection we opened, the other exposes an endpoint to the public internet. The second
 * is easier to build and strictly more exposed, and comparing them is the point.
 *
 * WHY IT IS OFF BY DEFAULT
 *
 * It needs a URL ElevenLabs can reach. On a laptop that means a tunnel, and requiring one to
 * run the project would be a bad trade for a feature nobody had asked for — which is why the
 * tools were registered as CLIENT tools originally, and that reasoning still holds when this
 * is unconfigured. Set both variables and the two placed tools move to the webhook; leave
 * them and the sync withholds exactly as it does today, and says so.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { placementOf, runTool, toolSchemas } from '../src/agent/tools.js'

const HEADER = 'x-tool-secret'
/**
 * ElevenLabs substitutes {{system__conversation_id}} at call time, which is the id that
 * crosses from their cloud to this server. The browser reads the same id off the SDK and
 * uses it as its session id, so both halves of the hybrid land in one log and the audit
 * can reconcile them as one set — the thing that was impossible an hour ago.
 */
const CONVERSATION_HEADER = 'x-conversation-id'

/** Where the main server keeps the tool log. Localhost: this is not the tunnelled port. */
const LOG_SINK = `http://localhost:${process.env.PORT || 3001}/api/tool-log/external`

/**
 * ElevenLabs' published static egress addresses — every outbound request they make, webhook
 * tools included, comes from one of these.
 *
 * All regions are listed rather than the one this account uses, because the wrong guess here
 * fails as "the tool silently stopped working" and the set is twelve addresses.
 *
 * WHAT THIS DOES AND DOES NOT COVER
 *
 * It answers "is this really ElevenLabs", which the shared secret cannot: a secret proves
 * whoever holds it, and it is stored in their dashboard, travels in a header on every call,
 * and would be replayable by anyone who ever saw one. The IP check is the second, independent
 * factor their own docs recommend pairing with it.
 *
 * It is NOT a signature. Their HMAC ElevenLabs-Signature exists for post-call webhooks; a
 * tool webhook, measured against the live platform, arrives with no elevenlabs-* header at
 * all — only Cloudflare's routing headers and the ones we configured. So there is nothing to
 * verify cryptographically here and this is what is available instead.
 */
const ELEVENLABS_EGRESS = [
  '34.67.146.145', '34.59.11.47',       // US (default)
  '35.204.38.71', '34.147.113.54',      // EU
  '35.185.187.110', '35.247.157.189',   // Asia
  '34.77.234.246', '34.140.184.144',    // EU residency
  '34.93.26.174', '34.93.252.69',       // India residency
  '34.87.23.17', '34.126.179.103',      // Singapore residency
]

const allowedIps = () => {
  const configured = (process.env.ELEVENLABS_ALLOWED_IPS || '').trim()
  if (configured === 'off') return null
  return new Set(configured ? configured.split(/[\s,]+/).filter(Boolean) : ELEVENLABS_EGRESS)
}

/**
 * Who actually sent this, from behind the tunnel.
 *
 * req.ip is cloudflared, every time. The caller's address is the one Cloudflare puts in
 * cf-connecting-ip, and trusting that header is only sound because nothing can reach this
 * process except through the tunnel — it listens on localhost. Behind a different proxy, or
 * exposed directly, that assumption has to be re-made.
 */
function callerIp(req) {
  return (
    req.get('cf-connecting-ip') ||
    (req.get('x-forwarded-for') || '').split(',')[0].trim() ||
    req.ip ||
    ''
  )
}

/**
 * A short fixed window, per address.
 *
 * A public endpoint with no ceiling is one loop away from hammering Open-Meteo under this
 * server's name. A real conversation makes at most a handful of tool calls a minute, so the
 * limit is far above anything legitimate and far below anything abusive.
 *
 * Replay is deliberately not defended against: both placed tools are idempotent reads — a
 * weather lookup and a search — so replaying one returns the same answer to nobody. If a
 * placed tool ever writes, this comment stops being true and a nonce becomes necessary.
 */
const RATE_MAX = Number(process.env.WEBHOOK_RATE_MAX) || 60
const RATE_WINDOW_MS = 60_000
const hits = new Map()

function overRateLimit(ip) {
  const now = Date.now()
  const seen = hits.get(ip)
  if (!seen || now - seen.since > RATE_WINDOW_MS) {
    hits.set(ip, { since: now, count: 1 })
    // Bounded: one entry per address per window, cleared as windows roll over.
    if (hits.size > 1000) for (const [k, v] of hits) if (now - v.since > RATE_WINDOW_MS) hits.delete(k)
    return false
  }
  seen.count += 1
  return seen.count > RATE_MAX
}

const publicBase = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')
const secret = () => process.env.ELEVENLABS_WEBHOOK_SECRET || ''

/**
 * Whether the hybrid can run, and if not, which half is missing.
 *
 * Returned as a reason rather than a boolean because "nothing happened" is the worst thing a
 * sync can print. Both the script and the console show this line.
 */
export function webhookHybridStatus() {
  const url = publicBase()
  const key = secret()
  if (!url && !key) {
    return {
      enabled: false,
      reason:
        'PUBLIC_BASE_URL and ELEVENLABS_WEBHOOK_SECRET are unset — server-placed tools stay withheld on this platform, which is the default.',
    }
  }
  if (!url) {
    return { enabled: false, reason: 'ELEVENLABS_WEBHOOK_SECRET is set but PUBLIC_BASE_URL is not — ElevenLabs has no address to call.' }
  }
  if (!key) {
    return { enabled: false, reason: 'PUBLIC_BASE_URL is set but ELEVENLABS_WEBHOOK_SECRET is not. Refusing to publish an unauthenticated tool endpoint.' }
  }
  if (!/^https:\/\//.test(url)) {
    return { enabled: false, reason: `PUBLIC_BASE_URL is ${url} — it must be https, or the shared secret travels in clear text.` }
  }
  return { enabled: true, reason: `server-placed tools reachable at ${url}/api/tool/hook/:name` }
}

/**
 * The placed tools, described the way ElevenLabs declares a webhook tool.
 *
 * Only the placed ones. The other six stay client tools and keep reaching the local endpoint,
 * so this publishes the smallest surface that makes the hybrid true — two read-only lookups,
 * not the whole engine.
 */
export function webhookToolsFor() {
  const { enabled } = webhookHybridStatus()
  if (!enabled) return []
  const url = publicBase()

  return toolSchemas
    .filter((t) => t.placement === 'server')
    .map((t) => ({
      type: 'webhook',
      name: t.name,
      description: t.description,
      api_schema: {
        url: `${url}/api/tool/hook/${t.name}`,
        method: 'POST',
        /**
         * A full object schema, not the flat map the docs summary implied.
         *
         * Sent flat first and the API answered 422 `extra_forbidden` on every parameter
         * name: it wants the same shape a client tool's `parameters` takes. Every
         * description must be non-empty too, or the whole agent is rejected — the same
         * rule the client-tool mapper already works around.
         */
        request_body_schema: {
          type: 'object',
          description: `Arguments for ${t.name}.`,
          properties: Object.fromEntries(
            Object.entries(t.parameters?.properties ?? {}).map(([name, spec]) => [
              name,
              {
                // They have no integer type; an unrecognised one is dropped rather than
                // rejected, and a parameter that silently stops arriving is the hardest
                // kind of bug to see from a voice call.
                type: spec.type === 'integer' ? 'number' : (spec.type ?? 'string'),
                description: spec.description?.trim() || `The ${name}.`,
              },
            ]),
          ),
          required: t.parameters?.required ?? [],
        },
        request_headers: {
          [HEADER]: secret(),
          [CONVERSATION_HEADER]: '{{system__conversation_id}}',
        },
      },
    }))
}

/** Constant-time compare, so a wrong secret cannot be found one character at a time. */
function secretMatches(given) {
  const expected = secret()
  if (!expected || !given) return false
  // Hash both first: timingSafeEqual throws on a length mismatch, and the length of a secret
  // is itself something worth not leaking.
  const h = (v) => createHmac('sha256', 'compare').update(String(v)).digest()
  return timingSafeEqual(h(given), h(expected))
}

/**
 * The endpoint ElevenLabs calls.
 *
 * Separate from POST /api/tool on purpose. That one is reachable only from the machine the
 * browser is on; this one is on the public internet by design, and the two should not share
 * a door. It refuses everything except the placed tools, so what is published is exactly the
 * set that had to be, and a leak here cannot reach the rest of the engine.
 */
export function mountWebhookToolRoute(app) {
  app.post('/api/tool/hook/:name', async (req, res) => {
    const { name } = req.params
    const { enabled } = webhookHybridStatus()
    if (!enabled) return res.status(503).json({ error: 'The webhook hybrid is not configured on this server.' })

    /**
     * Address first, then the secret.
     *
     * The order matters: an address that cannot be ElevenLabs never gets to try a secret,
     * so the endpoint offers no oracle to guess against. Both are refused with the same
     * shape of answer for the same reason.
     */
    const ip = callerIp(req)
    const allow = allowedIps()
    if (allow && !allow.has(ip)) {
      /**
       * Loud, and with the fix in it.
       *
       * This is the one guard that can break a working demo silently: if ElevenLabs ever
       * calls from an address they have not published, the weather tool starts returning 403
       * and the agent starts saying it cannot reach it — which looks like every other
       * failure. Printing the address alongside the exact line that would admit it turns a
       * mystery into a paste.
       */
      console.warn(
        `
  webhook: REFUSED ${name} from ${ip || 'an unknown address'} — not a published ElevenLabs egress IP.` +
          `
  If this was really them, add it:  ELEVENLABS_ALLOWED_IPS=${[...allow, ip].filter(Boolean).join(',')}` +
          `
  Or turn the check off for now:    ELEVENLABS_ALLOWED_IPS=off
`,
      )
      return res.status(403).json({ error: 'Not permitted from this address.' })
    }

    if (overRateLimit(ip)) {
      console.warn(`webhook: rate limited ${ip}`)
      return res.status(429).json({ error: 'Too many requests.' })
    }

    if (!secretMatches(req.get(HEADER))) {
      /**
       * Say it, because silence here cost an afternoon.
       *
       * The address check above logs loudly and the rate limit logs; this one refused and
       * said nothing. So a mismatched secret produced exactly no evidence: ElevenLabs
       * reported `is_error: true` with no detail, the server log showed not a single line,
       * and the only honest reading of that pair was "the request never arrived" — which
       * sent the search to DNS, to cold starts, to the agent's configuration, and to the
       * one place it was not.
       *
       * The cause is ordinary and will happen again: `npm run sync:agent` writes the secret
       * from the LOCAL .env into the agent at ElevenLabs, while the deployment has its own
       * copy typed into a dashboard. Two places, one value, no warning when they drift.
       *
       * The header is never printed, and neither is the expected value. Whether one was
       * sent at all is the entire diagnosis — a missing header means the tool was declared
       * without it, a present one means the two copies have drifted — and neither question
       * needs the secret itself to answer.
       */
      console.warn(
        `\n  webhook: REFUSED ${name} — ${req.get(HEADER) ? 'the tool secret does not match' : 'no tool secret was sent'}.` +
          `\n  ELEVENLABS_WEBHOOK_SECRET here must equal the one npm run sync:agent wrote into the agent.` +
          `\n  Set both to the same value and sync again.\n`,
      )
      return res.status(401).json({ error: 'Bad or missing tool secret.' })
    }

    // The inverse of the rule on /api/tool: that endpoint refuses server-placed tools, this
    // one refuses everything else. Together they mean each tool has exactly one door.
    const known = toolSchemas.some((t) => t.name === name)
    if (!known) {
      // Said plainly rather than folded into the message below, which would have claimed a
      // tool that does not exist runs in the browser. The names are in git and in the agent
      // config already, so there is nothing here to withhold — only something to get right.
      return res.status(404).json({ error: `There is no tool called ${name}.` })
    }
    if (placementOf(name) !== 'server') {
      return res.status(403).json({
        error: `${name} is not a server-placed tool. It runs in the browser, against /api/tool.`,
      })
    }

    const started = Date.now()
    try {
      const result = await runTool(name, req.body ?? {})
      res.json(result)

      /**
       * Tell the main server it happened, after answering rather than before.
       *
       * A trace that omits a call is the failure this fixes — a session answered "31
       * degrees at Phoenix" with no weather call anywhere in it — but a caller waiting on
       * an answer must not also wait on bookkeeping, and the log being unreachable is not
       * a reason for the tool to fail.
       */
      /**
       * Their placeholder, unsubstituted, is not an id.
       *
       * The docs say tool headers carry system dynamic variables. Measured against the live
       * platform they do not: this header arrives holding the literal text
       * "{{system__conversation_id}}", and two weather calls were filed under that string as
       * though it were a conversation. Treated as absent, the main server attributes the
       * call to the live session instead, which is at least true.
       *
       * The headers are logged once per call — at this volume that is a line, not noise, and
       * it is how a real id will be found if they ever send one.
       */
      const raw = req.get(CONVERSATION_HEADER)
      const session = raw && !raw.includes('{{') ? raw : null
      console.log(
        `webhook: ${name}${session ? ` for ${session}` : ' with no usable conversation id'} — headers: ${Object.keys(
          req.headers,
        )
          .filter((h) => h !== 'x-tool-secret')
          .join(', ')}`,
      )
      fetch(LOG_SINK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session,
          tool: name,
          args: req.body ?? {},
          result,
          ms: Date.now() - started,
          failed: Boolean(result?.data?.error),
        }),
      }).catch((err) => console.warn(`webhook: could not record ${name} — ${err.message}`))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
