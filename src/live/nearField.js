/**
 * A gate that opens for the person holding the microphone and nobody else.
 *
 * WHY NOTHING ELSE WORKED
 *
 * Every other control lives inside a provider and judges audio it has already been given.
 * A VAD threshold, ignore-terms, interrupt off — all of them run after the sound has left
 * this machine, and by then a friend on a Zoom call two metres away is simply speech.
 * Measured, in exactly that situation: the agent stopped and listened to him.
 *
 * The one thing that still separates the two is DISTANCE, and distance survives only as
 * loudness. So the gate runs here, before anything is sent: below the line, the microphone
 * track is off and the provider never learns the sound existed.
 *
 * WHY autoGainControl IS THE ENEMY OF THIS
 *
 * It is on for the session track, and it should be — it makes a quiet speaker audible. But
 * it does that by normalising loudness, which is precisely the difference this gate reads.
 * A voice across the room gets boosted to yours, and after that no threshold anywhere can
 * tell them apart. So the measurement runs on a SECOND stream from the same microphone,
 * opened with every enhancement off, and the session's own track keeps them.
 *
 * Two streams from one device is ordinary; the browser mixes nothing and the second costs
 * an analyser node.
 *
 * WHY IT IS NOT PUSH-TO-TALK
 *
 * Push-to-talk is still the only guarantee and it stays. This is for when you want your
 * hands, and it fails softer: a gate set too high loses a quiet sentence, which you notice
 * immediately, rather than answering a question you did not ask.
 */

/** Room noise floor to a normal speaking voice is roughly 0.01 → 0.2 in this measure. */
export const NEAR_FIELD_DEFAULT = 0.06

/**
 * Once open, stay open this long after dropping below the line.
 *
 * Speech is not continuous — a pause between words falls under any threshold, and a gate
 * without hysteresis chops a sentence into a dozen turns. 700 ms rides a breath and still
 * closes well inside the silence that ends a turn.
 */
const HOLD_MS = 700

/** How often the level is read. 50 ms is four hundred samples a second of nothing. */
const TICK_MS = 50

/**
 * @param onGate  called with true when the mic should be OPEN, false when shut
 * @param onLevel called with the current level, for a meter — a threshold you cannot see
 *                is a threshold nobody can set
 * @returns { setThreshold, close }
 */
export async function startNearFieldGate({ threshold = NEAR_FIELD_DEFAULT, onGate, onLevel }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // All three off, deliberately. See the note above: they exist to flatten exactly the
      // difference this reads.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })

  const ctx = new (window.AudioContext ?? window.webkitAudioContext)()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  // Some smoothing, or the meter is unreadable and the gate chatters on single frames.
  analyser.smoothingTimeConstant = 0.4
  source.connect(analyser)

  const buf = new Float32Array(analyser.fftSize)
  let level = threshold
  let open = false
  let openedUntil = 0

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf)
    // RMS, not peak: a click is loud and brief, a voice is sustained. Peak opens the gate
    // for a dropped pen.
    let sum = 0
    for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    onLevel?.(rms)

    const now = Date.now()
    if (rms >= level) openedUntil = now + HOLD_MS

    const shouldBeOpen = now < openedUntil
    if (shouldBeOpen !== open) {
      open = shouldBeOpen
      onGate?.(open)
    }
  }, TICK_MS)

  return {
    setThreshold(next) {
      level = next
    },
    close() {
      clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
      // Closing the context releases the audio thread; a session started and stopped a
      // dozen times otherwise leaves a dozen running.
      void ctx.close()
    },
  }
}
