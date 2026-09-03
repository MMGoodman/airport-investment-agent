/**
 * Tags, tested against the turns that produced them.
 *
 * Every default tag came from a real failure in this project, so the fixtures here are those
 * failures rather than invented examples. A tag that does not fire on the turn it was written
 * for is not a tag, it is a comment.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_TAGS,
  listTags,
  matchesRule,
  removeTag,
  tagConversation,
  upsertTag,
} from '../tags.js'

/** The turn that broke the promise: a spoken figure with no call behind it. */
const noToolWithFigures = {
  ask: 'כמה שדות תעופה יש באזור?',
  reply: 'באזור המיד-אטלנטי ישנם שישה עשר שדות תעופה, מעל 400000 נוסעים בשנה.',
  toolCalls: [],
  ms: 2165,
}

/** The one that is fine: no tools, and no figures either. */
const noToolNoFigures = {
  ask: 'מה אתה יכול לעשות?',
  reply: 'אני יכול לדרג שדות תעופה או להשוות בין שניים.',
  toolCalls: [],
  ms: 900,
}

/** A placed tool, run outside the browser. */
const placedTurn = {
  ask: 'מה מזג האוויר בג׳ון קנדי?',
  reply: 'בג׳ון פ. קנדי יורד גשם קל, כ-21 מעלות.',
  toolCalls: [{ tool: 'get_airport_weather', args: { iata: 'JFK' }, ranOn: 'server', ms: 336 }],
  ms: 3875,
}

describe('rule tags fire on the turns they were written for', () => {
  const byId = (id) => DEFAULT_TAGS.find((t) => t.id === id)

  it('catches a figure stated with no tool behind it', () => {
    expect(matchesRule(byId('answered-without-a-tool').rule, noToolWithFigures)).toBe(true)
  })

  it('hears a number spoken as words, not only written as digits', () => {
    // The turn that exposed this: "שישה עשר שדות תעופה... ארבע מאות אלף נוסעים", no tool
    // behind it and not one digit in it. A voice agent writes numbers to be SPOKEN, so a
    // digit test alone misses exactly the answers this tag exists for — the LLM tag caught
    // this turn and the rule did not.
    const spokenAloud = {
      ask: 'כמה שדות תעופה יש?',
      reply: 'באזור המיד-אטלנטי ישנם שישה עשר שדות תעופה, המדווחים על ארבע מאות אלף נוסעים.',
      toolCalls: [],
      ms: 2165,
    }
    expect(matchesRule(byId('answered-without-a-tool').rule, spokenAloud)).toBe(true)
  })

  it('leaves a toolless answer alone when it claims nothing', () => {
    // The negation is the whole tag: "no tools" on its own would fire on every pleasantry,
    // and a tag that fires constantly is one nobody reads.
    expect(matchesRule(byId('answered-without-a-tool').rule, noToolNoFigures)).toBe(false)
  })

  it('does not mistake a number in ordinary speech for a finding', () => {
    // "להשוות בין שניים" is an offer, and the first attempt at hearing spoken numbers fired
    // on it — every Hebrew number word was in the list, so the tag matched the agent
    // describing what it can do. A tag that fires on that fires on everything.
    for (const reply of [
      'אני יכול לדרג שדות תעופה או להשוות בין שניים.',
      'אפשר לשאול אילו שדות מועמדים חזקים, או להשוות בין שניים.',
      'לא הבנתי את השאלה. תוכל לנסח אותה שוב?',
    ]) {
      expect(
        matchesRule(byId('answered-without-a-tool').rule, { reply, toolCalls: [] }),
        `fired on ordinary speech: ${reply}`,
      ).toBe(false)
    }
  })

  it('catches a slow answer and not a fast one', () => {
    const rule = byId('slow-answer').rule
    expect(matchesRule(rule, { ms: 9300 })).toBe(true)
    expect(matchesRule(rule, { ms: 3614 })).toBe(false)
  })

  it('catches the transcripts that came back as nonsense', () => {
    const rule = byId('garbled-transcript').rule
    // Both of these are real: a caller said neither of them.
    expect(matchesRule(rule, { ask: 'אממ, דף קמארה מתי, אממ, מסיגריה?' })).toBe(true)
    expect(matchesRule(rule, { ask: 'אוקיי, מגניב. אממ, טוב, תודה רבה.' })).toBe(true)
    expect(matchesRule(rule, { ask: 'אילו שדות מועמדים חזקים להרחבה?' })).toBe(false)
  })

  it('catches every end_call, because the rule against it was broken twice', () => {
    const rule = byId('ended-the-call').rule
    expect(matchesRule(rule, { toolCalls: [{ tool: 'end_call' }] })).toBe(true)
    expect(matchesRule(rule, { toolCalls: [{ tool: 'rank_airports' }] })).toBe(false)
  })

  it('catches a weather question that no weather call answered', () => {
    const rule = byId('asked-and-not-answered').rule
    // Real phrasings, with the definite article the first version of this regex forgot: it
    // matched none of them and reported zero on a conversation entirely about the weather.
    for (const ask of ['מה מזג האוויר בבוסטון?', 'מה המזג אוויר שם?', 'יורד גשם בשיקגו?']) {
      expect(matchesRule(rule, { ask, toolCalls: [] }), `missed: ${ask}`).toBe(true)
    }
    // And it must stay quiet when the tool did answer.
    expect(
      matchesRule(rule, {
        ask: 'מה מזג האוויר בבוסטון?',
        toolCalls: [{ tool: 'get_airport_weather' }],
      }),
    ).toBe(false)
  })

  it('catches a placed tool running off the browser', () => {
    expect(matchesRule(byId('placed-tool').rule, placedTurn)).toBe(true)
  })
})

describe('a broken rule matches nothing rather than everything', () => {
  it('refuses a predicate that does not exist', () => {
    // A tag referring to a predicate that is gone must go quiet, not fire on every turn.
    expect(matchesRule({ all: [['thisWasRenamed', 5]] }, placedTurn)).toBe(false)
  })

  it('refuses an empty rule', () => {
    // `every` over an empty list is true, which would make an unfinished tag match the whole
    // conversation the moment it was saved.
    expect(matchesRule({ all: [] }, placedTurn)).toBe(false)
    expect(matchesRule({}, placedTurn)).toBe(false)
  })
})

describe('defining tags', () => {
  beforeEach(() => {
    removeTag('custom-test')
  })

  it('rejects a rule tag with no rule and an llm tag with no prompt', () => {
    expect(() => upsertTag({ id: 'custom-test', kind: 'rule' })).toThrow(/rule\.all/)
    expect(() => upsertTag({ id: 'custom-test', kind: 'llm' })).toThrow(/prompt/)
    expect(() => upsertTag({ id: 'custom-test', kind: 'sideways' })).toThrow(/rule or llm/)
  })

  it('adds, then updates in place rather than duplicating', () => {
    upsertTag({ id: 'custom-test', name: 'first', kind: 'rule', rule: { all: [['noTools']] } })
    upsertTag({ id: 'custom-test', name: 'second', kind: 'rule', rule: { all: [['noTools']] } })
    const found = listTags().filter((t) => t.id === 'custom-test')
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('second')
  })
})

describe('tagging a conversation', () => {
  it('runs the rules without a key, and counts them', async () => {
    // The point of rules being free: an offline run still tells you something. useLlm is off
    // so nothing here reaches a model.
    const out = await tagConversation({
      turns: [noToolWithFigures, placedTurn, { ...placedTurn, ms: 9300 }],
      useLlm: false,
    })

    expect(out.counts['answered-without-a-tool']).toBe(1)
    expect(out.counts['placed-tool']).toBe(2)
    expect(out.counts['slow-answer']).toBe(1)

    // Every tag appears in the summary, including the ones that matched nothing — a zero is
    // an answer to "does this happen here?" and an omission is not.
    const ids = out.summary.map((s) => s.id)
    for (const tag of DEFAULT_TAGS) expect(ids).toContain(tag.id)
  })

  it('keeps the turns alongside their hits, so a count can be traced back', async () => {
    const out = await tagConversation({ turns: [placedTurn], useLlm: false })
    expect(out.turns[0].turn.ask).toBe(placedTurn.ask)
    expect(out.turns[0].hits.map((h) => h.id)).toContain('placed-tool')
  })
})
