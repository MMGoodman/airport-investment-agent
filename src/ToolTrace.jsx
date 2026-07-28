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
              <span className="trace-ms">{call.ms} ms</span>
            </button>

            {open && (
              <pre className="trace-body">{JSON.stringify(call.result, null, 2)}</pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
