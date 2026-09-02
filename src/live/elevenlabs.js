/**
 * ElevenLabs Agents — the managed alternative.
 *
 * The platform owns the audio pipeline and the turn-taking; we own the tools. The tools
 * this page registers are CLIENT tools, so they execute in this browser and call
 * POST /api/tool — the same deterministic engine the other paths use — which keeps the
 * project working on localhost with no tunnel.
 *
 * The placed tools are not among them, and when the webhook hybrid is configured they are
 * not missing either: ElevenLabs' own backend calls this server for those, server to
 * server, and nothing about that reaches this file. So the handler map below is exactly
 * the client half, in both configurations. See server/webhookTools.js for the other half.
 *
 * The agent's prompt and tool declarations are pushed from this repo by
 * `npm run sync:agent`, so nothing about its behaviour lives only in a dashboard.
 */
import { callTool, parseArgs } from './tools.js'

/**
 * One handler per tool the agent was synced with.
 *
 * Hand-kept, and it has to stay in step with toolSchemas in src/agent/tools.js: sync:agent
 * declares the tools from there, so a name added there and forgotten here is registered
 * with the platform, requested by the agent, and then unhandled in this browser — a failure
 * that only shows up mid-call. Importing the schemas directly would close the gap, but
 * tools.js reaches data/store.js and node:fs through it, which cannot be bundled.
 */
const TOOL_NAMES = [
  'list_supported_regions',
  'rank_airports',
  'compare_airports',
  'get_airport_profile',
  'get_flight_mix',
  'get_airport_weather',
  'end_call',
]

export async function startElevenLabs({
  lang = 'en',
  onStatus = () => {},
  onRawEvent = () => {},
  onUserTranscript = () => {},
  onAssistantTranscript = () => {},
  onToolCall = () => {},
  onSpeaking = () => {},
  onFirstAudio = () => {},
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
    onModeChange: ({ mode }) => {
      onSpeaking(mode === 'speaking' ? 'assistant' : null)
      // The platform switching to "speaking" is the only synthesis boundary it exposes.
      if (mode === 'speaking') onFirstAudio()
    },
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
