/**
 * Stored conversations, and the one thing the dashboard exists to keep separate.
 *
 * "The caller asked for the weather and did not get it" is the agent behaving correctly on a
 * path where the tool is withheld, and a fault on a path where it is not. Every test here is
 * ultimately about that distinction surviving into the aggregate — a dashboard that averages
 * the two reports a problem that is half a feature.
 */
import { describe, it, expect, beforeEach } from 'vitest'

process.env.SESSIONS_DIR = './.scratch/test-sessions'

const { dashboard, listConversations, resetSessions, saveConversation, saveTags, toolUsage, turnsOf } =
  await import('../sessions.js')

/** A path that carries every tool: a missing weather call here is a fault. */
const hybrid = {
  id: 'conv_hybrid',
  provider: 'elevenlabs-hybrid',
  providerLabel: 'elevenlabs · hybrid',
  toolsOffered: 8,
  toolsTotal: 8,
  lang: 'he',
  endedAt: '2026-09-03T10:00:00.000Z',
  turns: [
    {
      ask: 'מה מזג האוויר בסן פרנסיסקו?',
      reply: 'בהיר, כחמש עשרה מעלות.',
      ms: 5836,
      toolCalls: [{ tool: 'get_airport_weather', args: { iata: 'SFO' }, ranOn: 'server' }],
    },
    {
      ask: 'ואיזה שדה הכי מועמד?',
      reply: 'סן פרנסיסקו לוגן (SFO) מדורג ראשון.',
      ms: 9627,
      toolCalls: [{ tool: 'rank_airports', args: { region: 'Pacific' }, ranOn: 'browser' }],
    },
  ],
}

/** A path that withholds the weather tool: the same gap here is the design working. */
const direct = {
  id: 'conv_direct',
  provider: 'openai',
  providerLabel: 'gpt-realtime · voice',
  toolsOffered: 6,
  toolsTotal: 8,
  lang: 'he',
  endedAt: '2026-09-03T09:00:00.000Z',
  turns: [
    {
      ask: 'מה מזג האוויר שם?',
      reply: 'אין לי גישה לזה מהחיבור הנוכחי.',
      ms: 4321,
      toolCalls: [],
    },
  ],
}

beforeEach(() => {
  resetSessions()
})

describe('storing a conversation', () => {
  it('keeps the turns and their calls', async () => {
    await saveConversation(hybrid)
    const turns = await turnsOf('conv_hybrid')
    expect(turns).toHaveLength(2)
    expect(turns[0].toolCalls[0].tool).toBe('get_airport_weather')
    expect(turns[0].toolCalls[0].ranOn).toBe('server')
    expect(turns[1].ms).toBe(9627)
  })

  it('replaces rather than duplicates when the same call is stored twice', async () => {
    // A reload, or a second end event, would otherwise double every count on the dashboard.
    await saveConversation(hybrid)
    await saveConversation(hybrid)
    expect((await listConversations())).toHaveLength(1)
    expect(await turnsOf('conv_hybrid')).toHaveLength(2)
  })

  it('refuses a conversation with no provider', async () => {
    // Without it every aggregate is meaningless, so it is not optional and not defaulted.
    await expect(saveConversation({ id: 'x', turns: [] })).rejects.toThrow(/provider/)
  })
})

describe('tags on stored turns', () => {
  it('attaches verdicts to the right turn', async () => {
    await saveConversation(hybrid)
    const stored = await turnsOf('conv_hybrid')
    await saveTags('conv_hybrid', [
      { turnId: stored[0].turnId, hits: [{ id: 'placed-tool', kind: 'rule' }] },
      {
        turnId: stored[1].turnId,
        hits: [{ id: 'unsupported-claim', kind: 'llm', why: 'SFO is not Logan', quote: 'לוגן' }],
      },
    ])

    const tags = (await dashboard()).byTag
    const claim = tags.find((t) => t.tagId === 'unsupported-claim')
    expect(claim.hits).toBe(1)
    expect(claim.provider).toBe('elevenlabs-hybrid')
  })

  it('drops a grader that could not be reached', async () => {
    // "The model was busy" must not land in the same column as "the agent invented a figure".
    await saveConversation(hybrid)
    const stored = await turnsOf('conv_hybrid')
    await saveTags('conv_hybrid', [
      { turnId: stored[0].turnId, hits: [{ id: 'unsupported-claim', kind: 'llm', failed: true, why: '503' }] },
    ])
    expect((await dashboard()).totals.tagHits).toBe(0)
  })

  it('replaces a previous run rather than counting a turn twice', async () => {
    await saveConversation(hybrid)
    const stored = await turnsOf('conv_hybrid')
    const hit = [{ turnId: stored[0].turnId, hits: [{ id: 'placed-tool', kind: 'rule' }] }]
    await saveTags('conv_hybrid', hit)
    await saveTags('conv_hybrid', hit)
    expect((await dashboard()).totals.tagHits).toBe(1)
  })
})

describe('the dashboard', () => {
  it('keeps how many tools a path carried, beside its counts', async () => {
    // The whole point. A reader must be able to see, without knowing the transports by
    // heart, that one of these paths could not have answered and the other should have.
    await saveConversation(hybrid)
    await saveConversation(direct)

    const rows = (await dashboard()).byProvider
    const withHybrid = rows.find((r) => r.provider === 'elevenlabs-hybrid')
    const withDirect = rows.find((r) => r.provider === 'openai')

    expect(withHybrid.toolsOffered).toBe(8)
    expect(withDirect.toolsOffered).toBe(6)
    expect(withDirect.toolsTotal).toBe(8)
  })

  it('separates the same tag by the path it fired on', async () => {
    await saveConversation(hybrid)
    await saveConversation(direct)
    const h = await turnsOf('conv_hybrid')
    const d = await turnsOf('conv_direct')
    const asked = { id: 'asked-and-not-answered', kind: 'rule' }
    await saveTags('conv_hybrid', [{ turnId: h[1].turnId, hits: [asked] }])
    await saveTags('conv_direct', [{ turnId: d[0].turnId, hits: [asked] }])

    const rows = (await dashboard()).byTag.filter((t) => t.tagId === 'asked-and-not-answered')
    expect(rows).toHaveLength(2)
    // One is a fault and one is the placement working, and the offered count is how a reader
    // tells them apart.
    expect(rows.map((r) => r.toolsOffered).sort()).toEqual([6, 8])
  })

  it('averages latency per path, not across all of them', async () => {
    await saveConversation(hybrid)
    await saveConversation(direct)
    const rows = (await dashboard()).byProvider
    expect(rows.find((r) => r.provider === 'openai').avgMs).toBe(4321)
    expect(rows.find((r) => r.provider === 'elevenlabs-hybrid').avgMs).toBe(7732) // (5836+9627)/2
  })

  it('counts which tools actually ran, and how many ran off the browser', async () => {
    await saveConversation(hybrid)
    const [row] = (await toolUsage())
    expect(row.tools.get_airport_weather).toEqual({ calls: 1, onServer: 1 })
    expect(row.tools.rank_airports).toEqual({ calls: 1, onServer: 0 })
  })

  it('reports zeroes rather than throwing on an empty store', async () => {
    expect((await dashboard()).totals).toEqual({ conversations: 0, turns: 0, tagHits: 0 })
    expect((await toolUsage())).toEqual([])
  })
})
