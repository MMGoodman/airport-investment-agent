/**
 * Driving the voice agent BY VOICE, because the text adapters cannot see how it fails.
 *
 * WHY THIS EXISTS — TWO MEASURED BLIND SPOTS
 *
 * Every other adapter types. `{type:"user_message", text}` on ElevenLabs;
 * `content:[{type:"input_text"}]` with `output_modalities:['text']` on OpenAI. That measures
 * tool selection and phrasing honestly and cheaply, and it is structurally unable to see
 * anything that depends on how the words arrived or how the answer is produced.
 *
 * Both failures found in live calls this week are exactly that:
 *
 *   1. Asked for a ranking, the agent said "אני בודק את הדירוג… תן לי להביא" and the turn
 *      ended — one audio item, no function_call. Driven by text: 5/5 clean.
 *   2. A caller began "תקשיב, …", the turn detector committed after one word, and the agent
 *      called end_call recording a request nobody had made. Driven by text: 13/13 clean.
 *
 * Thirteen runs of a bug that happens in conversation is not a flaky measurement, it is the
 * wrong instrument. This is the right one.
 *
 * WHAT CHANGES, CONCRETELY
 *
 * - **The words arrive as sound.** "תקשיב." typed is a complete word with a full stop.
 *   Spoken it is an utterance with an ending, and the model is reacting to the ending.
 * - **The turn boundary becomes a decision.** The text adapters HAND the model a turn. Here
 *   the same `turn_detection` config the browser uses decides when the caller stopped — so
 *   the VAD, which is a component of the product, is finally under test.
 * - **The answer is spoken.** `output_modalities:['audio']`, so a turn CAN be spent on a
 *   spoken preamble. Under `['text']` that failure mode does not exist to be found.
 * - **The transcriber runs.** What it heard comes back as `heard`, which no text adapter can
 *   report, and which is this project's largest unfixed measured problem.
 *
 * WHAT IT DOES NOT FIX, SAID PLAINLY
 *
 * Synthesised speech is clean and confident. A TTS "תקשיב" does not hesitate, and hesitation
 * is probably what made the live one read as an ending. So this closes the gap on the input
 * PATH without closing it on input CHARACTER — it will catch some audio-only failures and
 * not all, and a case that passes here has not been proven safe with a real caller. Replaying
 * recorded audio is the only thing that would, and this deployment stores transcripts rather
 * than recordings, deliberately.
 *
 * WHAT IT COSTS
 *
 * Synthesis per turn, audio output tokens per answer, and wall-clock: the audio is fed at
 * roughly the speed a person speaks, on purpose — feeding a five-second sentence in
 * fifty milliseconds would hand the VAD a decision no microphone ever gives it.
 */
import WebSocket from 'ws'
import { runTool, toolSchemas, toolSchemasFor } from '../src/agent/tools.js'
import { SYSTEM_PROMPT, VOICE_ADDENDUM, languageInstruction } from '../src/agent/prompt.js'
import { eagerSkills } from '../src/agent/skills.js'

/** The realtime input format, and what OpenAI's TTS emits for `pcm`. They match exactly. */
const SAMPLE_RATE = 24_000
const BYTES_PER_SAMPLE = 2

/** 100 ms of audio. Small enough to pace, large enough not to be all framing overhead. */
const CHUNK_BYTES = (SAMPLE_RATE * BYTES_PER_SAMPLE) / 10

/**
 * Trailing silence — and 900 ms was not enough, measured.
 *
 * A microphone never stops dead; it trails into room tone. Cutting the stream at the last
 * syllable asks the VAD to infer an ending from an absence of packets rather than from the
 * sound of someone having finished, which is not the question it answers live.
 *
 * HOW MUCH, AND THE FINDING THAT CAME OUT OF ASKING
 *
 * The first version used 900 ms and two runs in five hung for the full ninety seconds. That
 * looked like adapter flakiness. It was not — a trace of the raw events showed
 * `input_audio_buffer.speech_started` and then nothing at all, for twenty-five seconds, on a
 * one-word utterance. Isolated:
 *
 *     eagerness low  · 1s silence   speech_stopped: NEVER
 *     eagerness low  · 4s silence   speech_stopped: 4.6s
 *     eagerness high · 1s silence   speech_stopped: 2.6s
 *
 * `semantic_vad` on `low` judges whether the THOUGHT finished, and a fragment is a thought
 * that did not. It waits, and with only a second of silence to go on it waits forever.
 *
 * That is not just a harness parameter. It is the mechanism behind a live report — "after a
 * long call I suddenly could not talk to the agent" — whose trace shows `speech_started` and
 * then seventy-nine seconds of nothing before the session went idle. Anything that stops the
 * audio mid-turn, a fragment or a gate closing the microphone, leaves this detector waiting
 * for an ending that no longer has any way to arrive.
 */
const TAIL_SILENCE_MS = 3000

/** Long enough for a tool round trip inside a spoken answer. */
const TURN_TIMEOUT_MS = 90_000

/**
 * The caller's voice — deliberately not the agent's.
 *
 * Same voice on both sides makes a trace unreadable at a glance, and any echo-related
 * confusion would look like a model failure.
 */
const CALLER_VOICE = 'alloy'

/**
 * Text to 24 kHz mono PCM, with no decoding step.
 *
 * `response_format: 'pcm'` returns raw signed 16-bit little-endian samples at 24 kHz — the
 * realtime input format, byte for byte. The obvious alternative, this repo's own
 * `/api/voice/speak`, returns MP3 and would need a decoder to get back to the same samples.
 */
async function speak(text, key) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voice: CALLER_VOICE,
      input: text,
      response_format: 'pcm',
    }),
  })
  if (!res.ok) throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return Buffer.from(await res.arrayBuffer())
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param opts.instructions  the prompt a live session would be minted with
 * @param opts.transport     'browser' for the six tools, 'relay' for all eight
 * @param opts.vad           turn detection; defaults to the deployment's own setting
 * @param opts.realtime      false to feed audio as fast as the socket takes it (cheap, and
 *                           no longer a faithful test of the turn detector)
 */
export async function openaiAudio(turns, lang = 'he', opts = {}) {
  const started = Date.now()
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set')

  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  const send = (o) => ws.send(JSON.stringify(o))

  const toolCalls = []
  let lastTurnToolCalls = []
  let reply = ''
  /** What the transcriber made of the caller. Only this adapter can report it. */
  const heard = []

  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })

  /**
   * A listener that outlives the turns, because the first version lost the only error worth
   * seeing.
   *
   * `session.update` is sent the moment the socket opens; the per-turn handler is attached
   * later, when a turn begins. Anything the server said about that update — a rejected audio
   * format, an unknown field, a malformed tool — arrived in the gap and was dropped. The run
   * then looked fine and was not: no tools configured, so the model answered a ranking
   * question from memory with no tool call, and the adapter reported the empty tool list as
   * if the model had chosen it.
   *
   * A harness that cannot report its own misconfiguration will blame the thing it is
   * measuring. This collects those, and the caller is handed them.
   */
  const sessionErrors = []
  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'error') sessionErrors.push(msg.error?.message ?? JSON.stringify(msg.error))
    if (msg.type === 'session.updated') sessionErrors.push(null) // marker: the update landed
  })

  /**
   * The same turn detection the browser is given, not a convenient one.
   *
   * `semantic_vad` with the deployment's eagerness, because the boundary it draws IS part of
   * what failed: "תקשיב" only became a turn because something decided the caller had
   * finished after one word. An adapter that pinned this to a comfortable value would be
   * testing a product nobody ships.
   */
  const turnDetection = opts.vad ?? {
    type: 'semantic_vad',
    eagerness: process.env.OPENAI_VAD_EAGERNESS || 'low',
  }

  send({
    type: 'session.update',
    session: {
      type: 'realtime',
      // Audio out as well as in. Half the point: a turn can only be SPENT on a spoken
      // preamble if speech is what the model is producing.
      output_modalities: ['audio'],
      instructions:
        opts.instructions ??
        SYSTEM_PROMPT +
          VOICE_ADDENDUM +
          languageInstruction(lang, true) +
          eagerSkills()
            .map((skill) => `\n\n${skill.instructions}`)
            .join(''),
      tools: (opts.transport ? toolSchemasFor(opts.transport).tools : toolSchemas).map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters:
          t.parameters && Object.keys(t.parameters.properties ?? {}).length > 0
            ? t.parameters
            : { type: 'object', properties: {} },
      })),
      tool_choice: 'auto',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          // Pinned, for the same reason the live session pins it: without a language the
          // transcriber has produced Greek and Thai from Hebrew speech.
          transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1', language: lang },
          turn_detection: turnDetection,
        },
        output: { voice: process.env.OPENAI_REALTIME_VOICE_HE || 'cedar' },
      },
    },
  })

  /**
   * One spoken turn: synthesise it, stream it, and wait for the model to stop talking.
   *
   * No `response.create` anywhere. With turn detection on, the model answers when the VAD
   * says the caller finished — which is the behaviour under test. Asking for a response
   * would paper over the exact decision this adapter exists to exercise.
   */
  const sayOnce = (text) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('the agent did not answer in 90s')), TURN_TIMEOUT_MS)
      let spoken = ''
      let settle = null
      let pendingCalls = []
      let committed = false
      /** Whether the model started answering at all — the thing the fallback is really for. */
      let responding = false

      const finish = (err) => {
        clearTimeout(timer)
        clearTimeout(settle)
        ws.off('message', onMessage)
        if (err) reject(err)
        else resolve(spoken.trim())
      }

      const quietFor = (ms) => {
        clearTimeout(settle)
        settle = setTimeout(() => finish(), ms)
      }

      const onMessage = async (raw) => {
        let msg
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }

        if (msg.type.startsWith('response.') || msg.type.startsWith('conversation.')) clearTimeout(settle)

        // Proof the VAD drew a boundary rather than us drawing it for it.
        if (msg.type === 'input_audio_buffer.committed') committed = true
        if (msg.type === 'response.created') responding = true

        if (msg.type === 'conversation.item.input_audio_transcription.completed') {
          heard.push(msg.transcript ?? '')
        }

        if (msg.type === 'response.function_call_arguments.done') {
          const args = msg.arguments ? JSON.parse(msg.arguments) : {}
          pendingCalls.push(
            runTool(msg.name, args).then((result) => {
              const record = { tool: msg.name, args, result }
              toolCalls.push(record)
              lastTurnToolCalls.push(record)
              return { callId: msg.call_id, result }
            }),
          )
        }

        // The spoken answer, as words. Audio out means there is no output_text to read.
        if (msg.type === 'response.output_audio_transcript.done') spoken += `${msg.transcript ?? ''} `

        if (msg.type === 'response.done') {
          if (pendingCalls.length) {
            const batch = pendingCalls
            pendingCalls = []
            for (const { callId, result } of await Promise.all(batch)) {
              send({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
              })
            }
            send({ type: 'response.create' })
          } else {
            /**
             * Settle even on an empty response — that emptiness is a finding.
             *
             * The text adapter waits for prose before settling, which is right there: a
             * response with neither words nor a tool call is a transport hiccup. Here it is
             * the shape of failure #1 — a turn that produced a spoken sentence and no tool
             * call, or produced nothing at all. Refusing to settle on it would hang the run
             * on precisely the case worth reporting.
             */
            quietFor(spoken.trim() ? 2000 : 3500)
          }
        }

        if (msg.type === 'error') finish(new Error(msg.error?.message ?? 'realtime error'))
      }

      ws.on('message', onMessage)

      // Speak, then wait. Errors from the synthesis stage reject the turn rather than
      // arriving later as an unexplained silence.
      ;(async () => {
        const pcm = await speak(text, key)
        const silence = Buffer.alloc((SAMPLE_RATE * BYTES_PER_SAMPLE * TAIL_SILENCE_MS) / 1000)
        const stream = Buffer.concat([pcm, silence])

        for (let at = 0; at < stream.length; at += CHUNK_BYTES) {
          send({
            type: 'input_audio_buffer.append',
            audio: stream.subarray(at, at + CHUNK_BYTES).toString('base64'),
          })
          if (opts.realtime !== false) await sleep(100)
        }

        /**
         * A last resort, and committing alone was not enough to be one.
         *
         * If the detector never fires, the run hangs, and a harness that hangs teaches
         * nobody anything. The first version sent `input_audio_buffer.commit` and stopped
         * there — which closes the buffer and, with turn detection on, does NOT necessarily
         * start an answer. One run in five still sat until the ninety-second timeout, and
         * the fallback was the reason rather than the cure.
         *
         * So: commit if nothing has been committed, then ask for a response. Both guarded on
         * `responding`, because if the VAD did fire, a second `response.create` lands on an
         * already-active response and the error would be reported as a failed case.
         *
         * Waiting well past the trailing silence keeps the detector's own decision as the
         * real one wherever it makes one — and the run says which happened.
         */
        setTimeout(() => {
          if (responding) return
          if (!committed) send({ type: 'input_audio_buffer.commit' })
          send({ type: 'response.create' })
        }, TAIL_SILENCE_MS + 2500)
      })().catch(finish)
    })

  try {
    for (const turn of turns) {
      lastTurnToolCalls = []
      reply = await sayOnce(turn)
    }
  } finally {
    ws.close()
  }

  /**
   * A session that never accepted its configuration did not measure the agent.
   *
   * Throwing rather than returning a result: a run with no tools and no instructions
   * produces a fluent, plausible, entirely unprovenanced answer, and reporting that as a
   * FAIL would put the blame on the model. It is a broken instrument, and it has to say so.
   */
  const configured = sessionErrors.includes(null)
  const complaints = sessionErrors.filter(Boolean)
  if (!configured) {
    throw new Error(
      `the realtime session never accepted session.update${complaints.length ? `: ${complaints[0]}` : ''}`,
    )
  }

  return { reply, toolCalls, lastTurnToolCalls, heard, ms: Date.now() - started }
}
