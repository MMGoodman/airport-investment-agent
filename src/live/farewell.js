/**
 * Did the caller actually say goodbye?
 *
 * WHY THIS IS NOT A PROMPT RULE
 *
 * It was one, and it lost. The rule against hanging up on a bare thank-you is in the prompt,
 * it reaches the model before the decision it governs, and it still fails: eight samples of
 * each case put "תודה רבה" at 16/24 — the rule is present and losing, not absent. On a
 * sampled model an instruction is a prior, not a guarantee, and a third of a chance of
 * cutting a caller off mid-conversation is not a demo you can give.
 *
 * So the decision moves to where it can be made deterministically. `end_call` is a tool; the
 * browser watches for it and hangs up. This decides whether that hang-up happens.
 *
 * THE ASYMMETRY IS DELIBERATE
 *
 * A missed goodbye costs a caller one more sentence: they say "ביי" and it ends. A false
 * goodbye ends a conversation someone was still having. Those are not equally bad, so this
 * requires an explicit marker rather than trying to judge intent — thanks, acknowledgements
 * and satisfied noises all keep the line open, no matter how final they sound.
 */

/**
 * Explicit endings, and nothing that merely tends to precede one.
 *
 * "תודה" is absent on purpose and is the whole reason this file exists. So is "אוקיי", which
 * ended a call in testing, and "שלום", which opens as often as it closes.
 */
const MARKERS = [
  // Hebrew
  'ביי',
  'להתראות',
  'לנתק',
  'תנתק',
  'ננתק',
  'סיימתי',
  'סיימנו',
  'גמרנו',
  'זה הכל',
  'זהו לעכשיו',
  /**
   * The forms the PROMPT promises, which this list did not accept.
   *
   * `end_call`'s own description says "Explicit means בי, להתראות, סיימתי, אפשר לסיים", and
   * the call-control skill repeats it. This list held four of those five: `אפשר לסיים` was
   * missing, so a caller who said exactly what the system tells them to say had their hangup
   * refused — the model called end_call correctly, the gate declined it, and the agent
   * announced "ניתוק כעת" over a line that stayed open.
   *
   * Measured in a live call, twice in ninety seconds. The rest are the ordinary imperatives
   * a Hebrew speaker reaches for and no list written in one sitting contains: the transcript
   * that failed said "סיים תוסיפה" for what was plainly "סיים את השיחה".
   *
   * Two lists that must agree, in two files, with only the gate able to act — that is the
   * shape of every quiet failure this project has found. This closes today's gap; the real
   * fix is one list both sides read.
   */
  'אפשר לסיים',
  'אפשר לנתק',
  'סיים את השיחה',
  'תסיים את השיחה',
  /**
   * A BARE `סיים` WAS HERE AND HAD TO COME OUT.
   *
   * It caught the garbled transcript this list was written for — "סיים תוסיפה" for what was
   * plainly "סיים את השיחה" — and it also caught "אני רוצה לסיים את הבדיקה של הדירוג",
   * which is somebody finishing a TASK and staying on the line. Hanging up on that is the
   * expensive direction, and the whole reason the gate exists is that ending a call nobody
   * ended is worse than failing to end one they did.
   *
   * Which leaves the garbled transcript unmatched, and that is the honest state of it: a
   * word list cannot rescue a transcription that produced a different word. The way out of a
   * call whose transcript is failing is the End call button, which is on the screen and
   * needs no transcript at all.
   */
  // English, for a call switched to EN mid-session
  'bye',
  'goodbye',
  'good bye',
  'hang up',
  'end the call',
  "that's all",
  'thats all',
  "we're done",
  'we are done',
  'im done',
  "i'm done",
]

/**
 * @param text the caller's last utterance, as transcribed
 * @returns whether it contains an explicit goodbye
 */
export function isFarewell(text) {
  if (!text) return false
  // Lowercased for the English half; Hebrew has no case and is unaffected.
  const said = String(text)
    .toLowerCase()
    // Apostrophes vanish rather than becoming spaces, so "that's all" and "thats all" are
    // the same string — the transcriber writes either, and a marker list cannot hold both
    // spellings of every contraction.
    .replace(/['’׳״]/g, '')
    // The rest becomes space: "ביי." and "ביי" are the same word.
    .replace(/[.,!?;:"]/g, ' ')
  return MARKERS.some((marker) => said.includes(marker.replace(/'/g, '')))
}
