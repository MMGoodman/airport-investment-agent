/**
 * npm run eval — the regression net for the agent layer.
 *
 *   npm run eval                      both model paths
 *   npm run eval -- --path=gemini     one of them
 *   npm run eval -- --group=scope     one group of cases
 *   npm run eval -- --case=lax-vs-sna one case, with the reply printed
 *
 * `npm run verify` proves the scoring engine is deterministic. This proves the layer
 * above it — which tool the model reached for, on which arguments, and whether every
 * figure in the prose came from that tool. Those are the parts that can regress silently
 * when a prompt is reworded or a model is swapped, and until now nothing watched them.
 */
import 'dotenv/config'
import { cases } from '../eval/cases.js'
import { checkCase } from '../eval/assertions.js'
import { adapters } from '../eval/adapters.js'
import { getStore } from '../src/data/store.js'

/** IATA code -> every name a person might say for it, straight out of the dataset. */
const store = await getStore()
const aliases = Object.fromEntries(
  store.airports.map((a) => [
    a.iata,
    [a.iata, a.name, a.name.replace(/ (International|Regional)? ?Airport$/i, ''), ...a.city.split('/')],
  ]),
)

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : fallback
}

const paths = arg('path', 'gemini,openai').split(',').filter((p) => adapters[p])
const only = arg('case', null)
const group = arg('group', null)
const verbose = process.argv.includes('--verbose') || Boolean(only)

const selected = cases.filter((c) => (!only || c.id === only) && (!group || c.group === group))
if (selected.length === 0) {
  console.error('No cases matched.')
  process.exit(1)
}

/**
 * A DNS blip or a rate limit is not a regression, but an unretried one looks exactly like
 * a total collapse in the summary: a whole path reads 0/15 and the real result is hidden.
 * Retry the transport, never the assertion.
 */
const TRANSIENT = /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|timed out|429|rate limit|502|503|504/i

async function runWithRetry(adapter, turns, attempts = 3) {
  let last
  for (let i = 1; i <= attempts; i++) {
    try {
      return await adapter(turns)
    } catch (err) {
      last = err
      if (!TRANSIENT.test(err.message) || i === attempts) throw err
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
  throw last
}

const PATH_LABEL = {
  gemini: `${process.env.GEMINI_MODEL || 'gemini'} · text`,
  openai: `${process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'} · realtime`,
}

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }

const results = {} // path -> caseId -> { checks, run, error }

for (const path of paths) {
  console.log(`\n${c.bold(PATH_LABEL[path] ?? path)}`)
  console.log(c.dim('─'.repeat(64)))
  results[path] = {}

  let lastGroup = null
  for (const testCase of selected) {
    if (testCase.group !== lastGroup) {
      lastGroup = testCase.group
      console.log(c.dim(`  ${lastGroup}`))
    }

    const turns = testCase.turns ?? [testCase.ask]
    let entry
    try {
      const run = await runWithRetry(adapters[path], turns)
      entry = { run, checks: checkCase(testCase, run, aliases) }
    } catch (err) {
      entry = { error: err.message, checks: [{ name: 'ran', ok: false, detail: err.message }] }
    }
    results[path][testCase.id] = entry

    const passed = entry.checks.filter((k) => k.ok).length
    const total = entry.checks.length
    const ok = passed === total
    const tools = entry.run ? [...new Set(entry.run.toolCalls.map((t) => t.tool))].join(', ') || '—' : '—'
    const secs = entry.run ? `${(entry.run.ms / 1000).toFixed(1)}s` : ''

    console.log(
      `    ${ok ? c.green('✓') : c.red('✗')} ${testCase.id.padEnd(24)} ${c.dim(tools.padEnd(34))} ${passed}/${total}  ${c.dim(secs)}`,
    )
    for (const check of entry.checks.filter((k) => !k.ok)) {
      console.log(c.red(`        ${check.name}${check.detail ? ` — ${check.detail}` : ''}`))
    }
    if (verbose && entry.run) {
      console.log(c.dim(`        ${entry.run.reply.replace(/\s+/g, ' ').slice(0, 300)}`))
    }
  }
}

// ---------------------------------------------------------------- summary

console.log(`\n${c.bold('Summary')}`)
console.log(c.dim('─'.repeat(64)))
console.log(c.dim('  path'.padEnd(34) + 'cases'.padEnd(10) + 'checks'.padEnd(11) + 'provenance'))

let anyFailed = false
for (const path of paths) {
  const entries = Object.values(results[path])
  const casesOk = entries.filter((e) => e.checks.every((k) => k.ok)).length
  const checks = entries.flatMap((e) => e.checks)
  const checksOk = checks.filter((k) => k.ok).length
  const prov = checks.filter((k) => k.name === 'provenance')
  const provOk = prov.filter((k) => k.ok).length
  if (casesOk < entries.length) anyFailed = true

  console.log(
    '  ' +
      (PATH_LABEL[path] ?? path).padEnd(32) +
      `${casesOk}/${entries.length}`.padEnd(10) +
      `${checksOk}/${checks.length}`.padEnd(11) +
      `${provOk}/${prov.length}`,
  )
}

// Where the paths disagreed about which tool to use. Not a failure on its own — two tools
// can both answer a question — but it is the first place to look when one path regresses.
if (paths.length > 1) {
  const rows = selected
    .map((testCase) => {
      const picks = paths.map((p) => ({
        path: p,
        tools: [...new Set(results[p][testCase.id]?.run?.toolCalls.map((t) => t.tool) ?? [])].sort().join('+') || '—',
      }))
      return new Set(picks.map((p) => p.tools)).size > 1 ? { id: testCase.id, picks } : null
    })
    .filter(Boolean)

  if (rows.length) {
    console.log(`\n${c.bold('Tool disagreements')}  ${c.dim('(not failures — where the paths diverged)')}`)
    console.log(c.dim('─'.repeat(64)))
    for (const row of rows) {
      console.log(`  ${row.id.padEnd(24)} ${row.picks.map((p) => `${p.path}: ${p.tools}`).join('   ')}`)
    }
  }
}

console.log()
process.exit(anyFailed ? 1 : 0)
