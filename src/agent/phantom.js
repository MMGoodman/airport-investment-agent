/**
 * Detecting the transcription hint being read back as if the caller had said it.
 *
 * A file of its own, with no imports, because of where it has to run. The hint is built in
 * vocabulary.js, which reads the airport dataset and therefore pulls in node:fs and
 * node:url; the live transports that need this test run in the browser. Putting the
 * function beside the hint that produces it cost the page its module graph — vite
 * externalizes node builtins rather than failing the build, so it compiled clean and threw
 * on load. Kept apart, both sides can have it.
 */

/** Above this many of the hint's own terms, the transcript is the hint talking. */
export const PHANTOM_TERM_THRESHOLD = 10

/** Below this many, a dense transcript is just a short answer that happens to be a term. */
export const PHANTOM_MIN_TERMS = 3

/** How much of a transcript must BE hint terms before it is the hint rather than a question. */
export const PHANTOM_DENSITY = 0.8

/**
 * Is this transcript the vocabulary hint being read back?
 *
 * The hint is a prior. Given one and a stretch of near-silence to describe, a transcriber
 * can emit the prior itself: one session recorded all forty domain terms in list order,
 * ending in "לוס אנג׳לס", as something a caller had said after one word.
 *
 * Nobody says ten domain terms in one breath, so the count separates the two cleanly — a
 * real question about Boston's load factor hits two or three. The length floor keeps a
 * short answer that happens to be a term ("מנצ׳סטר") out of it entirely.
 */
export function isHintEcho(text, terms = []) {
  if (!text || terms.length === 0) return false
  const lower = text.toLowerCase()

  const matched = []
  for (const term of terms) {
    if (term && lower.includes(term.toLowerCase())) matched.push(term)
  }
  if (matched.length === 0) return false

  // The original rule: nobody says ten domain terms in one breath.
  if (text.length >= 60 && matched.length >= PHANTOM_TERM_THRESHOLD) return true

  /**
   * And the shorter echo the count rule let through.
   *
   * Measured, on a live call: `מנצ׳סטר, ניו הייבן, לוס אנג׳לס, שדה תעופה, שדות תעופה,
   * טרמינל.` — six terms, so under the threshold of ten, and it entered the conversation as
   * something the caller had said.
   *
   * What separates it from a real question is not how many terms it holds but how little
   * else. A caller asking about Boston's load factor spends most of their sentence on words
   * that are not in the hint; an echo is the hint, with commas. So: is nearly all of this
   * text accounted for by terms?
   *
   * Three at minimum, because a one-word answer ("מנצ׳סטר") is entirely a term and entirely
   * legitimate, and two are an ordinary comparison.
   */
  if (matched.length >= PHANTOM_MIN_TERMS) {
    // Longest first, so "שדות תעופה" is not measured as the shorter "שדה תעופה".
    const byLength = [...matched].sort((a, b) => b.length - a.length)
    let rest = lower
    let covered = 0
    for (const term of byLength) {
      const t = term.toLowerCase()
      while (rest.includes(t)) {
        covered += t.length
        rest = rest.replace(t, ' '.repeat(t.length))
      }
    }
    // Punctuation and spacing do not count against the density — an echo is a comma-
    // separated list and would otherwise be diluted by its own separators.
    const meaningful = text.replace(/[\s,.;:!?׳״"'()\-]/g, '').length
    if (meaningful > 0 && covered / meaningful >= PHANTOM_DENSITY) return true
  }

  return false
}
