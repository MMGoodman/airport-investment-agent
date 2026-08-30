/**
 * What a correct answer has to do, checked mechanically.
 *
 * The headline check is `provenance`: every figure in the prose must be traceable to a
 * tool result. That is the claim the whole system rests on, and until now it was verified
 * by a human reading four transcripts and recognising the numbers.
 */

const norm = (s) => String(s ?? '').toLowerCase()

/**
 * Does the reply name this airport, by any name a person would use?
 *
 * Insisting on the IATA code failed the voice path on four cases, and the voice path was
 * right: the spoken-delivery rules ask it to talk like an analyst, and an analyst says
 * "Santa Ana", not "S-N-A". The same assertion was correct for text and wrong for speech,
 * which is precisely the kind of thing only a harness across both paths surfaces.
 *
 * Aliases come from data/, so they cover every airport without a hand-written table.
 */
function namesAirport(reply, token, aliases) {
  const code = String(token).toUpperCase()
  const forms = aliases?.[code]
  if (!forms) return reply.includes(norm(token))
  return forms.some((f) => reply.includes(norm(f)))
}

/** Numbers a reader would never call a claim: years, ranks, counts, list positions. */
function isStructural(n) {
  if (Number.isInteger(n) && n >= 1900 && n <= 2100) return true // a year
  if (Number.isInteger(n) && n <= 20) return true // rank, count, "top 3"
  return false
}

/**
 * Does `n` appear in the tool output, allowing for how a person says a number out loud?
 *
 * A load factor stored as 0.816 is spoken as "81.6 percent". 191,546 departures becomes
 * "roughly 191 thousand". Both are faithful; a matcher that only accepts exact equality
 * would call them fabricated.
 */
function traceable(n, numbersInTools) {
  const near = (a, b, tol) => Math.abs(a - b) <= tol

  for (const t of numbersInTools) {
    if (near(n, t, 0.051)) return true // same figure, maybe rounded a decimal
    if (near(n, t * 100, 0.051)) return true // 0.816 spoken as 81.6
    if (near(n / 100, t, 0.0005)) return true // the reverse
    if (t !== 0 && near(n, Math.round(t), 0.5)) return true // 67.2 spoken as 67

    // "191 thousand" for 191,546 — a truncation, not an invention.
    const ts = String(Math.round(Math.abs(t)))
    const ns = String(Math.round(Math.abs(n)))
    if (ns.length >= 2 && ts.length > ns.length && ts.startsWith(ns)) return true

    // "over 273,000 departures" for 273,911. The spoken figure's trailing zeros say how
    // coarsely it was rounded, so tolerance comes from the claim itself rather than from
    // a constant — which keeps the check tight on figures quoted precisely. The voice
    // prompt asks for exactly this kind of rounding, so refusing it would fail the model
    // for following instructions.
    const unit = roundingUnit(n)
    if (unit > 1 && Math.abs(n - t) <= unit) return true

    // "36.8 million" for 36,766,912.
    for (const scale of [1e3, 1e6, 1e9]) {
      if (Math.abs(n * scale - t) <= scale / 2) return true
    }
  }
  return false
}

/** The place value a number appears to have been rounded to: 273000 -> 1000, 67.2 -> 0. */
function roundingUnit(n) {
  const digits = String(Math.round(Math.abs(n)))
  if (!Number.isInteger(n)) return 0
  const zeros = digits.length - digits.replace(/0+$/, '').length
  return zeros === 0 ? 0 : 10 ** zeros
}

/**
 * Every figure a tool result contains, including the ones inside its own prose.
 *
 * Scanning only numeric fields was wrong and this check caught it: the peer-set size lives
 * in the string "all 158 scored US airports", the long-haul threshold in ">= 2200 statute
 * miles", and the CAGRs only ever appear inside a driver's `why` sentence. Those are the
 * tool's own words — the prompt tells the model to reuse them — so a figure quoted from
 * one is provenanced by definition.
 */
function collectNumbers(value, out = []) {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
  else if (typeof value === 'string') {
    for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''))
      if (Number.isFinite(n)) out.push(n)
    }
  } else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, out))
  return out
}

/** Figures in the reply with no counterpart in any tool result. */
export function unprovenanced(reply, toolCalls) {
  const numbersInTools = collectNumbers(toolCalls.map((c) => c.result ?? c))
  const spoken = [...String(reply).matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, '')))
    .filter(Number.isFinite)

  return [...new Set(spoken)].filter((n) => !isStructural(n) && !traceable(n, numbersInTools))
}

/**
 * @returns {{name: string, ok: boolean, detail?: string}[]}
 */
export function checkCase(testCase, run, aliases = null) {
  const checks = []
  const reply = norm(run.reply)
  const called = run.toolCalls.map((c) => c.tool)
  const add = (name, ok, detail) => checks.push({ name, ok, detail })

  if (testCase.expectTools) {
    const wanted = testCase.expectTools
    const ok = testCase.expectToolsAny
      ? wanted.some((t) => called.includes(t))
      : wanted.every((t) => called.includes(t))
    add(
      'tool',
      ok,
      ok ? called.join(', ') : `wanted ${wanted.join(testCase.expectToolsAny ? ' | ' : ' + ')}, ran ${called.join(', ') || 'nothing'}`,
    )
  }

  if (testCase.expectToolsOnLastTurn) {
    const ok = (run.lastTurnToolCalls ?? run.toolCalls).length > 0
    add('re-queries', ok, ok ? undefined : 'answered from its own previous reply, without calling a tool')
  }

  const argSpec = testCase.expectArgsOnLastTurn ?? testCase.expectArgs
  if (argSpec) {
    const pool = testCase.expectArgsOnLastTurn ? (run.lastTurnToolCalls ?? run.toolCalls) : run.toolCalls
    const ok = pool.some((c) =>
      Object.entries(argSpec).every(([k, v]) => {
        const got = c.args?.[k]
        if (v && typeof v === 'object' && !Array.isArray(v)) return got != null && typeof got === 'object'
        if (Array.isArray(v)) {
          const g = (got ?? []).map((x) => String(x).toUpperCase())
          return v.every((x) => g.includes(String(x).toUpperCase()))
        }
        return norm(got) === norm(v)
      }),
    )
    add('args', ok, ok ? undefined : `wanted ${JSON.stringify(argSpec)}, got ${JSON.stringify(pool.map((c) => c.args))}`)
  }

  for (const phrase of testCase.mustMention ?? []) {
    add(`names ${phrase}`, namesAirport(reply, phrase, aliases))
  }

  if (testCase.mustMentionOneOf) {
    const hit = testCase.mustMentionOneOf.find((p) => namesAirport(reply, p, aliases))
    add(
      `says one of [${testCase.mustMentionOneOf.slice(0, 3).join(', ')}…]`,
      Boolean(hit),
      hit ? `matched "${hit}"` : undefined,
    )
  }

  if (testCase.mustAlsoMentionOneOf) {
    const hit = testCase.mustAlsoMentionOneOf.find((p) => reply.includes(norm(p)))
    add(`says one of [${testCase.mustAlsoMentionOneOf.join(', ')}]`, Boolean(hit), hit && `matched "${hit}"`)
  }

  for (const phrase of testCase.mustNotMention ?? []) {
    add(`avoids "${phrase}"`, !reply.includes(norm(phrase)))
  }

  if (testCase.mustReplyInHebrew) {
    // A third of the characters being Hebrew separates a Hebrew answer from an English one
    // that happens to quote an airport name. Codes and metric names stay in English by
    // instruction, so demanding all-Hebrew would fail a correct reply.
    const letters = [...String(run.reply)].filter((ch) => /\p{L}/u.test(ch))
    const hebrew = letters.filter((ch) => /[֐-׿]/.test(ch))
    const share = letters.length ? hebrew.length / letters.length : 0
    add('answers in Hebrew', share > 0.33, `${Math.round(share * 100)}% Hebrew letters`)
  }

  const invented = unprovenanced(run.reply, run.toolCalls)
  add(
    'provenance',
    invented.length === 0,
    invented.length ? `no tool produced: ${invented.slice(0, 6).join(', ')}` : undefined,
  )

  return checks
}
