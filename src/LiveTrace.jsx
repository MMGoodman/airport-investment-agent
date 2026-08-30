import { useEffect, useRef, useState } from 'react'

/**
 * The running log of a live session.
 *
 * ToolTrace, under each answer, shows what a finished turn was built from. This shows the
 * turn happening: when the microphone opened, when speech was detected, which tool fired,
 * how many bytes came back and how long the model then took to start talking. The byte
 * count and `time to first word` are the point — between them they are usually the whole
 * answer to "why was that slow".
 */

const KIND_MARK = {
  session: '●',
  you: '▸',
  agent: '◂',
  tool: '⚙',
  result: '↩',
  timing: '⏱',
  raw: '·',
  error: '✕',
}

const fmtBytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`)

/** One event as a fixed-width line, so a pasted log stays readable anywhere. */
function line(e) {
  const meta = [e.bytes != null ? fmtBytes(e.bytes) : null, e.ms != null ? `${e.ms} ms` : null]
    .filter(Boolean)
    .join('  ')
  return `${`${e.t.toFixed(1)}s`.padStart(7)}  ${KIND_MARK[e.kind] ?? '·'} ${e.kind.padEnd(7)} ${e.text}${
    meta ? `   ${meta}` : ''
  }`
}

/**
 * Everything needed to diagnose a session elsewhere: what was running, and what happened.
 * Raw events are always included even when the panel is filtering them out — they are the
 * most useful half when something went wrong.
 */
function buildReport(events, provider, lang) {
  const timings = events.filter((e) => e.kind === 'timing')
  const firstWord = timings.filter((e) => e.text === 'answer').map((e) => e.ms)
  const byStage = {}
  for (const t of timings) (byStage[t.text] ??= []).push(t.ms)
  const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
  const payloads = events.filter((e) => e.bytes != null)

  return [
    'airport-investment-agent — live session trace',
    `provider : ${provider?.label ?? 'unknown'}`,
    `pipeline : ${provider?.pipeline ?? provider?.transport ?? 'unknown'}`,
    `transport: ${provider?.transport ?? 'unknown'}`,
    `language : ${lang === 'he' ? 'Hebrew' : 'English'}`,
    firstWord.length
      ? `answer latency: ${firstWord.join(" ms, ")} ms` +
        (firstWord.length > 1
          ? `  (mean ${Math.round(firstWord.reduce((a, b) => a + b, 0) / firstWord.length)} ms)`
          : '')
      : 'answer latency: not measured',
    Object.keys(byStage).length
      ? 'stages  : ' + Object.entries(byStage).map(([k, v]) => `${k} ${mean(v)} ms`).join('  |  ')
      : 'stages  : none recorded',
    payloads.length
      ? `tool payloads: ${payloads.map((p) => `${p.text.split(' ')[0]} ${fmtBytes(p.bytes)}`).join(', ')}`
      : 'tool payloads: none',
    `events: ${events.length}`,
    '',
    ...events.map(line),
  ].join('\n')
}

export default function LiveTrace({ events, verbose, onVerbose, onClear, provider, lang }) {
  const endRef = useRef(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [events])

  async function copy() {
    const report = buildReport(events, provider, lang)
    try {
      await navigator.clipboard.writeText(report)
    } catch {
      // Clipboard permission can be refused; a selected textarea always works.
      const el = document.createElement('textarea')
      el.value = report
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      el.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const shown = verbose ? events : events.filter((e) => e.kind !== 'raw')

  return (
    <div className="ltrace">
      <div className="ltrace-head">
        <span className="ltrace-title">Session trace</span>
        <span className="ltrace-count">{shown.length} events</span>
        <label className="ltrace-verbose">
          <input type="checkbox" checked={verbose} onChange={(e) => onVerbose(e.target.checked)} />
          raw events
        </label>
        <button
          type="button"
          onClick={copy}
          className="ltrace-copy"
          disabled={events.length === 0}
          title="Copy the whole session — settings, timings and payload sizes — as text"
        >
          {copied ? 'copied ✓' : 'copy'}
        </button>
        <button type="button" onClick={onClear} className="ltrace-clear">
          clear
        </button>
      </div>

      <div className="ltrace-body">
        {shown.length === 0 && <p className="ltrace-empty">Start a call and it fills in as you talk.</p>}

        {shown.map((e) => (
          <div key={e.id} className={`ltrace-row ${e.kind}`}>
            <span className="ltrace-t">{e.t.toFixed(1)}s</span>
            <span className="ltrace-mark">{KIND_MARK[e.kind] ?? '·'}</span>
            <span className="ltrace-text">{e.text}</span>
            {e.bytes != null && <span className="ltrace-meta">{fmtBytes(e.bytes)}</span>}
            {e.ms != null && <span className="ltrace-meta">{e.ms} ms</span>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
