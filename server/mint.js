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

/**
 * How long one attempt waits, and how many there are.
 *
 * A healthy mint takes 237-385ms, measured. 3s is roughly ten times that: long enough that
 * a slow answer still arrives, short enough that three attempts fit inside the time somebody
 * is willing to stare at a button that did nothing.
 *
 * It was one 6s timeout and one immediate retry, and that failed in front of a caller: both
 * attempts landed inside the same blip, back to back, and the panel reported the honest but
 * useless "nothing came back — try again". Retrying instantly is barely retrying. The whole
 * point of a second attempt is that conditions changed between them, and nothing changes in
 * the microsecond it takes to call fetch again.
 */
const MINT_TIMEOUT_MS = 3000
const BACKOFF_MS = [300, 900]

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function mintFetch(url, options = {}, label = 'the provider') {
  let firstError = null
  const attempts = BACKOFF_MS.length + 1

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(MINT_TIMEOUT_MS) })
    } catch (err) {
      // AbortSignal.timeout raises TimeoutError; a refused or reset socket arrives as a
      // TypeError with the real reason on .cause. Both mean nothing was answered.
      firstError = firstError ?? err
      if (attempt === attempts) throw firstError
      const why = err.cause?.code ?? err.cause?.message ?? err.name
      const pause = BACKOFF_MS[attempt - 1]
      console.warn(
        `mint: ${label} did not answer within ${MINT_TIMEOUT_MS}ms (${why}) — retry ${attempt} of ${attempts - 1} in ${pause}ms`,
      )
      await wait(pause)
    }
  }
}
