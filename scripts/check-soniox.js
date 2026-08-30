/**
 * Does the Soniox key work? Answers without printing it.
 *
 *   node scripts/check-soniox.js
 *
 * Mints a temporary transcription key exactly the way the browser path does, then asks
 * for the model lists, so a failure says which half is wrong rather than "it broke".
 */
import 'dotenv/config'

const key = process.env.SONIOX_API_KEY
if (!key) {
  console.error('\n  SONIOX_API_KEY is empty in .env.\n')
  process.exit(1)
}

const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
let failed = false

const step = async (label, run) => {
  try {
    console.log(`  ${(await run()) ? 'ok  ' : 'ok  '}${label}`)
  } catch (err) {
    failed = true
    console.log(`  FAIL ${label} — ${err.message}`)
  }
}

console.log()

await step('temporary key mints (this is what the browser uses)', async () => {
  const r = await fetch('https://api.soniox.com/v1/auth/temporary-api-key', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60 }),
  })
  const b = await r.json()
  if (!r.ok) throw new Error(`${r.status} ${b?.message ?? JSON.stringify(b).slice(0, 160)}`)
  if (!(b.api_key ?? b.key)) throw new Error(`no key in response: ${Object.keys(b).join(', ')}`)
  return true
})



await step('the configured STT model exists and speaks Hebrew', async () => {
  const want = process.env.SONIOX_STT_MODEL || 'stt-rt-v5'
  const r = await fetch('https://api.soniox.com/v1/models', { headers: auth })
  const { models = [] } = await r.json()
  const model = models.find((m) => m.id === want)
  if (!model) throw new Error(`${want} is not in the list: ${models.map((m) => m.id).join(', ')}`)
  if (!(model.languages ?? []).some((l) => l.code === 'he')) throw new Error(`${want} has no Hebrew`)
  console.log(`       ${want}: ${(model.languages ?? []).length} languages, Hebrew included`)
  return true
})

// Soniox does have TTS — tts-rt-v2, Hebrew, voice "Daniel" — on a different host to the
// rest of the API. Whether it answers is a billing question, not a capability one, so the
// check reports the two separately: can it speak, and is the account funded to.
await step('soniox tts is available to this account', async () => {
  const r = await fetch('https://api.soniox.com/v1/tts-models', { headers: auth })
  const { models = [] } = await r.json()
  const want = process.env.SONIOX_TTS_MODEL || 'tts-rt-v2'
  const model = models.find((m) => m.id === want)
  if (!model) throw new Error(`${want} not offered; have: ${models.map((m) => m.id).join(', ')}`)
  const voices = (model.voices ?? []).map((v) => v.id ?? v.name)
  console.log(`       ${want}: voices ${voices.slice(0, 6).join(', ')}`)
  return true
})

await step('soniox tts actually synthesises (needs a funded account)', async () => {
  const r = await fetch('https://tts-rt.soniox.com/tts', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      model: process.env.SONIOX_TTS_MODEL || 'tts-rt-v2',
      voice: process.env.SONIOX_TTS_VOICE || 'Daniel',
      language: 'he',
      text: 'בוסטון לוגן מוביל בין שדות התעופה של ניו אינגלנד.',
      audio_format: 'mp3',
    }),
  })
  if (r.status === 402) {
    throw new Error(
      'organization balance exhausted — add funds at console.soniox.com, or leave ' +
        'CASCADE_TTS_PROVIDER=openai and the cascade still runs',
    )
  }
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
  console.log(`       returned ${((await r.arrayBuffer()).byteLength / 1024).toFixed(1)} KB of Hebrew audio`)
  return true
})

await step('the configured synthesis stage speaks Hebrew', async () => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.CASCADE_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: process.env.OPENAI_REALTIME_VOICE_HE || 'marin',
      input: 'בוסטון לוגן מוביל בין שדות התעופה של ניו אינגלנד.',
      response_format: 'mp3',
    }),
  })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
  console.log(`       returned ${((await r.arrayBuffer()).byteLength / 1024).toFixed(1)} KB of Hebrew audio`)
  return true
})

console.log()
process.exit(failed ? 1 : 0)
