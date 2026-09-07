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
import { apiGate, tokenIsValid, gateIsOn } from '../auth.js'

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
