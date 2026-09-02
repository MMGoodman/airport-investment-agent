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
        request_headers: { [HEADER]: secret() },
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
    const { enabled } = webhookHybridStatus()
    if (!enabled) return res.status(503).json({ error: 'The webhook hybrid is not configured on this server.' })

    if (!secretMatches(req.get(HEADER))) {
      return res.status(401).json({ error: 'Bad or missing tool secret.' })
    }

    const { name } = req.params
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

    try {
      res.json(await runTool(name, req.body ?? {}))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
