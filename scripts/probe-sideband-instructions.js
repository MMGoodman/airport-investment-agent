/**
 * Does a skill loading AFTER the sideband put the withheld note back?
 *
 * The bug this checks, measured on a live hybrid call: the sideband attached at 5.2s and
 * handed over search_knowledge and get_airport_weather. At 14.3s the ranking skill loaded.
 * At 32.9s the caller asked for the weather at Boston Logan and the agent said the tool was
 * not available on this line and to switch to the server — while holding the tool and
 * fifteen seconds after being told so.
 *
 * The sideband lifts the note in its own session.update. But session.update REPLACES
 * instructions, and the browser composed its skill load from the base the session OPENED
 * with, which still said the tools were withheld. The last writer won, and it was the one
 * working from stale information.
 *
 * No microphone and no OpenAI: the fix is entirely about which text gets composed, so this
 * drives the handler directly and reads what it would have sent.
 *
 *   node scripts/probe-sideband-instructions.js
 */
import 'dotenv/config'
import { createEventHandler } from '../src/live/openaiRealtime.js'
import { buildRealtimeSession } from '../server/voice.js'

const NOTE = /NOT AVAILABLE ON THIS CONNECTION/

const browser = await buildRealtimeSession({ lang: 'he' }, 'browser')
const relay = await buildRealtimeSession({ lang: 'he' }, 'relay')

const sent = []
const handle = createEventHandler({
  send: (payload) => sent.push(payload),
  baseInstructions: browser.baseInstructions,
  skills: browser.skills,
  onSkillLoaded: () => {},
})

// The sideband attaches and hands back the instructions it set.
handle.adoptInstructions(relay.session.instructions)

// A skill loads afterwards — the ranking one, exactly as in the trace.
const skill = browser.skills.find((s) => s.tools?.includes('rank_airports'))
await handle({
  type: 'response.function_call_arguments.done',
  name: 'rank_airports',
  call_id: 'probe',
  arguments: '{}',
})

const update = sent.find((p) => p.type === 'session.update')
const results = [
  ['the base the session opened with says the tools are withheld', NOTE.test(browser.baseInstructions), true],
  ['the sideband hands back a version that does not', NOTE.test(relay.session.instructions), false],
  ['a skill loaded, so instructions were re-sent', Boolean(update), true],
  ['what it re-sent does NOT reinstate the note', NOTE.test(update?.session?.instructions ?? ''), false],
  ['and still carries the skill it loaded', (update?.session?.instructions ?? '').includes(skill.instructions.slice(0, 60)), true],
  ['and still carries the rule against hanging up', /end_call/.test(update?.session?.instructions ?? ''), true],
]

let bad = 0
for (const [what, got, want] of results) {
  if (got !== want) bad += 1
  console.log(`  ${got === want ? 'ok  ' : 'FAIL'}  ${what}${got === want ? '' : `  (got ${got}, wanted ${want})`}`)
}
console.log(
  bad === 0
    ? '\n  The note is lifted once and stays lifted.\n'
    : `\n  ${bad} of ${results.length} wrong.\n`,
)
process.exit(bad === 0 ? 0 : 1)
