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
  phantom: '⊘',
  audit: '✓',
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
 *
 * The summary lines come from `totals`, counted as the session ran, not from the events
 * still in the list. The list is a ring: a busy session pushes its early rows out, and a
 * header computed from what is left described a different session from the one that
 * happened — "tool payloads: none" printed above "✓ audit 2 tool calls match the server
 * log", both true of their own source and only one of them true of the call. A trace that
 * disagrees with itself is worse than a short one, so the header now counts the session and
 * the body says plainly how much of it it can show.
 */
function buildReport(events, provider, lang, totals) {
  const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
  const firstWord = totals?.answers ?? []
  const acknowledged = totals?.acknowledged ?? []
  const byStage = totals?.stages ?? {}
  const payloads = totals?.payloads ?? []
  const seen = totals?.events ?? events.length
  const dropped = Math.max(0, seen - events.length)

  return [
    'airport-investment-agent — live session trace',
    `provider : ${provider?.label ?? 'unknown'}`,
    `pipeline : ${provider?.pipeline ?? provider?.transport ?? 'unknown'}`,
    `transport: ${provider?.transport ?? 'unknown'}`,
    `language : ${lang === 'he' ? 'Hebrew' : 'English'}`,
    firstWord.length
      ? `answer latency: ${firstWord.join(" ms, ")} ms` +
        (firstWord.length > 1 ? `  (mean ${mean(firstWord)} ms)` : '')
      : 'answer latency: not measured',
    /**
     * Counted, and kept out of the mean above.
     *
     * These are turns where the model began speaking before a transcript existed — so it was
     * not answering the question, it was acknowledging that one had been asked. Real, fast,
     * and not comparable: one 251 ms acknowledgement pulled a five-turn session's mean from
     * 1,337 to 1,120 ms, which would have made this path look faster than it is.
     */
    acknowledged.length
      ? `acknowledged first: ${acknowledged.join(' ms, ')} ms — spoke before the transcript, ` +
        'not counted as answers'
      : null,
    Object.keys(byStage).length
      ? 'stages  : ' + Object.entries(byStage).map(([k, v]) => `${k} ${mean(v)} ms`).join('  |  ')
      : 'stages  : none recorded',
    payloads.length
      ? `tool payloads: ${payloads.map((p) => `${p.text.split(' ')[0]} ${fmtBytes(p.bytes)}`).join(', ')}`
      : 'tool payloads: none',
    dropped
      ? `events: ${seen} — showing the last ${events.length}; ${dropped} earlier rows have scrolled out`
      : `events: ${seen}`,
    '',
    ...events.map(line),
    // The acknowledged line is null on most sessions and drops out here. The deliberate ''
    // above stays — it is the blank that separates the header from the body.
  ]
    .filter((l) => l !== null)
    .join('\n')
}

export default function LiveTrace({ events, verbose, onVerbose, onClear, provider, lang, totals }) {
  const endRef = useRef(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [events])

  async function copy() {
    const report = buildReport(events, provider, lang, totals?.current)
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

  /**
   * What was said, and what the machine did, are two different readings.
   *
   * The rail was one list of both, so a spoken sentence sat between a timing row and an
   * event name and you read past it looking for it. Speech is the reason the rail is open
   * during a call; the machinery is why it is open afterwards.
   *
   * The machinery collapses. It does not disappear — a count stays on the toggle, because
   * a hidden section with no sign of what is in it is a section people forget exists.
   */
  const SPEECH = new Set(['you', 'agent', 'phantom'])
  const speech = events.filter((e) => SPEECH.has(e.kind))
  const machine = (verbose ? events : events.filter((e) => e.kind !== 'raw')).filter(
    (e) => !SPEECH.has(e.kind),
  )
  const shown = verbose ? events : events.filter((e) => e.kind !== 'raw')

  return (
    <div className="ltrace">
      <div className="ltrace-head">
        <span className="ltrace-title">Session trace</span>
        <span className="ltrace-count">{speech.length} turns · {machine.length} events</span>
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
        {shown.length === 0 && (
          <p className="ltrace-empty">Start a call and it fills in as you talk.</p>
        )}

        {speech.map((e) => (
          <div key={e.id} className={`ltrace-said ${e.kind}${e.bad ? ' bad' : ''}`}>
            <span className="ltrace-who">
              {e.kind === 'you' ? 'אתה' : e.kind === 'phantom' ? 'נזרק' : 'הסוכן'}
            </span>
            <span className="ltrace-line">{e.text}</span>
            <span className="ltrace-t mono">{e.t.toFixed(1)}s</span>
          </div>
        ))}

        {machine.length > 0 && (
          <details className="ltrace-machine">
            <summary>
              מה שקרה מתחת — <span className="mono">{machine.length}</span> אירועים
            </summary>
            {machine.map((e) => (
              <div key={e.id} className={`ltrace-row ${e.kind}${e.bad ? ' bad' : ''}`}>
                <span className="ltrace-t">{e.t.toFixed(1)}s</span>
                <span className="ltrace-mark">{KIND_MARK[e.kind] ?? '·'}</span>
                <span className="ltrace-text">{e.text}</span>
                {e.bytes != null && <span className="ltrace-meta">{fmtBytes(e.bytes)}</span>}
                {e.ms != null && <span className="ltrace-meta">{e.ms} ms</span>}
              </div>
            ))}
          </details>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}
