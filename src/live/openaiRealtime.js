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

  return async function handle(msg) {
    // Everything the session emits, before we decide what to do with it. This is the
    // raw feed the trace panel shows in verbose mode.
    onRawEvent(msg.type, msg)

    switch (msg.type) {
      case 'response.created':
        bargedIn = false
        break

      case 'input_audio_buffer.speech_started':
        audioReported = false
        bargedIn = true
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

      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript?.trim()) onUserTranscript(msg.transcript.trim())
        break

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
  onStatus = () => {},
  onRawEvent = () => {},
  onUserTranscript = () => {},
  onAssistantTranscript = () => {},
  onToolCall = () => {},
  onSpeaking = () => {},
  onFirstToken = () => {},
  onFirstAudio = () => {},
  onError = () => {},
}) {
  onStatus('minting key')

  const keyRes = await fetch(`/api/realtime/session?lang=${lang}`)
  const keyBody = await keyRes.json()
  if (!keyRes.ok) throw new Error(keyBody.error ?? 'Could not mint a realtime key')
  const { clientSecret, model, vad } = keyBody
  // Record what turn detection this call ran under, so a pasted trace can be compared
  // against another that was configured differently.
  if (vad) onStatus(`turn detection: ${vad}`)

  onStatus('opening microphone')
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true })

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
    stop() {
      mic.getTracks().forEach((t) => t.stop())
      try {
        dc.close()
      } catch {
        /* already closed */
      }
      pc.close()
      if (audioEl) audioEl.srcObject = null
      onStatus('idle')
    },
  }
}
