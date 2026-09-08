/**
 * The access gate, and mostly the two paths that must stay open through it.
 *
 * These exist because the first version failed both, invisibly. The middleware is mounted
 * with `app.use('/api', apiGate)`, which strips the prefix before the handler runs, so an
 * exemption list written in full paths — `/api/health`, `/api/tool/hook/` — matched nothing
 * and closed the two doors it was written to keep open.
 *
 * Neither failure looks like authentication from the outside. A 401 on the health check
 * makes Render mark the service unhealthy and stop routing to it; a 401 on the webhook makes
 * ElevenLabs' cloud lose the two server-placed tools and the agent start saying it cannot
 * reach them. Both arrive as "the deployment is broken", hours later, with nothing pointing
 * back here.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { apiGate, tokenIsValid, gateIsOn, overGuessLimit, recordFailure } from '../auth.js'

const before = process.env.APP_ACCESS_TOKEN
afterEach(() => {
  if (before === undefined) delete process.env.APP_ACCESS_TOKEN
  else process.env.APP_ACCESS_TOKEN = before
})

/** Express hands a mounted middleware a `baseUrl` and a trimmed `path`. Both, as it does. */
const request = (fullUrl, token) => {
  const path = fullUrl.startsWith('/api') ? fullUrl.slice(4) : fullUrl
  return {
    baseUrl: fullUrl.startsWith('/api') ? '/api' : '',
    path,
    url: fullUrl,
    headers: token ? { 'x-access-token': token } : {},
    get(name) {
      return this.headers[name.toLowerCase()]
    },
  }
}

const run = (req) => {
  let passed = false
  let status = null
  const res = {
    status(code) {
      status = code
      return this
    },
    json() {
      return this
    },
  }
  apiGate(req, res, () => {
    passed = true
  })
  return passed ? 'allowed' : status
}

describe('the access gate', () => {
  it('does nothing at all with no token configured, which is the local case', () => {
    delete process.env.APP_ACCESS_TOKEN
    expect(gateIsOn()).toBe(false)
    expect(run(request('/api/agents'))).toBe('allowed')
    expect(run(request('/api/realtime/session'))).toBe('allowed')
  })

  it('refuses the credential endpoints without the token', () => {
    process.env.APP_ACCESS_TOKEN = 'secret'
    for (const path of [
      '/api/agents',
      '/api/realtime/session',
      '/api/voice/signed-url',
      '/api/voice/soniox-key',
      '/api/chat',
      '/api/tool',
    ]) {
      expect(run(request(path)), path).toBe(401)
    }
  })

  it('accepts the token from a header', () => {
    process.env.APP_ACCESS_TOKEN = 'secret'
    expect(run(request('/api/agents', 'secret'))).toBe('allowed')
    expect(run(request('/api/agents', 'wrong'))).toBe(401)
  })

  /**
   * A browser's WebSocket constructor takes a URL and subprotocols and nothing else, so
   * /api/relay has nowhere but the query string to carry this.
   */
  it('accepts the token from the query string, for the WebSocket that cannot send a header', () => {
    process.env.APP_ACCESS_TOKEN = 'secret'
    expect(run(request('/api/relay?session=abc&token=secret'))).toBe('allowed')
    expect(run(request('/api/relay?session=abc&token=wrong'))).toBe(401)
  })

  it("leaves the host's health check open — it has no token and needs none", () => {
    process.env.APP_ACCESS_TOKEN = 'secret'
    expect(run(request('/api/health'))).toBe('allowed')
  })

  it("leaves the webhook open to its own guards — ElevenLabs' cloud has never heard of this token", () => {
    process.env.APP_ACCESS_TOKEN = 'secret'
    expect(run(request('/api/tool/hook/get_airport_weather'))).toBe('allowed')
  })

  it('compares on equal-length digests, so the token length does not leak', () => {
    process.env.APP_ACCESS_TOKEN = 'a-fairly-long-token-value'
    // A one-character guess must be rejected rather than throw, which is what
    // timingSafeEqual does on buffers of different lengths.
    expect(() => tokenIsValid('x')).not.toThrow()
    expect(tokenIsValid('x')).toBe(false)
    expect(tokenIsValid('a-fairly-long-token-value')).toBe(true)
  })
})

/**
 * The forgiving comparison and the limit that makes it safe.
 *
 * These exist together on purpose. Folding case and punctuation is what lets somebody set
 * `JONES-2026` and say it out loud; it also shrinks the search space, and a short code with
 * a forgiving comparison and no rate limit is a formality rather than a gate.
 */
describe('a code a person can be told', () => {
  it('ignores case, spaces and dashes on both sides', () => {
    process.env.APP_ACCESS_TOKEN = 'JONES-2026'
    for (const typed of ['JONES-2026', 'jones-2026', 'jones 2026', 'Jones2026', '  JONES-2026  ']) {
      expect(tokenIsValid(typed), typed).toBe(true)
    }
    expect(tokenIsValid('JONES-2027')).toBe(false)
    expect(tokenIsValid('')).toBe(false)
  })

  it('still matches a long generated token, which contains - and _', () => {
    process.env.APP_ACCESS_TOKEN = 'Xy7_kQm-9vB3nFp2QrLs4TvWx8ZaBcDeFgHiJkLmNoP'
    expect(tokenIsValid('Xy7_kQm-9vB3nFp2QrLs4TvWx8ZaBcDeFgHiJkLmNoP')).toBe(true)
    expect(tokenIsValid('Xy7_kQm-9vB3nFp2QrLs4TvWx8ZaBcDeFgHiJkLmNoQ')).toBe(false)
  })

  it('stops guessing after ten wrong answers from one address', () => {
    process.env.APP_ACCESS_TOKEN = '482913'
    const ip = '203.0.113.9'
    expect(overGuessLimit(ip)).toBe(false)
    for (let i = 0; i < 10; i += 1) recordFailure(ip)
    expect(overGuessLimit(ip)).toBe(true)
    // One address being throttled must not throttle anybody else.
    expect(overGuessLimit('203.0.113.10')).toBe(false)
  })

  it('refuses a throttled caller with 429, which is not the same answer as a wrong code', () => {
    process.env.APP_ACCESS_TOKEN = '482913'
    const req = request('/api/agents', 'wrong')
    req.headers['x-forwarded-for'] = '198.51.100.7'
    for (let i = 0; i < 12; i += 1) run(req)
    expect(run(req)).toBe(429)
  })
})
