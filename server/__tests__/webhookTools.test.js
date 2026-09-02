/**
 * The ElevenLabs hybrid, and the conditions under which it must refuse to exist.
 *
 * This is the one place in the project that puts an endpoint on the public internet. The
 * OpenAI hybrid never does — it answers on a connection this server opened outward. So the
 * failure modes here are not "the tool did not run", they are "the tool ran for someone
 * else", and the tests are about refusing rather than about working.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    expect(weather.api_schema.request_body_schema.iata.type).toBe('string')
    expect(weather.api_schema.request_headers['x-tool-secret']).toBe('a-secret')
  })

  it('maps integer parameters to a type their schema accepts', () => {
    // search_knowledge takes topK as a JSON Schema integer; their parameter schema does not
    // have one, and an unrecognised type is dropped rather than rejected — a parameter that
    // silently stops arriving is the hardest kind of bug to see from a voice call.
    configure('https://example.ngrok-free.app', 'a-secret')
    const search = webhookToolsFor().find((t) => t.name === 'search_knowledge')
    expect(search.api_schema.request_body_schema.topK.type).toBe('number')
  })
})
