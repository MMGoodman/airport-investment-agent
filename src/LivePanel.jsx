import { useCallback, useEffect, useRef, useState } from 'react'
import { startOpenAIRealtime } from './live/openaiRealtime.js'
import { startElevenLabs } from './live/elevenlabs.js'
import { startSoniox } from './live/soniox.js'
import LiveTrace from './LiveTrace.jsx'
import { setToolSession, reconcileTools } from './live/tools.js'

/**
 * The live-voice control surface.
 *
 * Owns one session at a time. Whatever the provider, the shape is identical: speech in,
 * tool calls against the deterministic engine, speech out — and every completed turn is
 * pushed into the same message list the text path writes to, so the tool trace panel
 * renders live answers exactly the way it renders typed ones.
 */

const STARTERS = {
  openai: startOpenAIRealtime,
  elevenlabs: startElevenLabs,
  soniox: startSoniox,
}

const STATUS_LABEL = {
  idle: 'not connected',
  'minting key': 'authorising…',
  'opening microphone': 'microphone…',
  connecting: 'connecting…',
  live: 'live',
}

/** Raw provider events that say nothing a reader needs; they drown the useful ones. */
const RAW_NOISE = new Set([
  'response.output_audio.delta',
  'response.output_audio_transcript.delta',
  'response.function_call_arguments.delta',
  'output_audio_buffer.started',
  'audio',
])

const MAX_EVENTS = 300

export default function LivePanel({ provider, lang, onAppend, onError }) {
  const [status, setStatus] = useState('idle')
  const [muted, setMuted] = useState(false)
  const [speaking, setSpeaking] = useState(null)
  const [partial, setPartial] = useState('')
  const [events, setEvents] = useState([])
  const [verbose, setVerbose] = useState(false)

  const sessionRef = useRef(null)
  const audioRef = useRef(null)
  const t0 = useRef(0)
  const seq = useRef(0)
  // When the speaker stopped, so the gap until the first spoken word can be measured.
  // That gap is the number that actually matters in a voice agent.
  const speechWasOpen = useRef(false)
  // Timestamps for the boundaries of one turn. A single "answer latency" number says a
  // path is slow; these say WHICH stage is slow, which is the only version you can act on.
  const marks = useRef({})
  // Tools called since the last completed answer; they attach to the answer they produced.
  const pendingTools = useRef([])
  // Every claim made this session, for the audit — the server log is session-wide, so the
  // comparison has to be too.
  const claimedTools = useRef([])
  // end_call is acknowledged by the server but performed here — closing a WebRTC session is
  // something only this side can do. Hang up after the closing sentence has been spoken, not
  // the instant the tool fires, or the caller hears the line cut off mid-word.
  const endAfterReply = useRef(false)
  const endTimer = useRef(null)

  const mark = useCallback((name) => {
    marks.current[name] = performance.now()
  }, [])

  const push = useCallback((kind, text, extra = {}) => {
    const t = (performance.now() - t0.current) / 1000
    setEvents((prev) => {
      const next = [...prev, { id: ++seq.current, t, kind, text, ...extra }]
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
    })
  }, [])

  /**
   * Emit the gap between two marks, if both happened.
   *
   * Which gaps a provider can report is itself the comparison. A native speech-to-speech
   * model has no separate recognise or synthesise stage to time — there is one model and
   * one number. A cascade has three, and one of them is always the culprit.
   */
  const stage = useCallback(
    (label, from, to) => {
      // Every stage is scoped to one answer, and an answer starts with a question. The
      // agent's opening greeting has no question in front of it, so it is not a turn and
      // has nothing to time.
      if (marks.current.transcript == null) return
      const a = marks.current[from]
      const b = marks.current[to]
      if (a == null || b == null) return
      // A native model emits its first token and its first audio together, so the order
      // between them is arbitrary and the gap is noise. Clamping at zero states that
      // plainly; dropping the row would hide the very thing worth seeing.
      push('timing', label, { ms: Math.max(0, Math.round(b - a)) })
    },
    [push],
  )

  /**
   * The moment this turn's answer begins, whichever event gets there first.
   *
   * It used to be marked in one place and staged in another, so a streamed partial would
   * take the mark and the staging that followed it found the mark already set and recorded
   * nothing. Both live here now.
   *
   * `final` distinguishes what is being measured: partials mean this is genuinely
   * time-to-first-word, while a provider that only hands over the finished message is
   * telling us when generation ENDED. Naming both "think" would flatter the slower one.
   */
  const noteFirstToken = useCallback(
    (final) => {
      if (marks.current.firstToken) return
      mark('firstToken')
      stage(final ? 'generate (full answer)' : 'think (to first word)', 'transcript', 'firstToken')
      stage('answer', marks.current.speechEnd ? 'speechEnd' : 'transcript', 'firstToken')
    },
    [mark, stage],
  )

  const stop = useCallback(async () => {
    clearTimeout(endTimer.current)
    endAfterReply.current = false
    const session = sessionRef.current
    sessionRef.current = null
    setPartial('')
    setSpeaking(null)
    if (session) await session.stop()
    setStatus('idle')
  }, [])

  // A provider or language switch must not leave a microphone open on the old session.
  useEffect(() => () => void stop(), [provider, lang, stop])

  async function start() {
    if (sessionRef.current) return
    t0.current = performance.now()
    seq.current = 0
    // A stopwatch left running from the last call measured across both of them and
    // reported 25 seconds of synthesis before anyone had spoken.
    marks.current = {}
    setEvents([])
    setStatus('minting key')
    pendingTools.current = []
    claimedTools.current = []
    // Tags every tool call this call makes, so the server's record of them can be looked up
    // as a set afterwards rather than one at a time.
    setToolSession(crypto.randomUUID())
    push('session', `${provider.label} · ${lang === 'he' ? 'Hebrew' : 'English'}`)

    try {
      sessionRef.current = await STARTERS[provider.id]({
        audioEl: audioRef.current,
        lang,
        onStatus: (s) => {
          setStatus(s)
          push('session', s)
        },
        onRawEvent: (type) => {
          if (!RAW_NOISE.has(type)) push('raw', type)
        },
        onSpeaking: (who) => {
          setSpeaking(who)
          if (who === null && speechWasOpen.current) {
            speechWasOpen.current = false
            mark('speechEnd')
          }
          if (who === 'user') {
            speechWasOpen.current = true
            marks.current = {} // new turn, new stopwatch
          }
        },
        onUserTranscript: (text) => {
          // A transcript arriving after an answer means a new turn. OpenAI resets on
          // speech_started, but the cascade never reports that a person began talking, so
          // its opening greeting set firstToken once and nothing was ever measured again.
          if (marks.current.firstToken) marks.current = {}
          mark('transcript')
          push('you', text)
          onAppend({ role: 'user', content: text })
          stage('recognise', 'speechEnd', 'transcript')
        },

        onFirstToken: () => noteFirstToken(false),
        onFirstAudio: () => {
          mark('firstAudio')
          stage('synthesise', 'firstToken', 'firstAudio')
          stage('answer', 'speechEnd', 'firstAudio')
        },
        onAssistantTranscript: (text, final) => {
          // First words of the turn, partial or final.
          noteFirstToken(final)
          if (!final) {
            setPartial((prev) => prev + text)
            return
          }
          setPartial('')
          push('agent', text)
          const attached = pendingTools.current
          onAppend({ role: 'assistant', content: text, toolCalls: attached })
          pendingTools.current = []

          // Check the session's trace against the server's own record. The engine ran here
          // either way — what is being verified is that the trace the reader is looking at
          // describes the calls that actually happened, and not a set the client composed.
          //
          // The whole session's claims, not this answer's: the server log is per session,
          // and comparing one answer against it flagged every EARLIER answer's calls as
          // hidden — a red audit line on a session doing everything right.
          if (attached.length) {
            claimedTools.current = [...claimedTools.current, ...attached]
            reconcileTools(claimedTools.current).then((audit) => {
              if (!audit) return
              push(
                'audit',
                audit.ok
                  ? `${audit.serverCalls} tool ${audit.serverCalls === 1 ? 'call' : 'calls'} match the server log`
                  : `trace does not match the server log — ` +
                      [
                        audit.fabricated.length && `${audit.fabricated.length} not run`,
                        audit.altered.length && `${audit.altered.length} altered`,
                        audit.omitted.length && `${audit.omitted.length} hidden`,
                      ]
                        .filter(Boolean)
                        .join(', '),
                { bad: !audit.ok },
              )
            })
          }


          if (endAfterReply.current) {
            endAfterReply.current = false
            clearTimeout(endTimer.current)
            push('session', 'ending the call')
            stop()
          }
        },
        onToolCall: (record) => {
          pendingTools.current = [...pendingTools.current, record]

          if (record.tool === 'end_call' && !record.failed) {
            endAfterReply.current = true
            // The closing line usually lands after the tool call, but a model that says it
            // first leaves no sentence to wait for. Without this the session would stay
            // open on a call both sides consider finished.
            endTimer.current = setTimeout(() => {
              if (!endAfterReply.current) return
              endAfterReply.current = false
              push('session', 'ending the call')
              stop()
            }, 6000)
          }
          const args = Object.entries(record.args ?? {})
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join(' · ')
          push('tool', `${record.tool}${args ? `  ${args}` : ''}`)
          // Payload size is usually the reason a spoken answer was slow to start.
          push('result', `${record.tool} returned`, {
            bytes: JSON.stringify(record.result).length,
            ms: record.ms,
          })
        },
        onError: (err) => {
          push('error', err.message)
          onError(err.message)
        },
      })
    } catch (err) {
      sessionRef.current = null
      setStatus('idle')
      push('error', err.message)
      onError(err.message)
    }
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    sessionRef.current?.setMuted(next)
  }

  const connected = status === 'live'
  const busy = status !== 'idle' && !connected

  return (
    <div className={`live ${connected ? 'on' : ''}`}>
      <audio ref={audioRef} autoPlay />

      <div className="live-main">
        <button
          type="button"
          className={`live-btn ${connected ? 'end' : 'start'}`}
          onClick={connected || busy ? stop : start}
          disabled={!provider.available}
        >
          {connected ? 'End call' : busy ? 'Cancel' : 'Start call'}
        </button>

        <div className="live-meta">
          <span className={`live-status ${connected ? 'up' : ''}`}>
            <span className="dot" aria-hidden="true" />
            {STATUS_LABEL[status] ?? status}
          </span>
          <span className="live-transport">{provider.pipeline ?? provider.transport}</span>
        </div>

        {connected && (
          <button
            type="button"
            className={`ghost ${muted ? 'live' : ''}`}
            onClick={toggleMute}
            aria-pressed={muted}
            title={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        )}
      </div>

      <p className="live-hint">
        {!provider.available ? (
          <span className="hint-warn">
            {provider.note ?? 'No key in .env — the switcher shows it, but it cannot connect.'}
          </span>
        ) : speaking === 'user' ? (
          'listening…'
        ) : speaking === 'assistant' ? (
          'speaking — interrupt any time, it will stop and listen'
        ) : connected ? (
          'Ask out loud. Same five tools, same numbers as the text path.'
        ) : (
          `${provider.pipeline ?? provider.model} · the model still computes nothing`
        )}
      </p>

      {partial && <p className="live-partial">{partial}</p>}

      <LiveTrace
        events={events}
        verbose={verbose}
        onVerbose={setVerbose}
        onClear={() => setEvents([])}
        provider={provider}
        lang={lang}
      />
    </div>
  )
}
