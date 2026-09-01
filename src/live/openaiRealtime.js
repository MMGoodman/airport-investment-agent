/**
 * OpenAI Realtime over WebRTC — true speech-to-speech, with barge-in.
 *
 * Audio goes browser <-> OpenAI directly as a peer connection; our server is only
 * involved once, to mint an ephemeral key. Function calls arrive on the data channel,
 * we run them against POST /api/tool, and hand the structured result straight back.
 *
 * The model narrates. It never computes — it has no tool that would let it.
 */
import { callTool, parseArgs } from './tools.js'

const SDP_ENDPOINT = 'https://api.openai.com/v1/realtime/calls'

/** Distinct hint terms in one transcript above which it is the hint, not a caller. */
const PHANTOM_TERMS = 10

/**
 * The data-channel state machine, lifted out of the connection so it can be tested.
 *
 * Everything subtle about this transport lives in here — batching parallel tool calls,
 * deciding when to ask the model to speak, and dropping that request after a barge-in —
 * and none of it was reachable by a test while it sat inside a WebRTC closure.
 *
 * `run` is the tool runner, injected so a test can control how long each call takes. That
 * is the whole point: the bug this shape exists to prevent only appears when one tool
 * returns before another.
 */
export function createEventHandler({
  send,
  run = callTool,
  onRawEvent = () => {},
  onUserTranscript = () => {},
  onAssistantTranscript = () => {},
  onToolCall = () => {},
  onSpeaking = () => {},
  onFirstToken = () => {},
  onFirstAudio = () => {},
  onResponseStart = () => {},
  onPhantom = () => {},
  /** The vocabulary hint's own terms, for spotting it read back. */
  hintTerms = [],
  // Whether turn detection was configured to cancel a response when speech is detected.
  // With it off, speech is not a barge-in: the model keeps talking, so nothing about this
  // turn is stale and the request to speak after a tool must still go out.
  interrupts = true,
  onError = () => {},
}) {
  // Reset each turn so every answer reports its own first-audio moment.
  let audioReported = false

  /**
   * Tool calls belonging to the response currently being generated.
   *
   * One response can ask for several — "the weather at Boston and Portland" asks for two —
   * and they arrive as separate events. Answering each one the moment it returned meant the
   * fastest tool started the reply: the model was told to speak while the second lookup was
   * still in flight, so it answered on half the data, and the second `response.create` then
   * hit a response that was already active.
   *
   * They are collected here and settled together when the response that asked for them ends.
   */
  let pendingCalls = []

  /**
   * Whether the caller started talking again while this response was being handled.
   *
   * A barge-in makes the answer we were about to ask for stale before it exists. The tool
   * outputs still go in — a function_call left without its output leaves the conversation
   * item list malformed for every later turn — but the request to speak is dropped, because
   * turn detection is about to open a new turn anyway.
   */
  let bargedIn = false

  /**
   * Is this transcript the vocabulary hint being read back?
   *
   * The hint is a prior, and on a stretch of near-silence a transcriber given a prior and
   * nothing to describe can emit the prior itself — one session recorded every airport code
   * and Hebrew term in list order as something the caller had said. Nobody says ten domain
   * terms in one breath, so the count separates the two cleanly.
   */
  const isHintEcho = (text) => {
    if (hintTerms.length === 0 || !text || text.length < 60) return false
    const lower = text.toLowerCase()
    let hits = 0
    for (const term of hintTerms) {
      if (lower.includes(term.toLowerCase()) && ++hits >= PHANTOM_TERMS) return true
    }
    return false
  }

  return async function handle(msg) {
    // Everything the session emits, before we decide what to do with it. This is the
    // raw feed the trace panel shows in verbose mode.
    onRawEvent(msg.type, msg)

    switch (msg.type) {
      case 'response.created':
        bargedIn = false
        // When generation actually began. On a native speech-to-speech model this lands
        // BEFORE the transcription event, because the model reads the audio and the
        // transcriber is a separate listener running alongside it — which is exactly why
        // a "thinking time" measured from the transcript is meaningless here.
        onResponseStart()
        break

      case 'input_audio_buffer.speech_started':
        audioReported = false
        if (interrupts) bargedIn = true
        onSpeaking('user')
        break

      // One model produces text and audio together, so first token and first audio land
      // within a few milliseconds of each other. That is not measurement noise — it is
      // exactly the difference between a native model and a cascade, made visible.
      case 'response.output_audio.delta':
        if (!audioReported) {
          audioReported = true
          onFirstAudio()
        }
        break
      case 'input_audio_buffer.speech_stopped':
        onSpeaking(null)
        break

      case 'conversation.item.input_audio_transcription.completed': {
        const heard = msg.transcript?.trim()
        if (!heard) break
        if (isHintEcho(heard)) {
          // Reported, not silently swallowed: a dropped transcript the reader cannot see
          // would make the session look like it missed a question.
          onPhantom(heard)
          break
        }
        onUserTranscript(heard)
        break
      }

      case 'response.output_audio_transcript.delta':
        onFirstToken()
        onAssistantTranscript(msg.delta ?? '', false)
        break
      case 'response.output_audio_transcript.done':
        onAssistantTranscript(msg.transcript ?? '', true)
        break

      // The model asked for a tool. Start it now; a function call ends the response, so
      // there is nothing left to wait for except the tool itself.
      case 'response.function_call_arguments.done':
        pendingCalls.push(
          run(msg.name, parseArgs(msg.arguments)).then((record) => {
            onToolCall(record)
            return { callId: msg.call_id, record }
          }),
        )
        break

      /**
       * The response is over — which for a tool call is the point the model stopped, not a
       * pause. Hand back every result it asked for, then ask for one new response built on
       * the item list they were just added to.
       */
      case 'response.done': {
        if (pendingCalls.length === 0) break
        const batch = pendingCalls
        pendingCalls = []

        // Awaited together so a slow lookup cannot let a fast one answer on its own, and
        // written in call order so the outputs sit in the list the way they were asked for.
        for (const { callId, record } of await Promise.all(batch)) {
          send({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(record.result),
            },
          })
        }

        // One request to speak, for the whole batch.
        if (!bargedIn) send({ type: 'response.create' })
        break
      }

      case 'error':
        onError(new Error(msg.error?.message ?? 'Realtime error'))
        break
      default:
        break
    }
  }
}

export async function startOpenAIRealtime({
  audioEl,
  lang = 'en',
  /** Per-session pipeline settings from the control panel; the server clamps them. */
  pipeline = {},
  onStatus = () => {},
  onRawEvent = () => {},
  onUserTranscript = () => {},
  onAssistantTranscript = () => {},
  onToolCall = () => {},
  onSpeaking = () => {},
  onFirstToken = () => {},
  onFirstAudio = () => {},
  onResponseStart = () => {},
  onPhantom = () => {},
  onError = () => {},
}) {
  onStatus('minting key')

  const params = new URLSearchParams({ lang })
  for (const [k, v] of Object.entries(pipeline)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }

  const keyRes = await fetch(`/api/realtime/session?${params}`)
  const keyBody = await keyRes.json()
  if (!keyRes.ok) throw new Error(keyBody.error ?? 'Could not mint a realtime key')
  const { clientSecret, model, vad, vocabulary, hintTerms = [], interrupts = true } = keyBody
  // Record what this call ran under, so a pasted trace can be compared against another
  // that was configured differently. The server reports what it USED, after clamping —
  // not what was asked for.
  if (vad) onStatus(`turn detection: ${vad}`)
  onStatus(`vocabulary bias: ${vocabulary ? 'on' : 'off'}`)

  onStatus('opening microphone')
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Asked for explicitly rather than left to the browser's defaults. These are the only
      // filtering this build gets: turn detection judges whatever arrives, so a voice the
      // capture stage lets through becomes a turn. They help with steady room noise; they
      // do not remove a nearby conversation, which is speech and survives every one of them.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const pc = new RTCPeerConnection()
  pc.ontrack = (event) => {
    if (audioEl) audioEl.srcObject = event.streams[0]
  }
  pc.addTrack(mic.getTracks()[0], mic)

  const dc = pc.createDataChannel('oai-events')
  const send = (payload) => {
    if (dc.readyState === 'open') dc.send(JSON.stringify(payload))
  }

  dc.addEventListener('open', () => onStatus('live'))

  const handle = createEventHandler({
    send,
    onRawEvent,
    onUserTranscript,
    onAssistantTranscript,
    onToolCall,
    onSpeaking,
    onFirstToken,
    onFirstAudio,
    onResponseStart,
    onPhantom,
    hintTerms,
    interrupts,
    onError,
  })

  dc.addEventListener('message', (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }
    handle(msg)
  })

  onStatus('connecting')
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  const sdpRes = await fetch(`${SDP_ENDPOINT}?model=${encodeURIComponent(model)}`, {
    method: 'POST',
    body: offer.sdp,
    headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
  })
  if (!sdpRes.ok) {
    mic.getTracks().forEach((t) => t.stop())
    pc.close()
    throw new Error(`SDP exchange failed (${sdpRes.status}): ${(await sdpRes.text()).slice(0, 200)}`)
  }

  await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })

  return {
    /** Type instead of talk — same session, same tools. */
    sendText(text) {
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      })
      send({ type: 'response.create' })
    },
    setMuted(muted) {
      mic.getTracks().forEach((t) => {
        t.enabled = !muted
      })
    },
    /**
     * Tear down, peer connection first and every step isolated.
     *
     * The relayed transport had this shape and one throwing step left the session live
     * while the panel reported it closed. Closing the peer connection is what ends the
     * session, so nothing that can throw is allowed to run ahead of it.
     */
    stop() {
      const steps = [
        ['peer connection', () => pc.close()],
        ['data channel', () => dc.close()],
        ['microphone', () => mic.getTracks().forEach((t) => t.stop())],
        ['audio element', () => {
          if (audioEl) audioEl.srcObject = null
        }],
      ]
      for (const [what, run] of steps) {
        try {
          run()
        } catch (err) {
          onError(new Error(`hang-up: ${what} did not close — ${err.message}`))
        }
      }
      onStatus('idle')
    },
  }
}
