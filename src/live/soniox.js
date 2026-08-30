/**
 * The cascade we assemble ourselves: Soniox recognises, our agent thinks, Soniox speaks.
 *
 * The managed providers each report one number — how long an answer took. This path is
 * three components we chose, wired together here, so every boundary between them is a
 * timestamp we own. That is the entire reason it exists: it is the only one of the three
 * that can say *which stage* was slow rather than that the whole turn was.
 *
 *   mic ──WebSocket──> Soniox STT ──> POST /api/chat ──> POST /api/voice/speak ──> audio
 *                                      (same agent, same five tools, same numbers)
 *
 * Three vendors, one per stage: Soniox recognises because it switches language
 * mid-sentence unprompted, our agent thinks, OpenAI synthesises because Soniox has no TTS
 * on this account and the ElevenLabs key is scoped to their agent platform. Picking each
 * stage on its merits is the whole point of not buying the pipeline whole.
 */

const STT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'

/** Silence after speech that ends a turn. Soniox streams tokens; the pause is ours to pick. */
const END_OF_TURN_MS = 900

export async function startSoniox({
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

  const keyRes = await fetch('/api/voice/soniox-key')
  const key = await keyRes.json()
  if (!keyRes.ok) throw new Error(key.error ?? 'Could not mint a Soniox key')

  onStatus('opening microphone')
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true })

  onStatus('connecting')
  const ws = new WebSocket(STT_URL)
  const recorder = new MediaRecorder(mic, { mimeType: 'audio/webm;codecs=opus' })

  // Conversation state lives here, exactly as the text UI keeps it: the whole history is
  // posted each turn, so this path and the typed one cannot diverge.
  const history = []
  let heard = ''
  let endTimer = null
  let closed = false
  let thinking = false

  const finishTurn = async () => {
    const question = heard.trim()
    heard = ''
    if (!question || thinking || closed) return

    thinking = true
    onSpeaking(null)
    onUserTranscript(question)
    history.push({ role: 'user', content: question })

    try {
      // Stage two. The same endpoint the text UI posts to — same agent, same tools.
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, lang }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `chat returned ${res.status}`)

      for (const call of data.toolCalls ?? []) onToolCall(call)

      onFirstToken()
      onAssistantTranscript(data.reply, true)
      history.push({ role: 'assistant', content: data.reply })

      // Stage three.
      onSpeaking('assistant')
      const speech = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: data.reply, lang }),
      })
      if (!speech.ok) throw new Error((await speech.json()).error ?? 'TTS failed')

      const url = URL.createObjectURL(await speech.blob())
      if (audioEl) {
        audioEl.src = url
        audioEl.onplaying = () => onFirstAudio()
        audioEl.onended = () => {
          URL.revokeObjectURL(url)
          onSpeaking(null)
        }
        await audioEl.play()
      }
    } catch (err) {
      onError(err)
      onSpeaking(null)
    } finally {
      thinking = false
    }
  }

  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        api_key: key.apiKey,
        model: key.sttModel,
        audio_format: 'auto',
        // Both languages declared rather than one selected: Soniox switches mid-sentence
        // on its own, which is the reason to reach for it over a transcriber that has to
        // be told in advance what it is about to hear.
        language_hints: ['he', 'en'],
        enable_endpoint_detection: true,
      }),
    )
    recorder.start(120)
    onStatus('live')
  })

  recorder.addEventListener('dataavailable', async (event) => {
    if (ws.readyState === WebSocket.OPEN && event.data.size > 0) {
      ws.send(await event.data.arrayBuffer())
    }
  })

  ws.addEventListener('message', (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }

    if (msg.error_code || msg.error) {
      onError(new Error(msg.error_message ?? msg.error ?? 'Soniox error'))
      return
    }

    const finalText = (msg.tokens ?? [])
      .filter((t) => t.is_final)
      .map((t) => t.text)
      .join('')

    if (finalText) {
      if (!heard) onSpeaking('user')
      heard += finalText
      onRawEvent('transcript.final')

      clearTimeout(endTimer)
      endTimer = setTimeout(finishTurn, END_OF_TURN_MS)
    }

    // Soniox can mark the end of an utterance itself; trust it over our timer when it does.
    if (msg.finished || (msg.tokens ?? []).some((t) => t.text === '<end>')) {
      clearTimeout(endTimer)
      finishTurn()
    }
  })

  ws.addEventListener('error', () => onError(new Error('Soniox socket error')))

  return {
    sendText(text) {
      heard = text
      finishTurn()
    },
    setMuted(muted) {
      mic.getTracks().forEach((t) => {
        t.enabled = !muted
      })
    },
    stop() {
      closed = true
      clearTimeout(endTimer)
      if (recorder.state !== 'inactive') recorder.stop()
      mic.getTracks().forEach((t) => t.stop())
      if (ws.readyState === WebSocket.OPEN) ws.close()
      if (audioEl) audioEl.src = ''
      onStatus('idle')
    },
  }
}
