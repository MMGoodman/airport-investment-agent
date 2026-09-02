/**
 * Fetch a short-lived credential, surviving one dropped connection.
 *
 * WHY THIS EXISTS
 *
 * Three providers are reached at the same moment for the same reason: the caller has
 * pressed Start call and the whole session is waiting on a token. A socket that never
 * opens ends that attempt after ten seconds of nothing — undici's invisible default —
 * with an on-screen instruction to try again. That advice is correct and it is being
 * given to the wrong party: the retry is a request for a fresh token, it is idempotent,
 * and it costs nothing to repeat.
 *
 * Observed once on the ElevenLabs path with the provider answering in 386ms either side
 * of the failure, so the blip really is a blip.
 *
 * WHAT IS NOT RETRIED
 *
 * Anything that came back. An HTTP status is an answer, and a 401 asked twice is wrong
 * twice, more slowly — the key needs changing, not repeating. Only a transport failure
 * qualifies: no status, nothing to read, nobody home.
 *
 * The timeout is ours and stated, at well under undici's ten seconds, so the ordinary
 * case — one blip, one retry — finishes sooner than the old dead end failed.
 */

/** 15x the 386ms a healthy mint takes. Long enough to be slow, short enough to retry twice. */
const MINT_TIMEOUT_MS = 6000

export async function mintFetch(url, options = {}, label = 'the provider') {
  let firstError = null

  for (const attempt of [1, 2]) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(MINT_TIMEOUT_MS) })
    } catch (err) {
      // AbortSignal.timeout raises TimeoutError; a refused or reset socket arrives as a
      // TypeError with the real reason on .cause. Both mean nothing was answered.
      firstError = firstError ?? err
      if (attempt === 2) throw firstError
      const why = err.cause?.code ?? err.cause?.message ?? err.name
      console.warn(`mint: ${label} did not answer within ${MINT_TIMEOUT_MS}ms (${why}) — retrying once`)
    }
  }
}
