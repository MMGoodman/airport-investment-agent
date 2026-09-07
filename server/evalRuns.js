/**
 * Running eval cases from the screen, one or many, against a chosen path.
 *
 * WHY THIS IS NOT JUST `npm run eval`
 *
 * The CLI runs the whole suite against both paths and prints. That is the right shape for
 * CI and the wrong one for the question you actually have mid-session, which is nearly
 * always narrower: does THIS case still pass after I changed the prompt, and does it pass
 * on the path I am about to demo. Nineteen cases across two paths to answer that is minutes
 * of waiting and API quota spent on eighteen cases you were not asking about.
 *
 * A RUN IS A BACKGROUND JOB, EVEN FOR ONE CASE
 *
 * One case takes seconds; nineteen take minutes. Handling those differently would mean two
 * code paths and two failure modes, so both are jobs: POST starts one and returns an id,
 * GET reports how far it has got and what it has found. The client polls. A batch's results
 * appear as they land rather than after the last one, which matters when the last one is
 * four minutes away.
 *
 * WHAT IT COSTS
 *
 * Real API calls on every case. The screen says so before you press the button, and the
 * default is the case in front of you rather than all of them.
 */
import { cases as fileCases } from '../eval/cases.js'
import { checkCase } from '../eval/assertions.js'
import { airportAliases } from '../eval/aliases.js'
import { adapters } from '../eval/adapters.js'
import { capturedCases } from './scenarios.js'
import { effectivePrompt, effectiveVoiceAddendum } from './workbench.js'
import { languageInstruction } from '../src/agent/prompt.js'
import { eagerSkills } from '../src/agent/skills.js'

/** Runs started this session. Same lifetime as every other override here. */
const runs = new Map()
let seq = 0

/**
 * The prompt a live session would actually be minted with.
 *
 * Assembled here rather than left to the adapter's file constants, so a run started after
 * you edit the instructions grades what you edited. See adapters.js: an eval that builds its
 * own prompt tests a prompt nobody runs.
 */
function instructionsFor(lang) {
  return (
    effectivePrompt() +
    effectiveVoiceAddendum() +
    languageInstruction(lang, true) +
    eagerSkills()
      .map((skill) => `\n\n${skill.instructions}`)
      .join('')
  )
}

/** Every case that can be run: the suite, plus whatever is drafted this session. */
export function runnableCases() {
  return [
    ...fileCases.map((c) => ({ ...c, source: 'file' })),
    ...capturedCases().map((c) => ({ ...c, source: 'draft' })),
  ]
}

/**
 * What an upstream error means, in terms of this run.
 *
 * The raw text is kept — it is the only thing worth pasting into a search — but it is not
 * the headline, because upstream errors are written for whoever wrote the upstream. A run
 * that failed on `GenerateContentRequest.contents[0].parts[0].data` tells the reader
 * nothing about what to do; "a turn was empty" tells them where to look.
 */
function explain(raw = '') {
  const m = String(raw)
  const say = (error, fix) => ({ error, fix, raw: m })

  if (/parts\[\d+\]\.data|must have one initialized field/i.test(m))
    return say('אחד התורות היה ריק', 'למקרה יש שאלה ריקה — מלא `ask`, או `turns` עם שורה לכל תור')
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(m))
    return say('לא הצליח להגיע לשרת', 'ודא ש-npm run server רץ על 3001')
  /**
   * A status code needs company to count as one.
   *
   * `\b403\b` alone read "scored 403 airports in the peer set" as an auth failure — and this
   * project deals in three-digit numbers constantly (158 airports, 403 scored, 500 seats).
   * A real status arrives next to a word that says it is one.
   */
  const status = (codes, names) =>
    new RegExp(
      `(?:status|code|http|returned|failed with|error)\\W{0,8}(?:${codes})\\b` +
        `|\\b(?:${codes})\\s+(?:${names})`,
      'i',
    ).test(m)

  if (status('401|403', 'unauthorized|forbidden') || /api key|unauthori[sz]/i.test(m))
    return say('המפתח נדחה', 'בדוק את המפתח של הספק ב-.env')
  if (status('429', 'too many') || /rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(m))
    return say('נגמרה המכסה או קצב הבקשות', 'המתן ונסה שוב, או הרץ פחות מקרים בבת אחת')
  if (/timeout|timed out|ETIMEDOUT/i.test(m))
    return say('המודל לא ענה בזמן', 'קרה בעיקר בשיחות רב-תוריות. נסה שוב')
  if (status('5\\d\\d', 'internal|bad gateway|unavailable') || /overload|UNAVAILABLE/i.test(m))
    return say('הספק החזיר שגיאה זמנית', 'זה בצד שלהם. נסה שוב בעוד רגע')
  if (/no adapter|unknown tool/i.test(m)) return say('הגדרה שגויה', m)
  // Unrecognised: say so rather than dressing it up as a diagnosis.
  return say('השיחה נכשלה', null)
}

async function execute(run) {
  const adapter = adapters[run.path]
  /**
   * Every case, `repeats` times, one after another.
   *
   * Not a nicety. This project has been fooled twice by a single run: a hangup check
   * reported six of six and then failed a case nothing had changed, and a latency figure
   * came from one trace and stood as a fact for days. A sampled model is a distribution,
   * and a batch that draws once from each is measuring luck alongside quality.
   *
   * Sequential rather than parallel: concurrent conversations against the same agent
   * contend for the same rate limit, and a 429 would arrive as a failed case.
   */
  for (const { testCase, attempt } of run.plan) {
    if (run.stopped) break
    const started = Date.now()
    try {
      const lang = testCase.lang ?? 'en'
      /**
       * `turns` REPLACES `ask`. It does not extend it.
       *
       * Written as `[ask, ...turns]` first, which put a `null` in front of every multi-turn
       * case — two of the nineteen carry their whole conversation in `turns` and have no
       * `ask` at all. Gemini answered that with
       * `parts[0].data: required oneof field 'data' must have one initialized field`,
       * a protobuf complaint about an empty message that named nothing a reader could act
       * on. scripts/eval.js had it right all along; this is the same line.
       */
      const turns = (testCase.turns ?? [testCase.ask]).filter(
        (t) => typeof t === 'string' && t.trim(),
      )
      if (turns.length === 0) throw new Error('the case has no question — set `ask`, or `turns`')

      const result = await adapter(turns, lang, { instructions: instructionsFor(lang) })
      // Aliases, so a spoken "Portland Jetport" counts as PWM. See eval/aliases.js: this
      // call had two arguments and every airport name was matched literally.
      const checks = checkCase(testCase, result, await airportAliases())
      run.results.push({
        id: testCase.id,
        attempt,
        group: testCase.group,
        source: testCase.source,
        ask: testCase.ask,
        // The reply and the calls travel with the verdict on purpose. A failed check is a
        // claim about an answer, and a claim you cannot read the evidence for is the thing
        // this project keeps having to fix.
        reply: result.reply,
        toolCalls: (result.toolCalls ?? []).map((t) => ({ tool: t.tool, args: t.args })),
        checks,
        passed: checks.every((c) => c.ok),
        ms: Date.now() - started,
      })
    } catch (err) {
      // A transport failure is not a failed case. It is marked apart so nobody reads a
      // dropped socket as the agent getting something wrong.
      run.results.push({
        id: testCase.id,
        attempt,
        group: testCase.group,
        source: testCase.source,
        ask: testCase.ask,
        ...explain(err.message),
        passed: null,
        ms: Date.now() - started,
      })
    }
    run.done += 1
  }
  run.finishedAt = Date.now()
  run.status = run.stopped ? 'stopped' : 'done'
}

export function mountEvalRunRoutes(app) {
  /** Everything runnable, so the screen can offer a batch without a second source of truth. */
  app.get('/api/evals/cases', (_req, res) =>
    res.json({
      cases: runnableCases(),
      paths: Object.keys(adapters),
      note: 'Each case is a real conversation with the model. Running costs API quota.',
    }),
  )

  app.post('/api/evals/run', (req, res) => {
    const { ids = [], path = 'gemini', repeats = 1 } = req.body ?? {}
    if (!adapters[path]) return res.status(400).json({ error: `no adapter ${path}` })

    const wanted = new Set(ids)
    const chosen = runnableCases().filter((c) => wanted.has(c.id))
    if (chosen.length === 0) return res.status(400).json({ error: 'no cases matched those ids' })

    // Capped: every repeat is a real conversation with a real bill, and a slip of the
    // keyboard should not spend an afternoon of quota.
    const times = Math.min(Math.max(Number(repeats) || 1, 1), 10)

    /**
     * Case by case rather than pass by pass.
     *
     * All five attempts at one case land together, so its verdict settles while you are
     * looking at it. Interleaving would mean nothing is decided until the whole batch ends.
     */
    const plan = chosen.flatMap((testCase) =>
      Array.from({ length: times }, (_, i) => ({ testCase, attempt: i + 1 })),
    )

    const run = {
      id: `run-${++seq}`,
      path,
      repeats: times,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      total: plan.length,
      cases: chosen.length,
      done: 0,
      plan,
      results: [],
      stopped: false,
    }
    runs.set(run.id, run)
    // Deliberately not awaited: the response carries the id, the work continues behind it.
    void execute(run)
    res.json({ runId: run.id, total: run.total, cases: run.cases, repeats: times, path })
  })

  app.get('/api/evals/run/:id', (req, res) => {
    const run = runs.get(req.params.id)
    if (!run) return res.status(404).json({ error: `no run ${req.params.id}` })
    const { plan, stopped, ...rest } = run
    // elapsed, not just the two timestamps: the question is "how long did this take", and
    // making the reader subtract is how a number goes unread.
    res.json({ ...rest, elapsedMs: (run.finishedAt ?? Date.now()) - run.startedAt })
  })

  app.post('/api/evals/run/:id/stop', (req, res) => {
    const run = runs.get(req.params.id)
    if (!run) return res.status(404).json({ error: `no run ${req.params.id}` })
    // Between cases, not mid-request: a half-cancelled API call still costs and still
    // returns, and pretending otherwise would leave a result nobody can account for.
    run.stopped = true
    res.json({ ok: true })
  })
}
