/**
 * Every name a person would use for an airport, so an assertion can stop insisting on codes.
 *
 * WHY THIS IS ITS OWN MODULE — THE SAME MISTAKE, THREE TIMES
 *
 * `namesAirport` in assertions.js resolves an expected airport through this table and falls
 * back to a literal substring when it is not given one. Two comments already record what
 * happens without it. In assertions.js: insisting on the IATA code failed the voice path on
 * four cases, and the voice path was right — the spoken-delivery rules ask it to talk like
 * an analyst, and an analyst says "Santa Ana", not "S-N-A". In scripts/eval.js: the reply
 * said "בוסטון לוגן" and the check was looking for "Boston Logan".
 *
 * Both were fixed where they were found, and the table stayed inside the CLI. The eval
 * runner behind the SCREEN — the one anybody actually presses — called `checkCase` with two
 * arguments and got the literal fallback. On the text paths that mostly went unnoticed,
 * because a typed reply tends to carry the code. On the audio path it is the difference
 * between measuring the agent and measuring its diction: a run that called
 * `compare_airports` with exactly `["BOS","PWM","BDL"]` and answered "Boston Logan comes out
 * on top… Portland Jetport is next… Bradley International is further behind" was marked
 * FAILED for not saying "PWM".
 *
 * So it lives here, and both callers import it. A fourth divergence has to be deliberate.
 */
import { getStore } from '../src/data/store.js'
import { HEBREW_AIRPORT_NAMES } from '../src/agent/vocabulary.js'

/** Built once and reused: the store is a file read and this is the same table every time. */
let cached = null

export async function airportAliases() {
  if (cached) return cached
  const store = await getStore()
  cached = Object.fromEntries(
    store.airports.map((a) => [
      a.iata,
      [
        a.iata,
        a.name,
        // "Portland International Jetport" is said as "Portland Jetport"; the suffix is how
        // a registry writes it, not how anyone speaks it.
        a.name.replace(/ (International|Regional)? ?Airport$/i, ''),
        // "Dallas/Fort Worth" is two names a caller might use, not one.
        ...a.city.split('/'),
        ...(HEBREW_AIRPORT_NAMES[a.iata] ? [HEBREW_AIRPORT_NAMES[a.iata]] : []),
      ],
    ]),
  )
  return cached
}
