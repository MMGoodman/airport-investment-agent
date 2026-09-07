/**
 * OpenAI Realtime over WebRTC — true speech-to-speech, with barge-in.
 *
 * Audio goes browser <-> OpenAI directly as a peer connection; our server is only
 * involved once, to mint an ephemeral key. Function calls arrive on the data channel,
 * we run them against POST /api/tool, and hand the structured result straight back.
 *
 * The model narrates. It never computes — it has no tool that would let it.
 */
import { callTool, getToolSession, parseArgs } from './tools.js'
import { isHintEcho } from '../agent/phantom.js'

const SDP_ENDPOINT = 'https://api.openai.com/v1/realtime/calls'

/** Distinct hint terms in one transcript above which it is the hint, not a caller. */

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
  onServerToolCall = () => {},
  onServerToolResult = () => {},
  onSkillLoaded = () => {},
  /** The vocabulary hint's own terms, for spotting it read back. */
  hintTerms = [],
  /**
   * Tools this side must NOT answer.
   *
   * Once the sideband is attached, the server is on the same session and answers these. Both
   * sides answering would put two function_call_output items under one call_id and leave the
   * conversation item list malformed for every later turn. The browser also cannot run them:
   * POST /api/tool refuses a server-placed tool outright.
   */
  serverTools = [],
  /**
   * Instructions that arrive when they become relevant.
   *
   * `baseInstructions` is what the session opened with; each skill is a set of rules plus
   * the tools that make them apply. The first time one of those tools is called, the skill
   * is loaded — the model reaching for rank_airports IS the signal that the ranking rules
   * are now relevant, so there is no router and no classifier, and the signal costs nothing
   * because the tool call was happening anyway.
   *
   * session.update REPLACES instructions, so every load sends base plus everything already
   * loaded. That is why the base is passed in rather than looked up.
   *
   * And why it can be REPLACED mid-call. The base the session opened with says the weather
   * tool is not offered on this line — true until the sideband attaches, false the moment it
   * does. The sideband lifts that note in its own update, but a skill loading afterwards
   * rebuilt instructions from this base and put the note back. Measured: the sideband
   * attached at 5.2s, the ranking skill loaded at 14.3s, and at 32.9s the model answered a
   * weather question with "not available in this call" while holding the tool.
   */
  baseInstructions = '',
  skills = [],
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
  /**
   * Server-answered calls awaiting their result, by call_id.
   *
   * The server injects its function_call_output into the session, and OpenAI echoes that
   * item to EVERY connection — so this one receives the payload whether it wants it or not.
   * Verified against the live API: conversation.item.added carries item.output in full.
   *
   * That is worth capturing rather than ignoring. The panel was telling readers the browser
   * never saw the result, which is false, and a trace that claims less visibility than it
   * has is as misleading as one that claims more.
   */
  const serverCalls = new Map()

  /**
   * The base as it stands NOW, which is not always the one this handler was built with.
   * See baseInstructions above: the sideband hands over a version without the withheld note,
   * and every later skill load has to compose from that one instead.
   */
  let base = baseInstructions
  const adoptInstructions = (text) => {
    if (text) base = text
  }

  /** Loaded already. A second send would be harmless but it is an update on a live call. */
  const loadedSkills = new Set()

  const loadSkillFor = (toolName) => {
    const skill = skills.find((s) => !loadedSkills.has(s.id) && s.tools?.includes(toolName))
    if (!skill || !base) return
    loadedSkills.add(skill.id)
    const parts = [base]
    for (const s of skills) if (loadedSkills.has(s.id)) parts.push(s.instructions)
    send({
      type: 'session.update',
      session: { type: 'realtime', instructions: parts.join('\n\n') },
    })

    onSkillLoaded(skill)
  }

  let bargedIn = false

  async function handle(msg) {
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
        if (isHintEcho(heard, hintTerms)) {
          // Reported, not silently swallowed: a dropped transcript the reader cannot see
          // would make the session look like it missed a question.
          onPhantom(heard)
          break
        }
        onUserTranscript(heard)
        break
      }

      // The server's answer, echoed back to this connection like every other item.
      case 'conversation.item.added': {
        const item = msg.item
        if (item?.type !== 'function_call_output') break
        const pending = serverCalls.get(item.call_id)
        if (!pending) break
        serverCalls.delete(item.call_id)
        let result = null
        try {
          result = JSON.parse(item.output)
        } catch {
          result = { raw: item.output }
        }
        onServerToolResult(pending.name, pending.args, result, item.call_id)
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
        // Before anything is answered: the rules for this kind of answer arrive first.
        loadSkillFor(msg.name)
        // Not ours. The server is attached to this same session and is answering it there,
        // against its own credentials — the whole point of the sideband. Reported so the
        // trace still shows the call happened, then dropped.
        if (serverTools.includes(msg.name)) {
          // Remember which call this was, so its result can be recognised when the server's
          // answer is echoed back to this connection a moment later.
          serverCalls.set(msg.call_id, { name: msg.name, args: parseArgs(msg.arguments) })
          onServerToolCall(msg.name, parseArgs(msg.arguments), msg.call_id)
          break
        }
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

  // The sideband's way in. It is the only thing that can tell this handler the withheld note
  // stopped being true.
  handle.adoptInstructions = adoptInstructions
  return handle
}

export async function startOpenAIRealtime({
  audioEl,
  lang = 'en',
  /**
   * Whether this server should join the call and answer its server-placed tools.
   *
   * Off is not a degraded mode — it is the honest one for a page that must be the only
   * client on the session, and the model is told what it is missing and why.
   */
  sideband = false,
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

  // The session id goes up with the mint so the server can hold this call's ephemeral key
  // for the sideband, which has to authenticate as the secret that created the session.
  const params = new URLSearchParams({ lang })
  const toolSession = getToolSession()
  if (toolSession) params.set('session', toolSession)
  for (const [k, v] of Object.entries(pipeline)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }

  const keyRes = await fetch(`/api/realtime/session?${params}`)
  const keyBody = await keyRes.json()
  if (!keyRes.ok) throw new Error(keyBody.error ?? 'Could not mint a realtime key')
  const {
    clientSecret,
    model,
    vad,
    vocabulary,
    hintTerms = [],
    interrupts = true,
    withheldTools = [],
    baseInstructions = '',
    skills = [],
  } = keyBody
  // Record what this call ran under, so a pasted trace can be compared against another
  // that was configured differently. The server reports what it USED, after clamping —
  // not what was asked for.
  if (vad) onStatus(`turn detection: ${vad}`)
  onStatus(`vocabulary bias: ${vocabulary ? 'on' : 'off'}`)
  // What this line cannot reach, said at the start rather than discovered when an answer
  // goes missing. On this transport the model's function calls arrive in the browser, so a
  // tool placed on the server is not offered here at all.
  if (withheldTools.length) {
    onStatus(
      sideband
        ? `tools: browser-run · ${withheldTools.join(', ')} handed to your server`
        : `tools: browser-run · ${withheldTools.join(', ')} withheld (server-only)`,
    )
  }

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

  /**
   * Filled in once the sideband attaches, which happens after this handler exists.
   *
   * A live array rather than a value: the handler reads it at call time, so the set can grow
   * mid-session without rebuilding the handler around it.
   */
  const serverToolNames = []
  const adoptServerTools = (names) => serverToolNames.push(...names)

  const handle = createEventHandler({
    send,
    serverTools: serverToolNames,
    // The call, so the trace shows it the moment it happens; then the result when the
    // server's answer comes back round, which replaces the row rather than adding one.
    /**
     * OpenAI's call id, under a name of its own — NOT `callId`.
     *
     * It was `callId` for one session and broke the audit: the reconcile posts every claimed
     * `{callId, digest}` to the server, which matches against ITS log, and OpenAI's ids
     * belong to a different space entirely. Two weather calls that had run correctly came
     * back as "trace does not match the server log — 2 not run".
     *
     * The browser has no way to know the server's id for a call the server made on its own.
     * So this id is for telling one sideband call from another here, and nothing else.
     */
    onServerToolCall: (name, args, sidebandId) =>
      onToolCall({ tool: name, args, sidebandId, ranOn: 'server', ms: null }),
    onServerToolResult: (name, args, result, sidebandId) =>
      onToolCall({ tool: name, args, result, sidebandId, ranOn: 'server', ms: null, isResult: true }),
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
    baseInstructions,
    skills,
    onSkillLoaded: (skill) =>
      onStatus(`skill loaded: ${skill.name} · ${skill.instructions.length} chars`),
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

  /**
   * The call id, so this server can join the same session.
   *
   * OpenAI returns it as "Location: /v1/realtime/calls/rtc_…" and lists Location in
   * Access-Control-Expose-Headers, which is the only reason a page can read it at all.
   * Verified against the live API rather than assumed — a header that is not exposed is
   * invisible to fetch() no matter what the response contains.
   */
  const callId = (sdpRes.headers.get('location') ?? '').split('/').pop() || null

  await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })

  /**
   * Hand the call to the server so it can take over the tools this side must not run.
   *
   * Deliberately after setRemoteDescription and deliberately not awaited into the critical
   * path of failure: if the sideband cannot attach, the call still works — it works the way
   * it did before this existed, with the tool withheld and the model saying so. A voice call
   * that dies because a secondary connection failed would be a worse trade than the one this
   * whole feature is here to improve.
   */
  /**
   * Fire and forget, once the session is actually live.
   *
   * Two things this got wrong on the first live attempt. It was awaited, so a secondary
   * connection that stalled held up the session handle the panel needs — the same shape as
   * an earlier bug in this file where startOpenAIRealtime never returned and hanging up had
   * nothing to close. And it fired the moment setRemoteDescription resolved, which is before
   * the call exists as far as the other end is concerned: the data channel opened 700 ms
   * later, and the attach had already spent its deadline waiting for a session that was not
   * yet there.
   *
   * So: after the data channel opens, never awaited, and if it fails the call is exactly
   * what it was before this existed — the tool withheld, and the model saying which switch
   * to use. That fallback is proven; this is the upgrade on top of it.
   */
  const attachSideband = () => {
    if (!sideband || !callId || withheldTools.length === 0) return
    const deadline = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('no answer in 8s')), 8000),
    )
    Promise.race([
      fetch('/api/realtime/sideband', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, session: getToolSession() }),
      }).then(async (res) => {
        const body = await res.json()
        if (!res.ok || !body.attached) throw new Error(body.error ?? 'declined')
        return body
      }),
      deadline,
    ])
      .then((body) => {
        adoptServerTools(body.tools ?? [])
        // Same reason the sideband sends its own: the note saying these tools are unavailable
        // stops being true here, and a skill loading later must not put it back.
        handle.adoptInstructions?.(body.instructions)
        onStatus(`tools: ${(body.tools ?? []).join(', ')} now run on your server — same session`)
      })
      .catch((err) => {
        onStatus(`tools: sideband did not attach (${err.message}) — ${withheldTools.join(', ')} stays withheld`)
      })
  }

  if (dc.readyState === 'open') attachSideband()
  else dc.addEventListener('open', attachSideband, { once: true })

  return {
    /** Which call this is, so the server can be told to let go of it. */
    callId,
    /**
     * Put a correction into the conversation WITHOUT asking for an answer.
     *
     * There is one situation that needs this and it is bad enough to justify the method: the
     * model calls end_call, the tool answers "acknowledged, the client will close", and then
     * the client declines to close because the caller never said goodbye. The model has been
     * told the call is over and the call is not over. Measured: it said "להתראות, יום טוב",
     * then answered the next three turns with "sorry, the conversation has already closed" —
     * including the one where the caller asked it to hang up, which it could no longer do.
     *
     * No `response.create`, deliberately. The fact belongs in the context; a spoken sentence
     * about it would be the agent narrating its own plumbing.
     */
    note(text) {
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
      })
    },
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
        // Tell the server to drop its half. OpenAI tears the sideband down with the call,
        // but not always promptly, and a socket left sitting on a finished session is a
        // second listener nobody asked for.
        ['sideband', () => {
          if (!callId) return
          fetch('/api/realtime/sideband/detach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId }),
          }).catch(() => {})
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
