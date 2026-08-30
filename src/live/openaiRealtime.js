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

  // Reset each turn so every answer reports its own first-audio moment.
  let audioReported = false

  dc.addEventListener('message', async (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }

    // Everything the session emits, before we decide what to do with it. This is the
    // raw feed the trace panel shows in verbose mode.
    onRawEvent(msg.type, msg)

    switch (msg.type) {
      case 'input_audio_buffer.speech_started':
        audioReported = false
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

      // The model asked for a tool. Run it, report it, hand back the structured result.
      case 'response.function_call_arguments.done': {
        const record = await callTool(msg.name, parseArgs(msg.arguments))
        onToolCall(record)
        send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: msg.call_id,
            output: JSON.stringify(record.result),
          },
        })
        // Nudge the model to speak now that it has the numbers.
        send({ type: 'response.create' })
        break
      }

      case 'error':
        onError(new Error(msg.error?.message ?? 'Realtime error'))
        break
      default:
        break
    }
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
