/**
 * ElevenLabs Agents — the managed alternative.
 *
 * The platform owns the audio pipeline and the turn-taking; we own the tools. Every
 * tool is registered as a CLIENT tool, so it executes in this browser and calls
 * POST /api/tool — the same deterministic engine the other two paths use. Server tools
 * would have ElevenLabs' cloud call us instead, which needs a public URL; client tools
 * keep the whole thing working on localhost with no tunnel.
 *
 * The agent's prompt and tool declarations are pushed from this repo by
 * `npm run sync:agent`, so nothing about its behaviour lives only in a dashboard.
 */
import { callTool, parseArgs } from './tools.js'

/** Five handlers, generated from the tool names the agent was synced with. */
const TOOL_NAMES = [
  'list_supported_regions',
  'rank_airports',
  'compare_airports',
  'get_airport_profile',
  'get_flight_mix',
]

export async function startElevenLabs({
  lang = 'en',
  onStatus = () => {},
  onRawEvent = () => {},
  onUserTranscript = () => {},
  onAssistantTranscript = () => {},
  onToolCall = () => {},
  onSpeaking = () => {},
  onError = () => {},
}) {
  onStatus('minting key')

  const res = await fetch(`/api/voice/signed-url?lang=${lang}`)
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'Could not mint a signed URL')

  onStatus('opening microphone')
  await navigator.mediaDevices.getUserMedia({ audio: true })

  const clientTools = Object.fromEntries(
    TOOL_NAMES.map((name) => [
      name,
      async (params) => {
        const record = await callTool(name, parseArgs(params))
        onToolCall(record)
        // The platform expects a string back; it goes into the model's context verbatim.
        return JSON.stringify(record.result)
      },
    ]),
  )

  // Loaded on demand: the SDK is most of a megabyte and the text path never needs it.
  const { Conversation } = await import('@elevenlabs/client')

  onStatus('connecting')
  const conversation = await Conversation.startSession({
    signedUrl: body.signedUrl,
    connectionType: 'websocket',
    clientTools,
    // The prompt comes back from our own server, so the live agent runs this repo's text
    // even if someone edits the copy in the ElevenLabs dashboard. Language switches the
    // platform's transcriber and voice, which a prompt instruction alone cannot do.
    overrides: {
      agent: { language: body.lang, prompt: { prompt: body.prompt } },
      // English swaps in the fast voice model; Hebrew has no fast model to swap to.
      ...(body.ttsModelId ? { tts: { modelId: body.ttsModelId } } : {}),
    },
    onDebug: (event) => onRawEvent(event?.type ?? 'debug', event),
    onConnect: () => onStatus('live'),
    onDisconnect: () => onStatus('idle'),
    onError: (err) => onError(err instanceof Error ? err : new Error(String(err))),
    onModeChange: ({ mode }) => onSpeaking(mode === 'speaking' ? 'assistant' : null),
    onMessage: ({ message, source }) => {
      if (!message?.trim()) return
      if (source === 'user') onUserTranscript(message.trim())
      else onAssistantTranscript(message.trim(), true)
    },
  })

  return {
    sendText(text) {
      conversation.sendUserMessage?.(text)
    },
    setMuted(muted) {
      conversation.setMicMuted?.(muted)
    },
    async stop() {
      await conversation.endSession()
      onStatus('idle')
    },
  }
}
