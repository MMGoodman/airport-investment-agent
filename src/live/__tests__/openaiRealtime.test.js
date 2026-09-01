/**
 * The data-channel state machine.
 *
 * These exist for one bug: a single response can ask for several tools, they arrive as
 * separate events, and each used to be answered on its own. The fastest tool then started
 * the reply — the model spoke with one result of two — and the second attempt to start a
 * response hit one that was already active.
 *
 * A race only reproduces when the timings differ, so the fake runner below returns the
 * second call first. That ordering is the whole test.
 */
import { describe, it, expect } from 'vitest'
import { createEventHandler } from '../openaiRealtime.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Collects everything the handler tried to send back over the channel. */
function harness({ delays = {}, interrupts = true } = {}) {
  const sent = []
  const toolOrder = []
  const handle = createEventHandler({
    send: (payload) => sent.push(payload),
    interrupts,
    run: async (name, args) => {
      await sleep(delays[name] ?? 0)
      toolOrder.push(name)
      return { tool: name, args, result: { data: { ok: name } }, ms: 1 }
    },
  })
  return { handle, sent, toolOrder }
}

const call = (name, callId) => ({
  type: 'response.function_call_arguments.done',
  name,
  call_id: callId,
  arguments: '{}',
})

const outputs = (sent) => sent.filter((p) => p.item?.type === 'function_call_output')
const creates = (sent) => sent.filter((p) => p.type === 'response.create')

describe('realtime tool batching', () => {
  it('answers a single tool call and asks for one response', async () => {
    const { handle, sent } = harness()
    await handle({ type: 'response.created' })
    await handle(call('rank_airports', 'c1'))
    await handle({ type: 'response.done' })

    expect(outputs(sent)).toHaveLength(1)
    expect(outputs(sent)[0].item.call_id).toBe('c1')
    expect(creates(sent)).toHaveLength(1)
  })

  it('waits for every tool in one response, even when the second returns first', async () => {
    // Boston takes longer than Portland. Before the fix, Portland's result alone started
    // the answer and Boston's arrived into a response that was already running.
    const { handle, sent, toolOrder } = harness({
      delays: { get_bos: 30, get_pdx: 5 },
    })

    await handle({ type: 'response.created' })
    const a = handle(call('get_bos', 'c-bos'))
    const b = handle(call('get_pdx', 'c-pdx'))
    await Promise.all([a, b])
    await handle({ type: 'response.done' })

    // The fake ran them concurrently and the fast one finished first — the race is real.
    expect(toolOrder).toEqual(['get_pdx', 'get_bos'])

    // Both results are handed back, in the order the model asked for them...
    expect(outputs(sent).map((p) => p.item.call_id)).toEqual(['c-bos', 'c-pdx'])

    // ...and the model is asked to speak exactly once, after both.
    expect(creates(sent)).toHaveLength(1)
    expect(sent.at(-1)).toEqual({ type: 'response.create' })
  })

  it('still returns results after a barge-in, but does not ask for an answer', async () => {
    const { handle, sent } = harness()
    await handle({ type: 'response.created' })
    await handle(call('rank_airports', 'c1'))
    // The caller starts talking again while the tool is in flight.
    await handle({ type: 'input_audio_buffer.speech_started' })
    await handle({ type: 'response.done' })

    // The output goes in regardless: a function_call with no output leaves the item list
    // malformed for every later turn.
    expect(outputs(sent)).toHaveLength(1)
    // But nothing is asked for — turn detection is about to open a new turn.
    expect(creates(sent)).toHaveLength(0)
  })

  it('still answers the tool when speech was configured not to interrupt', async () => {
    // From a trace in a noisy room: the caller asked for a comparison, the tool ran, the
    // response carrying its result was created — and 300 ms later a neighbour's voice
    // opened a turn and it was gone. Turning interruption off has to reach this decision
    // too, or the answer is still dropped by a voice that never stopped the model.
    const { handle, sent } = harness({ interrupts: false })
    await handle({ type: 'response.created' })
    await handle(call('rank_airports', 'c1'))
    await handle({ type: 'input_audio_buffer.speech_started' })
    await handle({ type: 'response.done' })

    expect(outputs(sent)).toHaveLength(1)
    expect(creates(sent)).toHaveLength(1)
  })

  it('treats each response separately', async () => {
    const { handle, sent } = harness()
    await handle({ type: 'response.created' })
    await handle(call('a', 'c1'))
    await handle({ type: 'response.done' })

    await handle({ type: 'response.created' })
    await handle(call('b', 'c2'))
    await handle({ type: 'response.done' })

    expect(outputs(sent).map((p) => p.item.call_id)).toEqual(['c1', 'c2'])
    expect(creates(sent)).toHaveLength(2)
  })

  it('does not ask for a response when nothing was called', async () => {
    const { handle, sent } = harness()
    await handle({ type: 'response.created' })
    await handle({ type: 'response.output_audio_transcript.done', transcript: 'hello' })
    await handle({ type: 'response.done' })

    expect(sent).toHaveLength(0)
  })
})
