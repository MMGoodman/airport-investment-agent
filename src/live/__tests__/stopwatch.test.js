/**
 * Three timing bugs shipped before this file existed, each found by reading a trace after
 * the fact. These pin the cases that produced them.
 */
import { describe, it, expect } from 'vitest'
import { firstTokenStages, turnHasQuestion } from '../stopwatch.js'

const labels = (marks, final = false) => firstTokenStages(marks, final).map((s) => s.label)
const from = (marks, label, final = false) =>
  firstTokenStages(marks, final).find((s) => s.label === label)?.from

describe('turnHasQuestion', () => {
  it('is false before anyone has spoken', () => {
    // The agent's opening greeting. Timing it against the last turn's marks once reported
    // 25 seconds of synthesis before a word had been said.
    expect(turnHasQuestion({ responseStart: 1000 })).toBe(false)
  })

  it('is true once speech has ended, transcript or not', () => {
    // The bug this file was written for. On a native speech-to-speech model the answer
    // begins before the transcriber finishes, so the first turn of a session had speechEnd
    // and no transcript — and the old test, "transcript exists", threw every stage away.
    expect(turnHasQuestion({ speechEnd: 12700 })).toBe(true)
  })

  it('is true once a transcript exists, for a provider that reports no speech', () => {
    expect(turnHasQuestion({ transcript: 13600 })).toBe(true)
  })
})

describe('firstTokenStages', () => {
  it('records a first answer that beat its own transcript', () => {
    // Verbatim from the trace: speech stopped 12.7s, generation began 13.4s, first token
    // 13.6s, and the transcript had not landed. This produced no timing rows at all, so a
    // report said "answer latency: not measured" for a call that answered in 900 ms.
    const marks = { speechEnd: 12700, responseStart: 13400, firstToken: 13600 }
    expect(labels(marks)).toEqual(['generate (from audio, not transcript)', 'answer'])
    expect(from(marks, 'answer')).toBe('speechEnd')
  })

  it('does not call it thinking when generation beat the transcript', () => {
    // response.created lands before the transcription event because the transcriber is a
    // second listener, not a stage in front. Measuring transcript -> firstToken there timed
    // two unrelated events and reported 6 ms of thinking.
    const marks = { speechEnd: 11000, responseStart: 11300, transcript: 12000, firstToken: 12700 }
    expect(labels(marks)).toContain('generate (from audio, not transcript)')
    expect(labels(marks)).not.toContain('think (to first word)')
  })

  it('times from silence, not from a transcript taken mid-sentence', () => {
    // A caller who keeps talking produces a transcript early in a long speech window.
    // Timing from it reported 8,623 ms of thinking for an answer that began 300 ms after
    // they stopped.
    const marks = { transcript: 18600, speechEnd: 26900, firstToken: 27200 }
    expect(from(marks, 'think (to first word)')).toBe('speechEnd')
  })

  it('names a finished message as generation, not as thinking', () => {
    const marks = { speechEnd: 1000, transcript: 1200, firstToken: 3000 }
    expect(labels(marks, true)).toContain('generate (full answer)')
    expect(labels(marks, false)).toContain('think (to first word)')
  })

  it('always reports silence to first word', () => {
    for (const marks of [
      { speechEnd: 100, responseStart: 200, firstToken: 300 },
      { speechEnd: 100, transcript: 150, firstToken: 300 },
      { transcript: 150, firstToken: 300 },
    ]) {
      expect(labels(marks)).toContain('answer')
    }
  })
})
