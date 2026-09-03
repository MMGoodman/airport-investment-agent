/**
 * The ElevenLabs hybrid, and the conditions under which it must refuse to exist.
 *
 * This is the one place in the project that puts an endpoint on the public internet. The
 * OpenAI hybrid never does — it answers on a connection this server opened outward. So the
 * failure modes here are not "the tool did not run", they are "the tool ran for someone
 * else", and the tests are about refusing rather than about working.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { webhookHybridStatus, webhookToolsFor } from '../webhookTools.js'

const KEEP = { url: process.env.PUBLIC_BASE_URL, key: process.env.ELEVENLABS_WEBHOOK_SECRET }

const configure = (url, key) => {
  if (url === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = url
  if (key === undefined) delete process.env.ELEVENLABS_WEBHOOK_SECRET
  else process.env.ELEVENLABS_WEBHOOK_SECRET = key
}

beforeEach(() => configure(undefined, undefined))
afterEach(() => configure(KEEP.url, KEEP.key))

describe('webhookHybridStatus', () => {
  it('is off by default, and says the default is deliberate', () => {
    // A laptop with no tunnel is the normal case. It must not read as a misconfiguration.
    const status = webhookHybridStatus()
    expect(status.enabled).toBe(false)
    expect(status.reason).toMatch(/default/)
  })

  it('refuses to publish an endpoint with no secret on it', () => {
    // The dangerous half-configuration: a reachable URL and nothing guarding it. Failing
    // closed here is the whole reason the secret is required rather than optional.
    configure('https://example.ngrok-free.app', undefined)
    const status = webhookHybridStatus()
    expect(status.enabled).toBe(false)
    expect(status.reason).toMatch(/Refusing/)
  })

  it('will not send a shared secret over plain http', () => {
    // request_headers puts the secret in every call ElevenLabs makes. Over http that is a
    // credential on the wire, and the tunnel that makes this work offers https anyway.
    configure('http://example.ngrok-free.app', 'a-secret')
    expect(webhookHybridStatus().enabled).toBe(false)
    expect(webhookHybridStatus().reason).toMatch(/https/)
  })

  it('turns on when both halves are present', () => {
    configure('https://example.ngrok-free.app', 'a-secret')
    expect(webhookHybridStatus().enabled).toBe(true)
  })
})

describe('webhookToolsFor', () => {
  it('offers nothing at all when the hybrid is off', () => {
    expect(webhookToolsFor()).toEqual([])
  })

  it('publishes only the server-placed tools', () => {
    // The smallest surface that makes the hybrid true. The other six keep reaching the
    // local endpoint, so a mistake here cannot expose the rest of the engine.
    configure('https://example.ngrok-free.app', 'a-secret')
    const names = webhookToolsFor().map((t) => t.name).sort()
    expect(names).toEqual(['get_airport_weather', 'search_knowledge'])
  })

  it('describes them the way ElevenLabs declares a webhook tool', () => {
    configure('https://example.ngrok-free.app/', 'a-secret')
    const weather = webhookToolsFor().find((t) => t.name === 'get_airport_weather')

    expect(weather.type).toBe('webhook')
    // The trailing slash on the base must not survive into a double slash in the path.
    expect(weather.api_schema.url).toBe('https://example.ngrok-free.app/api/tool/hook/get_airport_weather')
    expect(weather.api_schema.method).toBe('POST')
    expect(weather.api_schema.request_body_schema.type).toBe('object')
    expect(weather.api_schema.request_body_schema.properties.iata.type).toBe('string')
    expect(weather.api_schema.request_body_schema.required).toContain('iata')
    expect(weather.api_schema.request_headers['x-tool-secret']).toBe('a-secret')
  })

  it('maps integer parameters to a type their schema accepts', () => {
    // search_knowledge takes topK as a JSON Schema integer; their parameter schema does not
    // have one, and an unrecognised type is dropped rather than rejected — a parameter that
    // silently stops arriving is the hardest kind of bug to see from a voice call.
    configure('https://example.ngrok-free.app', 'a-secret')
    const search = webhookToolsFor().find((t) => t.name === 'search_knowledge')
    expect(search.api_schema.request_body_schema.properties.topK.type).toBe('number')
  })
})

/**
 * Who is allowed to reach the one endpoint that faces the internet.
 *
 * A shared secret proves whoever holds it. It lives in ElevenLabs' dashboard, travels in a
 * header on every call, and would be replayable by anyone who ever saw one — so it answers
 * "does this caller know the secret" and never "is this really ElevenLabs". Their published
 * static egress addresses answer the second question, which is why their own guidance is to
 * use both.
 *
 * Their HMAC signature is not an option here: measured against the live platform, a tool
 * webhook arrives with no elevenlabs-* header at all. The signature exists for post-call
 * webhooks, not for these.
 */
describe('who may reach the public endpoint', () => {
  it('lists every published region, not a guess at which one this account uses', async () => {
    // Getting this wrong fails as "the tool silently stopped working", and the full set is
    // twelve addresses. US, EU, Asia and the three residency regions.
    const src = await readFile(new URL('../webhookTools.js', import.meta.url), 'utf8')
    for (const ip of ['34.67.146.145', '35.204.38.71', '35.185.187.110', '34.87.23.17']) {
      expect(src, `${ip} missing from the egress allowlist`).toContain(ip)
    }
  })

  it('reads the caller from cf-connecting-ip, not from the tunnel', () => {
    // req.ip is cloudflared on every single request. Checking it would allow the world.
    const src = readFileSync(new URL('../webhookTools.js', import.meta.url), 'utf8')
    expect(src).toMatch(/cf-connecting-ip/)
  })

  it('checks the address before the secret', () => {
    // So an address that cannot be ElevenLabs never gets to try a secret, and the endpoint
    // is not an oracle to guess against.
    // Anchored on the checks themselves rather than on their log text, which is wording and
    // moved once already — breaking this test for a reason that had nothing to do with the
    // order it exists to protect.
    const src = readFileSync(new URL('../webhookTools.js', import.meta.url), 'utf8')
    const route = src.slice(src.indexOf("app.post('/api/tool/hook/:name'"))
    const ipCheck = route.indexOf('allow.has(ip)')
    const secretCheck = route.indexOf('secretMatches(')
    expect(ipCheck, 'the address is not checked in the route at all').toBeGreaterThan(-1)
    expect(secretCheck, 'the secret is not checked in the route at all').toBeGreaterThan(-1)
    expect(ipCheck, 'the secret is being checked first').toBeLessThan(secretCheck)
  })
})
