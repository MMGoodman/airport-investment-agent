/**
 * The browser half of the server-relay transport.
 *
 * Deliberately dumb: capture the microphone, play what comes back, print the events.
 * The session, the tools and the batching all live in server/relay.js — this file is what
 * the browser is reduced to when the architecture question "why not run it all against
 * the server, like the text path?" is answered by actually doing it.
 *
 * Audio is PCM16 mono 24 kHz both ways, as raw binary WebSocket frames. The AudioContext
 * is opened at 24 kHz so the browser resamples the microphone for us and plays the
 * agent's frames without conversion. What is genuinely lost against WebRTC: acoustic echo
 * cancellation beyond getUserMedia's own, jitter buffering, and loss concealment — that
 * loss is part of what the comparison measures.
 */
import { getToolSession } from './tools.js'

export async function startOpenAIRelay({
  lang = 'en',
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
  onError = () => {},
}) {
  onStatus('connecting')

  const params = new URLSearchParams({ lang })
  for (const [k, v] of Object.entries(pipeline)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const session = getToolSession()
  if (session) params.set('session', session)

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/api/relay?${params}`)
  ws.binaryType = 'arraybuffer'

  /**
   * Subscribe to the open BEFORE anything is awaited.
   *
   * This used to be built at the bottom of the function, after getUserMedia — which takes
   * long enough that a localhost socket is already open by then. The `open` event had come
   * and gone with no listener, so the promise never settled and this function never
   * returned. The session still worked, because ws.onmessage was live: audio flowed, tools
   * ran, answers came back. What never happened was the caller receiving the session
   * handle, so hanging up had nothing to close and said so — "no live session was held".
   *
   * A promise created here cannot miss the event, whatever is awaited later.
   */
  /**
   * Hold everything that arrives before the handler below is wired.
   *
   * The server reports the session's settings — which turn detection, whether the
   * vocabulary bias is on — the moment the socket connects, and the handler is only
   * attached after getUserMedia, which takes hundreds of milliseconds. Those two lines
   * were being delivered to nobody, so the trace never said what the call was running
   * under and there was no way to tell a changed setting from an ignored one. Same shape
   * as the open event below: subscribe first, act later.
   */
  const early = []
  const queueEarly = (event) => early.push(event)
  ws.addEventListener('message', queueEarly)

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener(
      'error',
      () => reject(new Error('Could not reach the relay — is the API server up?')),
      { once: true },
    )
  })

  const ctx = new AudioContext({ sampleRate: 24000 })

  // ---- playback: schedule each frame right after the previous one
  let playCursor = 0
  let playing = []
  const stopPlayback = () => {
    for (const s of playing) {
      try {
        s.stop()
      } catch {
        /* finished */
      }
    }
    playing = []
    playCursor = 0
  }
  const playChunk = (arrayBuffer) => {
    const ints = new Int16Array(arrayBuffer)
    if (ints.length === 0) return
    const floats = new Float32Array(ints.length)
    for (let i = 0; i < ints.length; i++) floats[i] = ints[i] / 32768
    const buffer = ctx.createBuffer(1, floats.length, 24000)
    buffer.getChannelData(0).set(floats)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const at = Math.max(ctx.currentTime + 0.05, playCursor)
    source.start(at)
    playCursor = at + buffer.duration
    playing.push(source)
    if (playing.length > 64) playing = playing.slice(-64)
  }

  // ---- capture
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
  const micSource = ctx.createMediaStreamSource(mic)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  // A ScriptProcessor only runs while wired to the destination; the zero gain keeps the
  // microphone from playing back through the speakers on top of the agent.
  const sink = ctx.createGain()
  sink.gain.value = 0
  let muted = false

  processor.onaudioprocess = (event) => {
    if (closed || muted || ws.readyState !== WebSocket.OPEN) return
    const floats = event.inputBuffer.getChannelData(0)
    const ints = new Int16Array(floats.length)
    for (let i = 0; i < floats.length; i++) {
      const s = Math.max(-1, Math.min(1, floats[i]))
      ints[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    ws.send(ints.buffer)
  }
  micSource.connect(processor)
  processor.connect(sink)
  sink.connect(ctx.destination)

  // Reset per answer, same convention as the WebRTC transport.
  let audioReported = false

  /**
   * Drop incoming audio until the next response starts.
   *
   * stopPlayback() silences what is already queued, and that used to be the whole
   * barge-in: a one-shot stop, after which every frame still in flight was scheduled and
   * played anyway. Cancelling upstream stops new frames at the source, but the ones
   * already on the wire keep arriving, so the local gate has to hold until a new response
   * begins rather than firing once.
   */
  let suppressAudio = false

  /**
   * Set the instant stop() is called, and checked before anything is acted on.
   *
   * A socket close is a handshake, not a switch: frames already in flight still arrive,
   * and if any step of the teardown throws before ws.close() the socket never closes at
   * all. One session kept transcribing, calling tools and answering for 47 seconds after
   * it had reported itself closed. The flag makes the hangup take effect immediately even
   * when the socket lags or the teardown fails.
   */
  let closed = false

  const onMessage = (event) => {
    if (closed) return
    if (event.data instanceof ArrayBuffer) {
      if (suppressAudio) return
      if (!audioReported) {
        audioReported = true
        onFirstAudio()
      }
      playChunk(event.data)
      return
    }

    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }

    switch (msg.type) {
      case 'status':
        onStatus(msg.text)
        break
      case 'ready':
        onStatus('live')
        break
      case 'responseStart':
        // A new answer is starting, so the gate opens again.
        suppressAudio = false
        onResponseStart()
        break
      case 'speaking':
        if (msg.who === 'user') {
          // Barge-in. The server cancels the response upstream; this silences what is
          // already queued and gates whatever is still on the wire until the next one.
          audioReported = false
          suppressAudio = true
          stopPlayback()
        }
        onSpeaking(msg.who)
        break
      case 'userTranscript':
        onUserTranscript(msg.text)
        break
      case 'assistantDelta':
        onFirstToken()
        onAssistantTranscript(msg.text, false)
        break
      case 'assistantFinal':
        onAssistantTranscript(msg.text, true)
        audioReported = false
        break
      case 'tool':
        onToolCall(msg.record)
        break
      case 'event':
        onRawEvent(msg.event, msg)
        break
      case 'error':
        onError(new Error(msg.message))
        break
      default:
        break
    }
  }

  // Take over, then replay what arrived while the microphone was opening.
  ws.removeEventListener('message', queueEarly)
  ws.addEventListener('message', onMessage)
  early.splice(0).forEach(onMessage)

  ws.onclose = () => onStatus('idle')

  await opened

  return {
    /** Type instead of talk — the server injects it as a user message. */
    sendText(text) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'text', text }))
    },
    setMuted(m) {
      muted = m
    },
    /**
     * Tear down, socket first and every step isolated.
     *
     * Order matters: closing the socket is what actually ends the session, so it goes
     * before anything that could throw. AudioContext.close() throws synchronously when the
     * context is already closed, and it used to sit ahead of ws.close() — one throw there
     * and the session stayed live while the panel reported it shut.
     */
    stop() {
      closed = true
      muted = true

      const steps = [
        ['socket', () => ws.close()],
        ['capture', () => {
          processor.disconnect()
          micSource.disconnect()
          sink.disconnect()
        }],
        ['microphone', () => mic.getTracks().forEach((t) => t.stop())],
        ['playback', () => stopPlayback()],
        ['audio context', () => ctx.close()],
      ]

      for (const [what, run] of steps) {
        try {
          const result = run()
          if (result?.catch) result.catch(() => {})
        } catch (err) {
          // Reported rather than swallowed: a teardown that half-failed is exactly what a
          // session lingering after its own goodbye looks like from the outside.
          onError(new Error(`hang-up: ${what} did not close — ${err.message}`))
        }
      }

      onStatus('idle')
    },
  }
}
