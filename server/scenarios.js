/**
 * Eval cases captured from real conversations.
 *
 * Every case in eval/cases.js was written by hand after a failure was noticed, read back
 * out of a trace, and translated into assertions. That is the slowest possible loop and it
 * is why the suite is nineteen cases after a day of finding bugs — most of what went wrong
 * never became a test, because turning a heard answer into a case meant leaving the
 * conversation and writing JavaScript.
 *
 * A captured scenario is the same thing with the transcription done for you: the question
 * as it was actually asked, the tools that actually ran with the arguments they actually
 * got, and the figures the answer actually contained, offered as assertions to keep or
 * drop.
 *
 * WHY IT IS NOT WRITTEN STRAIGHT INTO eval/cases.js
 *
 * A case is a claim about what the agent should do, and a claim needs a person behind it.
 * Captured turns include ones where the agent was wrong — that is precisely when you reach
 * for this — and appending those unreviewed would enshrine the bug as the expectation.
 * They live in memory, are edited here, and are exported as source you paste in. The file
 * stays hand-maintained, which is what keeps every case in it deliberate.
 */
import { cases as fileCases } from '../eval/cases.js'

/** Captured this session, newest first. Gone on restart, like every other override here. */
const captured = []
let seq = 0

const GROUPS = ['target', 'follow-up', 'scope', 'edge', 'hebrew']

/**
 * A slug that reads as what the case is about.
 *
 * Derived from the question rather than numbered, because an id like `capture-3` tells a
 * reader nothing and the ids in the file — `lax-vs-sna`, `ambiguous-portland` — are half
 * the documentation.
 */
function slug(ask, lang) {
  const latin = ask
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .join('-')
  if (latin.length >= 6) return latin
  // A Hebrew question leaves nothing usable, so fall back to something honest.
  return `${lang === 'he' ? 'he' : 'case'}-capture-${++seq}`
}

/**
 * Every number the answer stated, as strings to assert on.
 *
 * The agent's contract is that no figure appears which did not come from a tool result, so
 * the figures ARE the thing worth pinning. Percentages and ranks are kept with their shape
 * ("81.6%", "1.4") because that is how they appear in the reply.
 */
function figuresIn(reply = '') {
  const found = new Set()
  // Grouped thousands FIRST, or 36,766,912 matches as "36,766" and then "912" — two
  // assertions on halves of a number the answer never split.
  const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\d+(?:\.\d+)?%?/g
  for (const m of reply.matchAll(NUMBER)) {
    const value = m[0]
    // A bare one- or two-digit number is a rank, a list marker or a year as often as it is
    // a finding, and a wrong assertion is worse than a missing one.
    const digits = value.replace(/\D/g, '')
    if (digits.length >= 3 || value.endsWith('%')) found.add(value)
  }
  return [...found].slice(0, 12)
}

/** IATA codes named in the reply, which are the other half of what an answer commits to. */
function codesIn(reply = '', tools = []) {
  const fromArgs = tools.flatMap((t) =>
    Object.values(t.args ?? {})
      .flat()
      .filter((v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v)),
  )
  const fromReply = [...(reply.match(/\b[A-Z]{3}\b/g) ?? [])]
  return [...new Set([...fromArgs, ...fromReply])].slice(0, 6)
}

/**
 * Turn one exchange into a draft case.
 *
 * Everything suggested is a suggestion. The caller reviews before it becomes a claim, and
 * the raw reply is kept alongside so a reviewer can see what the assertions came from
 * rather than trusting the extraction.
 */
export function draftFromTurn({ ask, reply, toolCalls = [], lang = 'he' }) {
  if (!ask?.trim()) throw new Error('a scenario needs the question that was asked')

  const tools = toolCalls.filter((t) => t?.tool)
  const expectTools = [...new Set(tools.map((t) => t.tool))]
  const expectArgs = tools.reduce((acc, t) => ({ ...acc, ...(t.args ?? {}) }), {})

  return {
    id: slug(ask, lang),
    group: expectTools.length === 0 ? 'scope' : 'target',
    ask: ask.trim(),
    lang,
    ...(expectTools.length ? { expectTools } : {}),
    ...(Object.keys(expectArgs).length ? { expectArgs } : {}),
    mustMention: codesIn(reply, tools),
    mustMentionOneOf: figuresIn(reply),
    ...(lang === 'he' ? { mustReplyInHebrew: true } : {}),
    /** Not part of the case — kept so a reviewer can see what the suggestions came from. */
    _capturedReply: reply ?? '',
  }
}

/** The shape the eval runner reads, with the review-only fields stripped. */
const asCase = ({ _capturedReply, _draftedAt, ...rest }) => rest

/**
 * Drafts as runnable cases.
 *
 * The point of drafting one is to find out whether it holds, and that needs the run to see
 * it. Exported rather than reached through the HTTP route so the runner does not call its
 * own server to read memory it is already sharing.
 */
export function capturedCases() {
  return captured.map(asCase)
}

/** Source you can paste into eval/cases.js, which is where a case becomes real. */
export function exportCases(list = captured) {
  const body = list
    .map((c) => `  ${JSON.stringify(asCase(c), null, 2).replace(/\n/g, '\n  ')},`)
    .join('\n')
  return `// Captured from live conversations. Read each one before keeping it: a captured\n// turn is what the agent DID, and this file is what it SHOULD do.\n${body}\n`
}

export function mountScenarioRoutes(app) {
  app.get('/api/scenarios', (_req, res) =>
    res.json({
      captured,
      groups: GROUPS,
      inFile: fileCases.length,
      note: 'Captured scenarios live in memory. Export them and paste into eval/cases.js — a case is a claim about what the agent should do, and captured turns include the ones where it was wrong.',
    }),
  )

  app.post('/api/scenarios', (req, res) => {
    try {
      const draft = draftFromTurn(req.body ?? {})
      captured.unshift(draft)
      res.json({ draft, captured })
    } catch (err) {
      res.status(400).json({ error: err.message })
    }
  })

  /**
   * A draft from an existing case, or from nothing.
   *
   * The only way in used to be capturing a live turn, which meant the fifteen fields a case
   * can carry were reachable only if a conversation happened to produce them. A case you
   * want to write deliberately — or a file case you want to vary without editing the file —
   * had no route at all.
   *
   * The file stays hand-maintained either way: this clones INTO the in-memory list, and
   * getting from there into eval/cases.js is still a deliberate paste.
   */
  app.post('/api/scenarios/draft', (req, res) => {
    const from = req.body ?? {}
    const base = String(from.id || 'draft').replace(/[^a-z0-9-]/gi, '-')
    // A clone cannot take the id it was cloned from, or the two are one row.
    let id = from.cloneOf ? `${base}-copy` : base
    let n = 1
    while (captured.some((c) => c.id === id)) id = `${base}-copy-${++n}`
    const draft = { ...from, id, _draftedAt: new Date().toISOString() }
    delete draft.cloneOf
    captured.unshift(draft)
    res.json({ draft, captured })
  })

  /**
   * Save an edited draft — creating it if the server has forgotten it.
   *
   * `captured` is in memory on purpose, and that is still right: a captured turn is what
   * the agent DID, and promoting it to a case is meant to be a deliberate paste into
   * eval/cases.js rather than something that accumulates on disk.
   *
   * What was NOT right was 404-ing the save. Restart the server — for a new env, for an
   * edited case file, for any of the reasons this project restarts it constantly — and the
   * dialog someone had open became a form that could no longer be submitted, reporting
   * `no captured scenario he-capture-1` over a screen still showing every field of it. The
   * browser was holding the whole draft. The only thing missing was the server's copy, and
   * the request carried it.
   *
   * So an unknown id is an insert, not an error. Nothing is lost that the client can still
   * see, which is the property a form should have.
   */
  app.put('/api/scenarios/:id', (req, res) => {
    const index = captured.findIndex((c) => c.id === req.params.id)
    const body = req.body ?? {}
    if (index === -1) {
      const draft = { ...body, id: req.params.id, _restoredAt: new Date().toISOString() }
      captured.unshift(draft)
      return res.json({ draft, captured, restored: true })
    }
    captured[index] = { ...captured[index], ...body, id: captured[index].id }
    res.json({ draft: captured[index], captured })
  })

  app.delete('/api/scenarios/:id', (req, res) => {
    const index = captured.findIndex((c) => c.id === req.params.id)
    if (index !== -1) captured.splice(index, 1)
    res.json({ captured })
  })

  app.get('/api/scenarios/export', (_req, res) => {
    res.type('text/plain').send(exportCases())
  })
}
