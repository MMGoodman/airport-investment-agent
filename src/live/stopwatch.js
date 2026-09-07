/**
 * Which timings an answer can report, given what has been marked so far.
 *
 * Pure, and in its own file, because this is the third bug in this decision and every one
 * of them was found by reading a trace afterwards: a "think" that measured event skew, one
 * that measured from a stale transcript, and one that recorded nothing at all. Nothing in
 * the panel could be tested, so nothing was.
 *
 * `marks` holds timestamps under speechEnd / transcript / responseStart / firstToken. A key
 * that is absent has not happened yet.
 */

/**
 * Did this turn have a question in front of it?
 *
 * The agent's opening greeting has none, and timing it against the previous turn's marks is
 * what produced 25 seconds of synthesis before anyone had spoken. The old test was
 * "transcript exists", which quietly required the transcriber to finish before the answer
 * started. On a native speech-to-speech model it does not: the transcriber runs alongside
 * the model, so the first answer of a session had no transcript yet and every stage was
 * dropped. It only ever passed because a previous turn's transcript was still lying around
 * — the same stale mark that caused the second bug.
 *
 * Speech ending is the honest signal that someone asked something.
 */
export function turnHasQuestion(marks) {
  return marks.speechEnd != null || marks.transcript != null
}

/**
 * The stages to emit when an answer's first token lands.
 *
 * `final` distinguishes what is being measured: a partial means this is genuinely
 * time-to-first-word, while a provider that only hands over the finished message is telling
 * us when generation ENDED. Naming both "think" would flatter the slower one.
 */
export function firstTokenStages(marks, final) {
  // Generation began before the transcript existed — including the case where it still does
  // not exist, which is the same fact and used to be read as its opposite.
  const startedBeforeTranscript =
    marks.responseStart != null &&
    (marks.transcript == null || marks.responseStart < marks.transcript)

  const stages = []

  if (startedBeforeTranscript) {
    // Time it from where generation actually began. Nothing is hidden: the label says which
    // boundary it used, so two paths are never silently compared on different ones.
    stages.push({
      label: 'generate (from audio, not transcript)',
      from: 'responseStart',
      to: 'firstToken',
    })
  } else {
    // From the later of the two boundaries. A caller who keeps talking produces a transcript
    // early in a long speech window, and timing from it reported 8,623 ms of thinking for an
    // answer that began 300 ms after they stopped.
    stages.push({
      label: final ? 'generate (full answer)' : 'think (to first word)',
      from: marks.speechEnd > marks.transcript ? 'speechEnd' : 'transcript',
      to: 'firstToken',
    })
  }

  /**
   * The number that actually matters either way: silence to first word.
   *
   * `beforeTranscript` travels with it because the two are not the same measurement. When
   * generation began before the transcript existed, the model was not answering the question
   * — it had not been given one in text yet. Measured live: a turn where the model said
   * "let me rank the top three for you" 251 ms after the caller stopped, called a tool, and
   * delivered the actual answer seven seconds later. Both are true; only one belongs in a
   * mean next to answers that WERE answers, and it pulled a five-turn session from 1,337 to
   * 1,120 ms on its own.
   */
  stages.push({
    label: 'answer',
    from: marks.speechEnd != null ? 'speechEnd' : 'transcript',
    to: 'firstToken',
    beforeTranscript: startedBeforeTranscript,
  })

  return stages
}
