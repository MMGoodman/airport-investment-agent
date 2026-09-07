/**
 * Re-check the claims on the "which voice model to choose" page against this repo.
 *
 * The page's own closing advice is "measure it yourself", and its own warning is that one run
 * is not an answer. This is that advice turned back on the page. Every claim below is taken
 * from it, and every check reads the thing itself rather than a copy of the conclusion.
 *
 * THREE TIERS, BECAUSE THEY COST DIFFERENT AMOUNTS
 *
 *   1  static   no server, no network, no key. Runs in a second.
 *   2  server   needs `npm run server`. Whether the security gap is still open, and how much
 *               evidence the stored conversations actually contain.
 *   3  live     needs a microphone and real calls. LISTED, NOT RUN: a latency figure cannot
 *               be produced without speaking, and pretending otherwise is how a page ends up
 *               with numbers nobody can reproduce.
 *
 *   node scripts/verify-claims.js
 */
import 'dotenv/config'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { toolSchemas, toolSchemasFor } from '../src/agent/tools.js'
import { buildRealtimeSession } from '../server/voice.js'
import { createEventHandler } from '../src/live/openaiRealtime.js'

const API = process.env.PROBE_API || 'http://localhost:3001'
const read = (p) => readFileSync(p, 'utf8')

const results = []
const check = async (tier, claim, run) => {
  try {
    const [ok, evidence] = await run()
    results.push({ tier, claim, ok, evidence })
  } catch (err) {
    results.push({ tier, claim, ok: false, evidence: `threw: ${err.message}` })
  }
}

// ---- tier 1: what the code says --------------------------------------------

await check(1, '8 tools total; the browser is offered 6, the relay 8', () => {
  const all = toolSchemas.length
  const browser = toolSchemasFor('browser').tools.length
  const relay = toolSchemasFor('relay').tools.length
  return [all === 8 && browser === 6 && relay === 8, `${browser}/${all} browser, ${relay}/${all} relay`]
})

await check(1, 'exactly search_knowledge and get_airport_weather are placement:server', () => {
  const server = toolSchemas
    .filter((t) => t.placement === 'server')
    .map((t) => t.name)
    .sort()
  const want = ['get_airport_weather', 'search_knowledge']
  return [String(server) === String(want), server.join(', ')]
})

await check(1, 'Open-Meteo is called with no API key at all', () => {
  const src = read('src/agent/tools.js')
  const at = src.indexOf('api.open-meteo.com')
  const url = src.slice(at, at + 400)
  const keyish = /apikey|api_key|key=|token|appid/i.test(url)
  return [!keyish, keyish ? 'a key-like parameter is in the URL' : 'coordinates only, no credential']
})

await check(1, 'moving one tool back to anywhere takes the direct path to 7/8', () => {
  const server = toolSchemas.filter((t) => t.placement === 'server').length
  const wouldBe = toolSchemas.length - (server - 1)
  return [wouldBe === 7, `${wouldBe}/8 with one tool moved`]
})

await check(1, '12 ElevenLabs egress addresses, read from cf-connecting-ip', () => {
  const src = read('server/webhookTools.js')
  const block = src.match(/const ELEVENLABS_EGRESS = \[([\s\S]*?)\]/)
  const ips = (block ? block[1] : '').match(/\d+\.\d+\.\d+\.\d+/g) || []
  return [ips.length === 12 && src.includes('cf-connecting-ip'), `${ips.length} addresses, from cf-connecting-ip`]
})

await check(1, 'rate limit is 60 per minute per address', () => {
  const src = read('server/webhookTools.js')
  const max = (src.match(/RATE_MAX\s*=\s*Number\([^)]+\)\s*\|\|\s*(\d+)/) || [])[1]
  const win = (src.match(/RATE_WINDOW_MS\s*=\s*([\d_]+)/) || [])[1]
  return [max === '60' && win === '60_000', `${max} per ${win} ms`]
})

await check(1, 'the shared secret is compared in constant time', () => {
  const src = read('server/webhookTools.js')
  const safe = src.includes('timingSafeEqual')
  return [safe, safe ? 'timingSafeEqual' : 'plain comparison']
})

await check(1, 'the un-substituted conversation variable is treated as absent', () => {
  const src = read('server/webhookTools.js')
  return [src.includes('{{'), 'the literal braces form is checked for']
})

await check(1, 'the public route is a separate process from the one that mints keys', () => {
  const own = existsSync('server/webhookServer.js')
  const port = own && /3002/.test(read('server/webhookServer.js'))
  return [own && port, own ? 'server/webhookServer.js, port 3002' : 'no separate process']
})

await check(1, 'Soniox is present and gated on a funded account', () => {
  const src = read('server/voice.js')
  return [src.includes('SONIOX_FUNDED'), 'SONIOX_FUNDED must be true']
})

await check(1, 'the paragraphs/sentences contradiction is gone from the voice path', async () => {
  const b = await buildRealtimeSession({ lang: 'he' }, 'browser')
  const asks = /two or three short paragraphs/i.test(b.baseInstructions)
  return [!asks, asks ? 'the voice prompt still asks for paragraphs' : 'sentences only on the voice path']
})

await check(1, 'the rule against hanging up reaches the session that is actually minted', async () => {
  const b = await buildRealtimeSession({ lang: 'he' }, 'browser')
  const inMint = /end_call/.test(b.session.instructions)
  const same = b.session.instructions === b.baseInstructions
  return [inMint && same, same ? 'the minted text is the text the browser holds' : 'the two assemblies differ']
})

await check(1, 'on the hybrid, a skill loading later does not re-withhold the tools', async () => {
  const NOTE = /NOT AVAILABLE ON THIS CONNECTION/
  const browser = await buildRealtimeSession({ lang: 'he' }, 'browser')
  const relay = await buildRealtimeSession({ lang: 'he' }, 'relay')
  const sent = []
  const handle = createEventHandler({
    send: (p) => sent.push(p),
    baseInstructions: browser.baseInstructions,
    skills: browser.skills,
    onSkillLoaded: () => {},
  })
  handle.adoptInstructions(relay.session.instructions)
  await handle({
    type: 'response.function_call_arguments.done',
    name: 'rank_airports',
    call_id: 'v',
    arguments: '{}',
  })
  const update = sent.find((p) => p.type === 'session.update')
  const back = NOTE.test((update && update.session && update.session.instructions) || '')
  return [!back, back ? 'the withheld note came back' : 'lifted once, and stays lifted']
})

await check(1, 'both server-placed tools are reads, so a replay changes nothing', () => {
  const src = read('src/agent/tools.js')
  const writes = /fs\.(write|append|unlink)/i.test(src)
  return [!writes, writes ? 'something writes — a replay is no longer harmless' : 'reads only']
})

// ---- tier 2: what the running server says ----------------------------------

const up = await fetch(`${API}/api/dashboard`)
  .then((r) => r.ok)
  .catch(() => false)

if (!up) {
  results.push({
    tier: 2,
    claim: 'the server is running on :3001',
    ok: false,
    evidence: 'not running — npm run server',
  })
} else {
  await check(2, 'POST /api/tool has no authentication — the page calls this the largest gap', async () => {
    const res = await fetch(`${API}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'rank_airports', args: { limit: 1 } }),
    })
    const body = await res.json()
    const open = res.ok && !body.error
    // This "passes" by being open, which is the page's point: the gap is named, not fixed.
    return [open, open ? 'answered an unauthenticated caller — still open' : `refused (${res.status})`]
  })

  await check(2, 'a placement:server tool is refused at that same door', async () => {
    const res = await fetch(`${API}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'get_airport_weather', args: { code: 'BOS' } }),
    })
    return [res.status === 403, `HTTP ${res.status}`]
  })

  await check(2, 'the comparison is no longer anecdotal: the dashboard averages latency per path', () => {
    const dir = 'data/sessions'
    if (!existsSync(dir)) return [false, 'nothing stored yet']
    let turns = 0
    let timed = 0
    const per = {}
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const c = JSON.parse(read(join(dir, f)))
      const p = c.providerLabel || c.provider
      per[p] = per[p] || { turns: 0, timed: 0 }
      for (const t of c.turns || []) {
        turns += 1
        per[p].turns += 1
        if (Number.isFinite(t.ms)) {
          timed += 1
          per[p].timed += 1
        }
      }
    }
    const detail = Object.entries(per)
      .map(([p, v]) => `${p} ${v.timed}/${v.turns}`)
      .join(' · ')
    // An average needs turns that carry a number. A path where none do reports nothing,
    // and a path where two do reports those two as though they were the path.
    return [timed === turns, `only ${timed} of ${turns} stored turns carry a timing — ${detail}`]
  })
}

// ---- report -----------------------------------------------------------------

const label = { 1: 'static', 2: 'server' }
let failed = 0
for (const tier of [1, 2]) {
  const rows = results.filter((r) => r.tier === tier)
  if (rows.length === 0) continue
  console.log(`\n  ${label[tier]}\n`)
  for (const r of rows) {
    if (!r.ok) failed += 1
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.claim}\n        ${r.evidence}`)
  }
}

console.log(
  `\n  ${results.length - failed} of ${results.length} checkable claims hold.` +
    (failed ? `  ${failed} did not.` : '') +
    '\n\n  Needs a microphone, so not attempted here:\n' +
    '    latency on every path (878 / 1,450 / 1,611 / 3,614 ms)\n' +
    '    cross-language retrieval, and the cascade breaking Hebrew\n' +
    '    hangup behaviour — PROBE_RUNS=8 npm run probe:hangup\n',
)
// exitCode rather than exit(): a hard exit while an undici socket is still closing trips
// a libuv assertion on Windows, which looks like a crash in the thing being verified.
process.exitCode = failed ? 1 : 0
