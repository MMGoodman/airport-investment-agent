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

await step('STT models reachable', async () => {
  const r = await fetch('https://api.soniox.com/v1/models', { headers: auth })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`)
  const b = await r.json()
  const names = (b.models ?? b.data ?? []).map((m) => m.id ?? m.name).filter(Boolean)
  console.log(`       ${names.slice(0, 8).join(', ') || 'none listed'}`)
  return true
})

await step('TTS reachable, and it speaks Hebrew', async () => {
  const r = await fetch('https://api.soniox.com/v1/tts', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      model: process.env.SONIOX_TTS_MODEL || 'tts-1',
      text: 'בוסטון לוגן מוביל בין שדות ניו אינגלנד.',
      language: 'he',
      audio_format: 'mp3',
    }),
  })
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
  const bytes = (await r.arrayBuffer()).byteLength
  console.log(`       returned ${(bytes / 1024).toFixed(1)} KB of audio`)
  return true
})

console.log()
process.exit(failed ? 1 : 0)
