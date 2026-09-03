/**
 * Tags: questions asked of one turn, so a conversation can be read in aggregate.
 *
 * WHY THIS EXISTS
 *
 * Every problem found in this project was found by a person reading a trace and noticing
 * something. That works and does not scale: the weather call attached to the wrong answer,
 * the agent hanging up on "thank you", the transcript that came back as nonsense — each took
 * a careful read of one session, and each had almost certainly happened before unnoticed.
 *
 * A tag turns "I noticed this once" into "show me every turn where this happened". It is the
 * step between a trace and an eval case: the trace is what happened, a tag is what KIND of
 * thing happened, and an eval case is a claim that it should not happen again.
 *
 * TWO KINDS, FOR TWO DIFFERENT QUESTIONS
 *
 *   rule  a predicate over the turn's own record — which tools ran, how long it took, what
 *         the text matched. Deterministic, free, instant, and it cannot be argued with.
 *   llm   a question only a reader can answer: was this answer responsive? did it state
 *         something no tool returned? Costs a call and can be wrong, which is why its
 *         verdict carries the model's reason and is offered as an opinion.
 *
 * Reach for a rule whenever a rule can express it. The LLM is for the ones that need
 * judgement, and any LLM tag that turns out to be expressible as a rule should become one.
 *
 * The defaults below are not invented categories. Each is a failure this project actually
 * had, written down so the next occurrence is found by the system rather than by luck.
 */
import { describeUpstreamError } from '../src/upstreamError.js'

/**
 * The predicates a rule tag may use.
 *
 * Deliberately few. A rule language grows until it is a worse programming language, and the
 * questions worth asking of a turn are mostly about what ran, how long it took, and what the
 * words were.
 */
const PREDICATES = {
  /** No tool ran at all — the answer came out of the model. */
  noTools: (turn) => (turn.toolCalls ?? []).length === 0,
  /** A named tool ran. */
  usedTool: (turn, name) => (turn.toolCalls ?? []).some((t) => t.tool === name),
  /** A placed tool ran somewhere other than this browser. */
  ranOnServer: (turn) => (turn.toolCalls ?? []).some((t) => t.ranOn === 'server'),
  /** Slower than this many milliseconds. */
  slowerThan: (turn, ms) => Number(turn.ms) > Number(ms),
  /** The caller's words matched. */
  askMatches: (turn, pattern) => new RegExp(pattern, 'i').test(turn.ask ?? ''),
  /** The answer's words matched. */
  replyMatches: (turn, pattern) => new RegExp(pattern, 'i').test(turn.reply ?? ''),
  /**
   * The answer stated no quantity — in digits OR spoken as words.
   *
   * This tested /\d/ alone, which on a voice agent is wrong in the expensive direction: an
   * answer written to be SPOKEN says "שישה עשר שדות תעופה" and "ארבע מאות אלף נוסעים", never
   * "16" and "400,000". The tag for a figure with no tool behind it therefore missed the
   * exact turn it exists for — the LLM tag caught that one and the rule did not.
   *
   * The first fix listed every Hebrew number word and was worse: "אני יכול להשוות בין שניים"
   * is an offer, not a finding, and a tag that fires on it fires on everything. So only
   * quantities that do not turn up in ordinary speech count — the scale words, and the
   * compounds built on עשר, which is how this agent says every number above ten.
   *
   * It is a heuristic and it will be wrong both ways: "מאה אחוז" as an idiom trips it, and a
   * bare "שבע" as a real finding slips past. That is the division this module is built on —
   * rules are cheap and approximate, and `unsupported-claim` is the reader that catches what
   * they miss.
   */
  noFigures: (turn) => {
    const reply = turn.reply ?? ''
    if (/\d/.test(reply)) return false
    return !/(מאה|מאות|מאתיים|אלף|אלפים|אלפיים|מיליון|מיליארד|אחוז|עשר|עשרים|שלושים|ארבעים|חמישים|שישים|שבעים|שמונים|תשעים)/.test(
      reply,
    )
  },
}

/**
 * Tags every deployment starts with, each one a failure this project had.
 *
 * They are ordinary tags, not special ones: editable, deletable, stored like anything added
 * later. They are here because an empty tag list teaches nobody what a tag is for, and
 * because these are the ones that would have caught what took a day to notice.
 */
export const DEFAULT_TAGS = [
  {
    id: 'answered-without-a-tool',
    name: 'ענה בלי כלי',
    kind: 'rule',
    summary: 'תשובה עם מספרים ובלי אף קריאת כלי — כאן ההבטחה של הפרויקט נשברת',
    // The contract everything here rests on: no figure without a tool result behind it. A
    // turn that states numbers with no call is exactly where that breaks.
    rule: { all: [['noTools'], ['noFigures', null, true]] },
  },
  {
    id: 'slow-answer',
    name: 'תשובה איטית',
    kind: 'rule',
    summary: 'מעל 5 שניות עד לתשובה',
    // Five seconds is where a spoken answer stops feeling like a conversation, and it is
    // measured against this project's own range: the good sessions average under four.
    rule: { all: [['slowerThan', 5000]] },
  },
  {
    id: 'garbled-transcript',
    name: 'תמלול משובש',
    kind: 'rule',
    summary: 'סימני היסוס בשאלה — הסימן המובהק לתמלול שנשבר בקסקייד',
    // The cascade's structural weakness. Hesitation markers cluster in precisely the turns
    // that came back as nonsense.
    rule: { all: [['askMatches', '(אממ|אה,|מממ|אמ\\b)']] },
  },
  {
    id: 'ended-the-call',
    name: 'ניתק שיחה',
    kind: 'rule',
    summary: 'כל קריאה ל-end_call — הכלל נגד ניתוק על "תודה" הופר פעמיים',
    rule: { all: [['usedTool', 'end_call']] },
  },
  {
    id: 'placed-tool',
    name: 'כלי רץ בשרת',
    kind: 'rule',
    summary: 'תור שבו כלי מושם רץ מחוץ לדפדפן',
    rule: { all: [['ranOnServer']] },
  },
  {
    id: 'unsupported-claim',
    name: 'טענה בלי מקור',
    kind: 'llm',
    summary: 'האם התשובה קבעה עובדה שאף תוצאת כלי לא החזירה?',
    // The one that needs a reader. A session answered which airports serve New York — true,
    // useful, and out of the model's own knowledge rather than any tool result. No rule
    // catches it: a tool DID run, it just did not return what the answer said.
    prompt:
      'Did the answer state any fact — a figure, a name, a location, a relationship — that ' +
      'does not appear in the tool results provided? Answer yes only if something in the ' +
      'reply could not have come from those results. General knowledge the model happens to ' +
      'have, which no tool returned, counts as yes.',
  },
]

/** In memory, like every other override here. */
let tags = DEFAULT_TAGS.map((t) => ({ ...t }))

export const listTags = () => tags

export function upsertTag(tag) {
  if (!tag?.id) throw new Error('a tag needs an id')
  if (tag.kind !== 'rule' && tag.kind !== 'llm') throw new Error('kind must be rule or llm')
  if (tag.kind === 'rule' && !tag.rule?.all?.length) throw new Error('a rule tag needs rule.all')
  if (tag.kind === 'llm' && !tag.prompt?.trim()) throw new Error('an llm tag needs a prompt')
  const at = tags.findIndex((t) => t.id === tag.id)
  if (at === -1) tags.push(tag)
  else tags[at] = { ...tags[at], ...tag }
  return tag
}

export function removeTag(id) {
  const before = tags.length
  tags = tags.filter((t) => t.id !== id)
  return before !== tags.length
}

/**
 * Evaluate one rule tag against one turn.
 *
 * `rule.all` is a list of [predicate, argument?, negate?]. Every entry must hold. There is no
 * "any" until something needs one, because a tag that fires on either of two unrelated
 * conditions is usually two tags.
 */
export function matchesRule(rule, turn) {
  const clauses = rule?.all ?? []
  if (clauses.length === 0) return false
  return clauses.every(([name, arg, negate]) => {
    const predicate = PREDICATES[name]
    // An unknown predicate must not quietly pass. A tag referring to one that does not exist
    // is a broken tag, and a broken tag that matches everything is worse than one that
    // matches nothing.
    if (!predicate) return false
    const hit = Boolean(predicate(turn, arg))
    return negate ? !hit : hit
  })
}

/** What a caller may write in a rule, so the console can offer them rather than guess. */
export const predicateNames = () => Object.keys(PREDICATES)

/**
 * Ask the model one tag's question about one turn.
 *
 * The turn is handed over as evidence — the question, the answer, and every tool result
 * behind it — and the verdict comes back with a reason. The reason is the point: a tag that
 * says "yes" and cannot say why is an assertion, and this project does not trade in those.
 */
async function askModel({ tag, turn, apiKey, model }) {
  const evidence = (turn.toolCalls ?? []).length
    ? (turn.toolCalls ?? [])
        .map(
          (t) =>
            `- ${t.tool}(${JSON.stringify(t.args ?? {})}) -> ${JSON.stringify(t.result ?? null).slice(0, 1200)}`,
        )
        .join('\n')
    : '- none: no tool ran on this turn'

  const prompt = [
    'You are grading one turn of a conversation against a single question.',
    'Answer with JSON only: {"hit": true|false, "why": "<one short sentence>"}.',
    '',
    `QUESTION: ${tag.prompt}`,
    '',
    `CALLER ASKED: ${turn.ask ?? '(nothing recorded)'}`,
    `AGENT REPLIED: ${turn.reply ?? '(nothing recorded)'}`,
    '',
    'TOOL RESULTS AVAILABLE TO THE AGENT:',
    evidence,
  ].join('\n')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    },
  )
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message ?? `grading failed (${res.status})`)
  const parsed = JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}')
  return { hit: Boolean(parsed.hit), why: parsed.why ?? '' }
}

/**
 * Tag a whole conversation.
 *
 * Rules first and always: they are free, so nobody waits for them behind a model call. LLM
 * tags run after, and a failure on one turn is reported on that turn rather than failing the
 * batch — a grader that cannot reach the model still leaves every rule tag useful.
 */
export async function tagConversation({
  turns = [],
  apiKey,
  model = 'gemini-3.1-flash-lite',
  useLlm = true,
}) {
  const active = listTags()
  const ruleTags = active.filter((t) => t.kind === 'rule')

  const tagged = turns.map((turn) => ({
    turn,
    hits: ruleTags
      .filter((tag) => matchesRule(tag.rule, turn))
      .map((tag) => ({ id: tag.id, name: tag.name, kind: 'rule' })),
  }))

  if (useLlm && apiKey) {
    for (const tag of active.filter((t) => t.kind === 'llm')) {
      for (const entry of tagged) {
        try {
          const { hit, why } = await askModel({ tag, turn: entry.turn, apiKey, model })
          if (hit) entry.hits.push({ id: tag.id, name: tag.name, kind: 'llm', why })
        } catch (err) {
          entry.hits.push({
            id: tag.id,
            name: tag.name,
            kind: 'llm',
            failed: true,
            why: describeUpstreamError(err, 'the grader'),
          })
        }
      }
    }
  }

  // The aggregate is the reason to tag at all: one tagged turn is a note, forty is a pattern.
  const counts = {}
  for (const entry of tagged) {
    for (const hit of entry.hits) {
      if (hit.failed) continue
      counts[hit.id] = (counts[hit.id] ?? 0) + 1
    }
  }

  return {
    turns: tagged,
    counts,
    summary: active
      .map((t) => ({ id: t.id, name: t.name, kind: t.kind, count: counts[t.id] ?? 0 }))
      .sort((a, b) => b.count - a.count),
  }
}

export function mountTagRoutes(app) {
  app.get('/api/tags', (_req, res) =>
    res.json({
      tags: listTags(),
      predicates: predicateNames(),
      note: 'A rule tag is a predicate over the turn record: free, instant, and not arguable. An LLM tag is for what only a reader can answer, and its verdict carries a reason.',
    }),
  )

  app.post('/api/tags', (req, res) => {
    try {
      res.json({ tag: upsertTag(req.body ?? {}), tags: listTags() })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  app.delete('/api/tags/:id', (req, res) => res.json({ removed: removeTag(req.params.id) }))

  app.post('/api/tags/apply', async (req, res) => {
    try {
      const { turns, useLlm } = req.body ?? {}
      if (!Array.isArray(turns)) return res.status(400).json({ error: 'Body must be { turns: [] }' })
      res.json(
        await tagConversation({
          turns,
          useLlm: useLlm !== false,
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
        }),
      )
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })
}
