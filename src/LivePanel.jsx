import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { startOpenAIRealtime } from './live/openaiRealtime.js'
import { startOpenAIRelay } from './live/openaiRelay.js'
import { firstTokenStages, turnHasQuestion } from './live/stopwatch.js'
import { startElevenLabs } from './live/elevenlabs.js'
import { startSoniox } from './live/soniox.js'
import LiveTrace from './LiveTrace.jsx'
import { setToolSession, getToolSession, reconcileTools } from './live/tools.js'

/**
 * The live-voice control surface.
 *
 * Owns one session at a time. Whatever the provider, the shape is identical: speech in,
 * tool calls against the deterministic engine, speech out — and every completed turn is
 * pushed into the same message list the text path writes to, so the tool trace panel
 * renders live answers exactly the way it renders typed ones.
 */

const STARTERS = {
  // Same function, one option apart. The plain entry leaves the server-placed tools
  // withheld and the model says so; the hybrid entry lets this server join the call and
  // answer them. Everything else about the two is identical, which is what makes a trace
  // from one comparable with a trace from the other.
  openai: (opts) => startOpenAIRealtime({ ...opts, sideband: false }),
  'openai-hybrid': (opts) => startOpenAIRealtime({ ...opts, sideband: true }),
  'openai-relay': startOpenAIRelay,
  elevenlabs: startElevenLabs,
  // Same client, different synced agent. The choice travels to the signed-url route, which
  // holds both ids next to the API key rather than exposing either to the page.
  'elevenlabs-hybrid': (opts) => startElevenLabs({ ...opts, agent: 'hybrid' }),
  soniox: startSoniox,
}

/**
 * The connection's states. Anything a transport reports that is not one of these is a
 * notice about the session, not a state of it.
 *
 * The distinction was implicit and then it broke: the sideband reports whether it attached,
 * which happens AFTER the data channel opens, and that line landed in `status`. So the
 * panel went live, said "End call", and a moment later decided it was mid-connection again
 * and offered "Cancel" — with the call running the whole time. One field was carrying the
 * state machine and the commentary at once, and the commentary won because it came last.
 */
const STATUS_LABEL = {
  idle: 'not connected',
  'minting key': 'authorising…',
  'opening microphone': 'microphone…',
  connecting: 'connecting…',
  live: 'live',
}
const IS_STATE = (s) => Object.hasOwn(STATUS_LABEL, s)

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
/** One line naming a pipeline, for saying what a running call is actually on. */
const describePipeline = (p) =>
  (p.vad === 'semantic'
    ? `מודל שופט משמעות · רגישות ${{ low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' }[p.eagerness] ?? p.eagerness}`
    : `טיימר שקט · סף ${Number(p.threshold).toFixed(2)} · ${p.silenceMs}ms · ריפוד ${p.prefixMs}ms`) +
  `${p.interrupt === 'on' ? '' : ' · בלי קטיעה'}` +
  `${p.vocabulary === 'on' ? ' · הטיית אוצר מילים' : ''}`

const PIPELINE_DEFAULTS = {
  vad: 'semantic', // semantic: a model judges when the thought ended · server: a silence timer
  eagerness: 'low',
  threshold: 0.5,
  silenceMs: 700,
  // Audio kept from BEFORE speech was detected. The server has always accepted it and the
  // panel never sent it, so it sat on its default while the one symptom it addresses —
  // a clipped first syllable — had no control anywhere in the UI.
  prefixMs: 300,
  interrupt: 'on', // whether detected speech cancels the answer already being spoken
  vocabulary: 'on',
}

/**
 * Render `node` into `slot` when the workspace offers one, in place otherwise.
 *
 * The three parts of this panel belong in three different columns now — the settings on
 * the left, the controls in the middle, the trace on the right — but the state behind them
 * is one machine: marks, pending tools, the audit claim set, the end-of-call timer. Lifting
 * that out would be a rewrite of the piece the session is tested against every few minutes.
 *
 * A portal moves where a thing is drawn without moving where it lives, which is exactly the
 * distinction being made. Without a slot it renders inline, so the panel still works on its
 * own — which is what keeps this a layout decision rather than a dependency.
 */
const into = (slot, node) => (slot ? createPortal(node, slot) : node)

/**
 * Render only into a slot, or not at all.
 *
 * The pipeline board is settings for the NEXT call. Falling back to inline put it at the
 * bottom of the running conversation, which is both the wrong place and the wrong moment —
 * a wall of switches under the answer you are reading, none of which affect the call they
 * are sitting in. Without a slot it simply does not draw; its state lives here either way,
 * so opening the sidebar pane brings it back exactly as it was.
 */
const onlyInto = (slot, node) => (slot ? createPortal(node, slot) : null)

/**
 * Arguments as a trace reads them.
 *
 * An object argument used to render as "[object Object]" — weights, which is the one
 * argument whose value would actually explain a surprising ranking. Shared because the
 * browser's own calls and the ones replayed from the server log are the same rows to a
 * reader, and two formatters would eventually disagree about that.
 */
const formatArgs = (args) =>
  Object.entries(args ?? {})
    .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`)
    .join(' · ')

export default function LivePanel({ provider, lang, onAppend, onAmendTools, onEnded, onError, slots }) {
  const [status, setStatus] = useState('idle')
  const [muted, setMuted] = useState(false)
  const [speaking, setSpeaking] = useState(null)
  const [partial, setPartial] = useState('')
  const [events, setEvents] = useState([])
  const [verbose, setVerbose] = useState(false)
  const [pipeline, setPipeline] = useState(PIPELINE_DEFAULTS)
  /** What this connection can reach, as the transport reported it. */
  const [toolLine, setToolLine] = useState(null)
  /** Microphone closed unless a key is held. Survives across calls — it is how you test. */
  const [pushToTalk, setPushToTalk] = useState(false)
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
  /** Server-run calls already pushed, so a per-turn reconcile does not repeat them. */
  const serverShown = useRef(new Set())
  // end_call is acknowledged by the server but performed here — closing a WebRTC session is
  // something only this side can do. Hang up after the closing sentence has been spoken, not
  // the instant the tool fires, or the caller hears the line cut off mid-word.
  // Set the first time a provider says someone started talking. The cascade never does,
  // and the two need opposite handling of a transcript that arrives during an answer.
  const reportsSpeech = useRef(false)
  /** What the whole session did, counted as it happens so the 300-event ring cannot lose it. */
  const sessionTotals = useRef({ events: 0, answers: [], stages: {}, payloads: [] })
  const resetTotals = useCallback(() => {
    sessionTotals.current = { events: 0, answers: [], stages: {}, payloads: [] }
  }, [])
  const endAfterReply = useRef(false)
  const endTimer = useRef(null)

  const mark = useCallback((name) => {
    marks.current[name] = performance.now()
  }, [])

  const push = useCallback((kind, text, extra = {}) => {
    const t = (performance.now() - t0.current) / 1000

    // Accumulate before the ring can drop it. The trace header used to be computed from
    // whatever survived MAX_EVENTS, so a session whose tool rows had scrolled out reported
    // "tool payloads: none" and "answer latency: not measured" three lines above
    // "✓ audit 2 tool calls match the server log" — the same report contradicting itself
    // about the same session, in a file whose whole job is to be believed.
    const totals = sessionTotals.current
    totals.events += 1
    if (kind === 'timing' && extra.ms != null) {
      ;(totals.stages[text] ??= []).push(extra.ms)
      if (text === 'answer') totals.answers.push(extra.ms)
    }
    if (extra.bytes != null) totals.payloads.push({ text, bytes: extra.bytes })

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
      if (!turnHasQuestion(marks.current) && from !== 'responseStart') return
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

      for (const { label, from, to } of firstTokenStages(marks.current, final)) {
        stage(label, from, to)
      }
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
    // The id both halves of the hybrid logged under, so what is stored can be joined back to
    // the tool log rather than becoming a second, unrelated record of the same call.
    onEnded?.(getToolSession())
  }, [push, onEnded])

  // A provider or language switch must not leave a microphone open on the old session.
  useEffect(() => () => void stop(), [provider, lang, stop])

  async function start() {
    if (sessionRef.current) return
    t0.current = performance.now()
    seq.current = 0
    // A stopwatch left running from the last call measured across both of them and
    // reported 25 seconds of synthesis before anyone had spoken.
    marks.current = {}
    reportsSpeech.current = false
    setEvents([])
    resetTotals()
    setToolLine(null)
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
            : {
                threshold: pipeline.threshold,
                silenceMs: pipeline.silenceMs,
                prefixMs: pipeline.prefixMs,
              }),
          vocabulary: pipeline.vocabulary,
        },
        onStatus: (s) => {
          // Both transports announce what this connection can reach, once, at the start.
          // Held here because the header used to claim "same five tools" — there are seven,
          // six of them on the direct line, and a number baked into a sentence goes stale
          // the moment the tool surface moves.
          if (s.startsWith('tools:')) setToolLine(s.slice('tools:'.length).trim())
          // Only a real state moves the state machine. A notice goes to the trace and
          // nowhere else, so a line that arrives after "live" cannot un-connect the call.
          if (IS_STATE(s)) setStatus(s)
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
            reportsSpeech.current = true
            speechWasOpen.current = true
            marks.current = {} // new turn, new stopwatch
          }
        },
        onUserTranscript: (text) => {
          // A transcript arriving after an answer means a new turn — but ONLY on a provider
          // that cannot tell us a turn began. OpenAI reports speech_started and resets
          // there; its transcripts routinely land mid-answer, because the transcriber runs
          // alongside the model rather than in front of it. Resetting on those wiped a live
          // response's marks, and the next delta re-marked firstToken against the
          // just-written transcript: 1 ms of thinking, printed under a real 471 ms one.
          if (!reportsSpeech.current && marks.current.firstToken) marks.current = {}
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
          if (attached.length) claimedTools.current = [...claimedTools.current, ...attached]

          /**
           * Every turn, not only the turns this browser ran something on.
           *
           * This used to be guarded by `if (attached.length)`, which is the right condition
           * for updating the claims and the wrong one for asking about them. A turn where
           * the caller asked "and what is the weather there?" runs NO browser tool, so no
           * reconcile happened, so the placed call stayed unclaimed — and was then attached
           * to the next answer that did run one.
           *
           * In one session that put the JFK weather call under an answer thirty-two seconds
           * later about how many airports are covered. A row in the wrong place is worse
           * than a row missing: it says that call produced this sentence, and it did not.
           *
           * It costs one localhost POST per answer.
           */
          {
            reconcileTools(claimedTools.current).then((audit) => {
              if (!audit) return
              // Nothing has run yet — the greeting, or a turn the caller asked nothing of.
              // Reconciling was still worth doing, because that is how a placed call is
              // discovered; saying "0 tool calls match the server log" is not.
              if (audit.serverCalls === 0) return

              /**
               * Show the calls this browser never made.
               *
               * On the ElevenLabs hybrid the placed tools are fetched by their cloud, so no
               * event reaches this page and the trace listed only what the browser ran — a
               * session answered "31 degrees at Phoenix" with the weather call nowhere in
               * it. The server has them; they arrive with the reconcile and are pushed here
               * once each, marked so nobody mistakes them for something this page did.
               */
              const fresh = (audit.serverEntries ?? []).filter(
                (e) => !serverShown.current.has(e.callId),
              )
              for (const entry of fresh) {
                serverShown.current.add(entry.callId)
                const a = formatArgs(entry.args)
                push('tool', `${entry.tool}${a ? `  ${a}` : ''}   · your server ran it`)
              }
              // And into the answer's own trace, so the call is not listed in the rail and
              // absent from the block under the sentence it produced.
              onAmendTools?.(
                fresh.map((e) => ({
                  tool: e.tool,
                  args: e.args,
                  ms: e.ms,
                  callId: e.callId,
                  digest: e.digest,
                  ranOn: 'server',
                })),
              )

              push(
                'audit',
                audit.ok
                  ? `${audit.serverCalls} tool ${audit.serverCalls === 1 ? 'call' : 'calls'} match the server log` +
                    (audit.serverRun
                      ? ` · ${audit.serverRun} ran on your server, never through the browser`
                      : '') +
                    // A count that is right about what it saw still misleads if the reader
                    // takes it for the whole story. On a transport whose placed tools are
                    // fetched by the provider's own cloud, this browser is not shown them
                    // at all — so the line says what it does not cover.
                    (provider.toolTrace === 'replayed' && audit.serverRun
                      ? ` · ${provider.toolTraceNote}`
                      : '')
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
          const args = formatArgs(record.args)
          /**
           * Say which side ran it, and do not invent a result row for the side that did not.
           *
           * On the hybrid both connections hear every function call; only one answers. The
           * browser sees the weather call go past and never receives its result, so
           * JSON.stringify(undefined).length threw here and the row vanished — leaving a
           * trace where a browser-run tool has two lines and a server-run tool has one, for
           * a reason a reader had to work out. It is stated now.
           */
          const ranOnServer = record.ranOn === 'server'

          /**
           * A server-answered call arrives twice: the call, then its result echoed back.
           *
           * The second one carries the payload and replaces the pending entry rather than
           * adding a second row, so the audit still counts one call and the trace panel can
           * open it and show what the model was actually given.
           */
          if (record.isResult) {
            pendingTools.current = [
              ...pendingTools.current.filter(
                (r) => !(r.tool === record.tool && r.ranOn === 'server' && r.result == null),
              ),
              record,
            ]
            push('result', `${record.tool} answered by your server`, {
              bytes: JSON.stringify(record.result ?? null).length,
            })
            return
          }

          push('tool', `${record.tool}${args ? `  ${args}` : ''}${ranOnServer ? '   · your server ran it' : ''}`)
          if (ranOnServer) return
          // Payload size is usually the reason a spoken answer was slow to start.
          push('result', `${record.tool} returned`, {
            bytes: JSON.stringify(record.result ?? null).length,
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

  const applyMute = useCallback((next) => {
    setMuted(next)
    sessionRef.current?.setMuted(next)
  }, [])

  function toggleMute() {
    applyMute(!muted)
  }

  /**
   * Hold to talk — the microphone is closed except while a key is down.
   *
   * A mute button asks you to remember to press it twice per question, and the turn it is
   * forgotten on is the one a neighbour's conversation opens. Under semantic_vad there is
   * no loudness threshold at all, so anything that sounds like speech becomes a turn: the
   * only reliable way to test in a room with other people in it is for the microphone to be
   * shut by default.
   *
   * Space, because it is the one key nothing else here uses, and repeat events are ignored
   * so holding it does not thrash the track. Released on blur as well as keyup: a window
   * that loses focus mid-hold would otherwise leave the microphone open with nobody
   * watching it.
   */
  useEffect(() => {
    // `status`, not the `connected` derived below it — a hook cannot reach past its own
    // position in the component body, and referencing it here blanked the page.
    if (!pushToTalk || status !== 'live') return undefined

    applyMute(true)
    let held = false

    const down = (e) => {
      if (e.code !== 'Space' || e.repeat || held) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      held = true
      applyMute(false)
    }
    const up = (e) => {
      if (e.code !== 'Space' || !held) return
      held = false
      applyMute(true)
    }
    const release = () => {
      if (!held) return
      held = false
      applyMute(true)
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
      release()
    }
  }, [pushToTalk, status, applyMute])

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
        <label className="live-ptt" title="Microphone stays closed unless you hold Space">
          <input
            type="checkbox"
            checked={pushToTalk}
            onChange={(e) => setPushToTalk(e.target.checked)}
          />
          <span>{pushToTalk ? 'hold Space to talk' : 'push to talk'}</span>
        </label>
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
          `Ask out loud. Same engine and same numbers as the text path${toolLine ? ` · ${toolLine}` : ''}.`
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
      {onlyInto(
        slots?.settings,
        <>
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
                <em className="pipe-when">
                  ⚑ מישהו מדבר לידך? זה המתג. הוא היחיד עם סף עוצמה — העלה אותו עד שקול
                  מהחדר מפסיק לפתוח תור.
                </em>
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
                <div className="pipe-slider">
                  <span className="pipe-sub-label">ריפוד התחלה</span>
                  <input
                    type="range"
                    min="0"
                    max="1000"
                    step="50"
                    value={pipeline.prefixMs}
                    onChange={(e) => setPipeline((p) => ({ ...p, prefixMs: Number(e.target.value) }))}
                  />
                  <b>{pipeline.prefixMs} ms</b>
                  <span className="pipe-note">
                    אודיו שנשמר מלפני שהדיבור זוהה. נמוך מדי חותך את ההברה הראשונה
                  </span>
                </div>
              </div>
            )}

            <label className="pipe-opt pipe-opt-flat">
              <input
                type="checkbox"
                checked={pipeline.interrupt === 'on'}
                onChange={(e) =>
                  setPipeline((p) => ({ ...p, interrupt: e.target.checked ? 'on' : 'off' }))
                }
              />
              <span>
                <b>דיבור קוטע את התשובה</b>
                <em>
                  ברירת המחדל. כל מה שזוהה כדיבור מבטל מיד את התשובה שנאמרת — גם קול של מישהו
                  אחר בחדר. בטרייס מחדר רועש שלוש מתוך ארבע תשובות מתו תוך פחות משש מאות
                  מילישניות, כולל זו שאחרי קריאת הכלי. כבה כאן כדי שהסוכן יסיים משפט.
                </em>
              </span>
            </label>
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

          {/* What the RUNNING call is on, not what the switches show.
              The board is titled "for the next call" and the switches keep whatever was
              last clicked, so a session started before a change — or with nothing clicked
              — looked configured when it was not. Reading the trace was the only way to
              find out, and only after the fact. */}
          {connected && activePipeline && (
            <p
              className={
                JSON.stringify(activePipeline) === JSON.stringify(pipeline)
                  ? 'pipe-running'
                  : 'pipe-stale'
              }
            >
              {JSON.stringify(activePipeline) === JSON.stringify(pipeline)
                ? `השיחה הפעילה רצה על ${describePipeline(activePipeline)}`
                : `השיחה הפעילה רצה על ${describePipeline(activePipeline)} — השינויים שלמעלה יחולו מהשיחה הבאה.`}
            </p>
          )}
        </fieldset>
      )}
        </>,
      )}

      {into(
        slots?.trace,
        <LiveTrace
          events={events}
          verbose={verbose}
          onVerbose={setVerbose}
          onClear={() => {
            setEvents([])
            resetTotals()
          }}
          totals={sessionTotals}
          provider={provider}
          lang={lang}
        />,
      )}
    </div>
  )
}
