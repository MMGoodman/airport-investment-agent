import { useCallback, useEffect, useRef, useState } from 'react'
import { startOpenAIRealtime } from './live/openaiRealtime.js'
import { startElevenLabs } from './live/elevenlabs.js'
import { startSoniox } from './live/soniox.js'
import LiveTrace from './LiveTrace.jsx'

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
      const a = marks.current[from]
      const b = marks.current[to]
      if (a == null || b == null) return
      push('timing', label, { ms: Math.round(b - a) })
    },
    [push],
  )

  const stop = useCallback(async () => {
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
    setEvents([])
    setStatus('minting key')
    pendingTools.current = []
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
          mark('transcript')
          push('you', text)
          onAppend({ role: 'user', content: text })
          stage('recognise', 'speechEnd', 'transcript')
        },

        // Only a path we assemble ourselves can report this: the model has produced its
        // first token but no sound has come out yet.
        onFirstToken: () => mark('firstToken'),
        onFirstAudio: () => {
          mark('firstAudio')
          stage('synthesise', 'firstToken', 'firstAudio')
          stage('answer', 'speechEnd', 'firstAudio')
        },
        onAssistantTranscript: (text, final) => {
          // First words of the turn, partial or final.
          if (!marks.current.firstToken) {
            mark('firstToken')
            stage('think', 'transcript', 'firstToken')
            // The honest fallback when a provider never told us when speech stopped.
            stage('answer', marks.current.speechEnd ? 'speechEnd' : 'transcript', 'firstToken')
          }
          if (!final) {
            setPartial((prev) => prev + text)
            return
          }
          setPartial('')
          push('agent', text)
          onAppend({ role: 'assistant', content: text, toolCalls: pendingTools.current })
          pendingTools.current = []
        },
        onToolCall: (record) => {
          pendingTools.current = [...pendingTools.current, record]
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
