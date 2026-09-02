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
              <span className="trace-ms">
                {call.ranOn === 'server' ? 'ran on your server' : `${call.ms} ms`}
              </span>
            </button>

            {open && (
              <pre className="trace-body">
                {call.ranOn === 'server'
                  ? [
                      'Your server answered this one, on its own connection to the same session.',
                      'The result went from the server straight to the model — this page never',
                      'received it, which is the whole reason the tool is placed there.',
                      '',
                      'The spoken answer above IS that result, read out by the model.',
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
