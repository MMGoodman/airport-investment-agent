import { useState } from 'react'

/**
 * Shows which tool ran, with which arguments, and what it returned. This is the
 * demo's most useful panel: it lets a reader check that every figure in the prose
 * above came out of a deterministic handler rather than the model.
 */
export default function ToolTrace({ calls }) {
  const [openIndex, setOpenIndex] = useState(null)
  if (!calls?.length) return null

  return (
    <div className="trace">
      <div className="trace-head">
        <span className="trace-title">Tool trace</span>
        <span className="trace-count">
          {calls.length} deterministic {calls.length === 1 ? 'call' : 'calls'}
        </span>
      </div>

      {calls.map((call, i) => {
        const open = openIndex === i
        const args = Object.entries(call.args ?? {})
        return (
          <div key={i} className={`trace-call ${open ? 'open' : ''}`}>
            <button type="button" onClick={() => setOpenIndex(open ? null : i)}>
              <span className="trace-name">{call.tool}</span>
              <span className="trace-args">
                {args.length
                  ? args
                      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : JSON.stringify(v)}`)
                      .join('  ·  ')
                  : 'no arguments'}
              </span>
              {/* A call the server answered has no duration and no payload here, because
                  this panel only ever sees what the browser ran. It said "  ms" with the
                  number missing and opened to the word null, which reads as a broken row
                  rather than the design working. */}
              {/* A server-run call used to have no duration here at all: this panel only
                  saw what the browser ran, so the row said "ran on your server" and nothing
                  else. The reconcile brings the timing back with it now, and that is the
                  number worth showing — a placed tool is the one whose cost you cannot
                  otherwise see, and a row that arrives late earns its place by saying what
                  the delay was made of. */}
              <span className="trace-ms">
                {call.ranOn === 'server'
                  ? Number.isFinite(call.ms)
                    ? `${call.ms} ms · your server`
                    : 'ran on your server'
                  : `${call.ms} ms`}
              </span>
            </button>

            {open && (
              <pre className="trace-body">
                {call.ranOn === 'server'
                  ? [
                      'Your server ran this one. It holds the credentials and made the',
                      'outbound call; this page did NOT run it and cannot, because /api/tool',
                      'refuses the tool outright.',
                      '',
                      'How it got there depends on the path, and the difference is the whole',
                      'reason both exist:',
                      '',
                      '  OpenAI hybrid      your server opens a second connection INTO the',
                      '                     live session and answers on it. OpenAI echoes the',
                      '                     result to every connection, so this page sees it',
                      '                     as it happens.',
                      '',
                      '  ElevenLabs hybrid  their cloud calls an endpoint ON your server. No',
                      '                     event reaches this page at all, so the row above',
                      '                     is replayed from the server log when the turn',
                      '                     reconciles. That is why it appears after the',
                      '                     answer instead of before it, and why its timing',
                      '                     is the only view you get of what it cost.',
                      '',
                      'Either way, placement decides who EXECUTES and never who sees.',
                      '',
                      call.result === undefined
                        ? 'The payload stayed on the server on this path.'
                        : JSON.stringify(call.result, null, 2),
                    ].join('\n')
                  : JSON.stringify(call.result, null, 2)}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
