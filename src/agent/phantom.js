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
  if (!text || terms.length === 0 || text.length < 60) return false
  const lower = text.toLowerCase()
  let hits = 0
  for (const term of terms) {
    if (lower.includes(term.toLowerCase()) && ++hits >= PHANTOM_TERM_THRESHOLD) return true
  }
  return false
}
