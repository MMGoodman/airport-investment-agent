/**
 * The gate that makes a public address survivable.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Until now the only thing protecting this API was that it listened on localhost. That is a
 * circumstance, not a setting, and the documentation says so in red: the server mints
 * ephemeral OpenAI keys, ElevenLabs signed URLs that spend real minutes, Soniox keys and
 * Gemini quota — all with no authentication, because everything that ever reached it came
 * from the browser on the same machine. Give it a domain and that sentence becomes: anyone
 * who finds the URL mints credentials on your accounts.
 *
 * So this is not a login. There are no users and no sessions. It is one shared token that
 * turns "anybody" into "whoever you gave it to", which is the whole distance between a
 * private tool on a public address and an open bar.
 *
 * OFF BY DEFAULT, LOUDLY
 *
 * With no APP_ACCESS_TOKEN set the gate does nothing, because that is the normal local case
 * and a dev server that demands a token before it will answer is a dev server nobody runs.
 * But a deployment that forgot to set one looks identical to a healthy one from the outside,
 * so boot() says which mode it is in, every time, where the deploy log will show it.
 *
 * TWO DOORS, AND THE SECOND ONE IS EASY TO MISS
 *
 * Express middleware never sees a WebSocket upgrade: `new WebSocketServer({ server })` takes
 * the upgrade off the HTTP server before any route runs. So `/api/relay` — which opens an
 * upstream connection to OpenAI on your key — would have stayed wide open behind a gate that
 * looked complete. It is checked separately, in attachRelay.
 *
 * And a browser WebSocket cannot set headers. That is not a preference, it is the API: the
 * `WebSocket` constructor takes a URL and subprotocols and nothing else. Hence the token is
 * accepted from a query parameter as well as a header — not as a convenience, but because
 * the alternative is a door that cannot be locked.
 */
import { timingSafeEqual, createHash } from 'node:crypto'

const HEADER = 'x-access-token'

/**
 * Paths the gate must NOT close.
 *
 * `/api/tool/hook/` is called by ElevenLabs' cloud, which has never heard of this token and
 * has no way to be told. It is not unprotected: it carries its own IP allowlist, rate limit
 * and shared secret, checked in webhookTools.js in that order. Two doors with two keys,
 * because two different callers come through them.
 */
const OPEN = ['/api/tool/hook/', '/api/health']

/**
 * The full path, because `app.use('/api', …)` hands the middleware a trimmed one.
 *
 * Mounted on a prefix, Express strips it: inside this function `req.path` is `/health`, not
 * `/api/health`. The exemption list is written in full paths — the way anyone reading it
 * would expect — so matching against `req.path` matched nothing, and both exemptions failed
 * closed.
 *
 * Which is the expensive direction. A 401 on `/api/health` makes Render call the service
 * unhealthy and stop routing to it; a 401 on `/api/tool/hook/` makes ElevenLabs' cloud lose
 * the two server-placed tools. Neither says "auth" anywhere in the symptom, and both would
 * have arrived as "the deploy is broken" hours after this file looked finished.
 */
const fullPath = (req) => `${req.baseUrl || ''}${req.path}`

const token = () => (process.env.APP_ACCESS_TOKEN || '').trim()

export const gateIsOn = () => token().length > 0

/**
 * Constant time, on hashes rather than on the strings.
 *
 * `timingSafeEqual` throws when the buffers differ in length, and returning early on that
 * would leak the token's length to anyone willing to time the difference. Hashing first
 * makes both sides 32 bytes whatever was sent.
 */
export function tokenIsValid(given) {
  const expected = token()
  if (!expected) return true
  const digest = (s) => createHash('sha256').update(String(s ?? '')).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

/** From a header, or from the query string when the caller is a browser WebSocket. */
export const tokenFrom = (req) =>
  req.get?.(HEADER) ||
  req.headers?.[HEADER] ||
  new URL(req.url ?? '/', 'http://host').searchParams.get('token') ||
  ''

export function apiGate(req, res, next) {
  if (!gateIsOn()) return next()
  if (OPEN.some((prefix) => fullPath(req).startsWith(prefix))) return next()
  if (tokenIsValid(tokenFrom(req))) return next()

  /**
   * 401 and nothing else.
   *
   * No hint about what was wrong, no echo of what was sent. The reply to a caller without
   * the token should tell them only that there is one.
   */
  return res.status(401).json({ error: 'access token required' })
}

/** Said at boot, where a deploy log will carry it. */
export function announce(log = console.log) {
  if (gateIsOn()) {
    log('  access gate: ON — /api/* requires the token; /api/tool/hook/* uses its own auth')
  } else {
    log(
      '  access gate: OFF — every endpoint is open.\n' +
        '  Fine on localhost. On a public address this mints OpenAI keys, ElevenLabs\n' +
        '  minutes and Gemini quota for anyone who finds it. Set APP_ACCESS_TOKEN.',
    )
  }
}
