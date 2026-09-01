import { useCallback, useEffect, useRef, useState } from 'react'
import { startOpenAIRealtime } from './live/openaiRealtime.js'
import { startOpenAIRelay } from './live/openaiRelay.js'
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
  'openai-relay': startOpenAIRelay,
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

/**
 * The pipeline settings a session can start under.
 *
 * Only what genuinely varies per session and per room belongs here: turn detection, whose
 * right answer depends on the noise around the caller, and the vocabulary bias, whose
 * effect can only be attributed by running a session without it. Model and voice choices
 * stay deployment configuration — a switch nobody can act on is decoration.
 */
const PIPELINE_DEFAULTS = {
  vad: 'semantic', // semantic: a model judges when the thought ended · server: a silence timer
  eagerness: 'low',
  threshold: 0.5,
  silenceMs: 700,
  vocabulary: 'on',
}

export default function LivePanel({ provider, lang, onAppend, onError }) {
  const [status, setStatus] = useState('idle')
  const [muted, setMuted] = useState(false)
  const [speaking, setSpeaking] = useState(null)
  const [partial, setPartial] = useState('')
  const [events, setEvents] = useState([])
  const [verbose, setVerbose] = useState(false)
  const [pipeline, setPipeline] = useState(PIPELINE_DEFAULTS)
  // The pipeline the RUNNING call started under. Settings edited mid-call apply to the
  // next one — the ephemeral key is bound to its config — and the UI has to say so rather
  // than let a dead switch look live.
  const [activePipeline, setActivePipeline] = useState(null)

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
      if (marks.current.transcript == null && from !== 'responseStart') return
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

      // "Thinking" is only meaningful if the model waited for the transcript. On a native
      // speech-to-speech model it does not: response.created lands BEFORE the transcription
      // event, because the transcriber is a second listener running alongside the model, not
      // a stage in front of it. Measuring transcript -> firstToken there timed the gap
      // between two unrelated events and reported 6 ms and 13 ms as thinking time.
      const startedBeforeTranscript =
        marks.current.responseStart != null &&
        marks.current.transcript != null &&
        marks.current.responseStart < marks.current.transcript

      if (startedBeforeTranscript) {
        // Time it from where generation actually began. Nothing is hidden: the label says
        // which boundary it used, so two paths are never silently compared on different ones.
        stage('generate (from audio, not transcript)', 'responseStart', 'firstToken')
      } else {
        stage(final ? 'generate (full answer)' : 'think (to first word)', 'transcript', 'firstToken')
      }

      // The number that actually matters either way: silence to first word.
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
    if (session) {
      await session.stop()
    } else {
      // Nothing to close. Said out loud because the other way a hangup fails silently is
      // this branch: the panel reports the session shut while the transport runs on.
      push('session', 'nothing to hang up — no live session was held')
    }
    setStatus('idle')
  }, [push])

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
      setActivePipeline(pipeline)
      sessionRef.current = await STARTERS[provider.id]({
        audioEl: audioRef.current,
        lang,
        pipeline: {
          vad: pipeline.vad,
          ...(pipeline.vad === 'semantic'
            ? { eagerness: pipeline.eagerness }
            : { threshold: pipeline.threshold, silenceMs: pipeline.silenceMs }),
          vocabulary: pipeline.vocabulary,
        },
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

        onResponseStart: () => {
          // Every response, not just the turn's first: the second one needs its own
          // boundary or its audio gets timed against the first one's text.
          mark('responseStart')
          delete marks.current.firstAudio
        },
        onPhantom: (text) =>
          push('phantom', `dropped — the vocabulary hint read back: ${text.slice(0, 60)}…`, {
            bad: true,
          }),
        onFirstToken: () => noteFirstToken(false),
        onFirstAudio: () => {
          mark('firstAudio')
          // Only when both marks belong to the SAME response. A turn that calls a tool runs
          // two: the spoken preamble, then the answer. With no speech between them the
          // marks carried over and the gap between one response's first word and the next
          // one's first audio was reported as 2,023 ms of synthesis.
          if (marks.current.firstToken >= (marks.current.responseStart ?? 0)) {
            stage('synthesise', 'firstToken', 'firstAudio')
          }
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

          // Hang up as soon as the closing sentence is out.
          //
          // A grace window used to sit here — the line stayed open for a beat and speech
          // cancelled the hangup, to recover from the model reading a mid-conversation
          // "אוקיי תודה" as a farewell. It made the common case depend on the least
          // reliable signal in this system: VAD fires on room noise constantly in these
          // sessions, so it cancelled real goodbyes and the call could not be ended at all.
          // A wrong hangup costs one press of Start call. An un-endable call costs trust in
          // the goodbye, so the rare annoyance stays and the main path works.
          if (endAfterReply.current) {
            endAfterReply.current = false
            clearTimeout(endTimer.current)
            push('session', 'closing sentence done — hanging up')
            stop()
              .then(() => push('session', 'session closed'))
              .catch((err) => push('error', `hang-up failed: ${err.message}`))
          }
        },
        onToolCall: (record) => {
          pendingTools.current = [...pendingTools.current, record]

          if (record.tool === 'end_call' && !record.failed) {
            endAfterReply.current = true
            push('session', 'end_call seen — waiting for the closing sentence')
            // The closing line usually lands after the tool call, but a model that says it
            // first leaves no sentence to wait for. Without this the session would stay
            // open on a call both sides consider finished.
            endTimer.current = setTimeout(() => {
              if (!endAfterReply.current) return
              endAfterReply.current = false
              push('session', 'no closing sentence arrived — hanging up anyway')
              stop()
                .then(() => push('session', 'session closed'))
                .catch((err) => push('error', `hang-up failed: ${err.message}`))
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

      {/* The pipeline board. Only for the provider whose session is configured per call:
          the OpenAI path re-mints its config on every connect, so a switch here is real.
          ElevenLabs takes its pipeline at sync time and Soniox hard-codes its own — a
          panel over those would be dead switches, so they get none. */}
      {/* ElevenLabs gets no switches, and the board says why instead of vanishing: its
          pipeline is pushed at sync time, so a per-session switch would be a dead one. */}
      {provider.id === 'elevenlabs' && (
        <fieldset className="pipe" dir="rtl" disabled>
          <legend>צינור העיבוד</legend>
          <p className="pipe-hint">
            אין כאן מתגים, וזו לא שכחה: ElevenLabs מקבל את התצורה שלו ב־
            <code>npm run sync:agent</code>, לא בזמן חיבור. זיהוי תור, מתמלל ואוצר מילים
            נעולים בצד שלהם עד הסנכרון הבא — זה המחיר של פלטפורמה מנוהלת.
          </p>
        </fieldset>
      )}

      {provider.id.startsWith('openai') && (
        <fieldset className="pipe" dir="rtl" disabled={busy}>
          <legend>צינור העיבוד · לשיחה הבאה</legend>

          <div className="pipe-group">
            <p className="pipe-title">זיהוי סוף תור</p>
            <p className="pipe-hint">
              שתי השיטות רצות אצל OpenAI, על אותו אודיו — זה סוג ה־VAD, לא הארכיטקטורה.
              {provider.id === 'openai'
                ? ' השרת שלך הנפיק כרטיס ויצא; '
                : ' בנתיב הזה האודיו עובר דרך השרת שלך, אבל השיפוט עדיין אצלם; '}
              השאלה היא רק <b>מה שופט</b> שסיימת לדבר.
            </p>

            <label className="pipe-opt">
              <input
                type="radio"
                name="vad"
                checked={pipeline.vad === 'semantic'}
                onChange={() => setPipeline((p) => ({ ...p, vad: 'semantic' }))}
              />
              <span>
                <b>מודל שופט את המשמעות</b> <code>semantic_vad</code>
                <em>
                  שואל אם המחשבה נגמרה. רוכב על נשימה באמצע משפט — אבל אין לו סף עוצמה, אז
                  רעש ברקע יכול לקטוע תשובה.
                </em>
              </span>
            </label>

            {pipeline.vad === 'semantic' && (
              <div className="pipe-sub">
                <span className="pipe-sub-label">רגישות</span>
                {[
                  ['low', 'נמוכה'],
                  ['medium', 'בינונית'],
                  ['high', 'גבוהה'],
                ].map(([value, label]) => (
                  <label key={value} className="pipe-inline">
                    <input
                      type="radio"
                      name="eagerness"
                      checked={pipeline.eagerness === value}
                      onChange={() => setPipeline((p) => ({ ...p, eagerness: value }))}
                    />
                    {label}
                  </label>
                ))}
                <span className="pipe-note">נמוכה מחכה הכי הרבה לפני שהיא סוגרת תור</span>
              </div>
            )}

            <label className="pipe-opt">
              <input
                type="radio"
                name="vad"
                checked={pipeline.vad === 'server'}
                onChange={() => setPipeline((p) => ({ ...p, vad: 'server' }))}
              />
              <span>
                <b>טיימר שקט מודד עוצמה</b> <code>server_vad</code>
                <em>
                  סופר מילישניות של שקט. גס לגבי משמעות, אבל הדרך היחידה להגיד ״תתעלם ממה
                  שיותר שקט מזה״. ה־server בשם הוא <b>שלהם</b>, בניגוד לזיהוי שהדפדפן היה
                  עושה בעצמו — לא השרת שלך.
                </em>
              </span>
            </label>

            {pipeline.vad === 'server' && (
              <div className="pipe-sub">
                <div className="pipe-slider">
                  <span className="pipe-sub-label">סף עוצמה</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={pipeline.threshold}
                    onChange={(e) => setPipeline((p) => ({ ...p, threshold: Number(e.target.value) }))}
                  />
                  <b>{Number(pipeline.threshold).toFixed(2)}</b>
                  <span className="pipe-note">גבוה יותר מתעלם מרעש שקט יותר</span>
                </div>
                <div className="pipe-slider">
                  <span className="pipe-sub-label">משך שקט</span>
                  <input
                    type="range"
                    min="200"
                    max="2000"
                    step="100"
                    value={pipeline.silenceMs}
                    onChange={(e) => setPipeline((p) => ({ ...p, silenceMs: Number(e.target.value) }))}
                  />
                  <b>{pipeline.silenceMs} ms</b>
                  <span className="pipe-note">כמה שקט סוגר תור. 200 פיצל שאלה אחת לארבעה שברים</span>
                </div>
              </div>
            )}
          </div>

          <div className="pipe-group">
            <p className="pipe-title">תמלול</p>
            <label className="pipe-opt">
              <input
                type="checkbox"
                checked={pipeline.vocabulary === 'on'}
                onChange={(e) => setPipeline((p) => ({ ...p, vocabulary: e.target.checked ? 'on' : 'off' }))}
              />
              <span>
                <b>הטיית אוצר מילים</b> — לכוון את המתמלל לשדות תעופה ולמונחי התחום
                <em>תיקן קודים מרוסקים, אבל גם מושך מילים שמחוץ לתחום פנימה. כבה כדי למדוד.</em>
              </span>
            </label>
          </div>

          {connected && activePipeline && JSON.stringify(activePipeline) !== JSON.stringify(pipeline) && (
            <p className="pipe-stale">השיחה הפעילה התחילה בהגדרות אחרות — אלה יחולו מהשיחה הבאה.</p>
          )}
        </fieldset>
      )}

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
