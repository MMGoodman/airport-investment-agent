import { useEffect, useRef, useState } from 'react'
import ToolTrace from './ToolTrace.jsx'
import './App.css'

const AGENT_NAME = 'Airport Agent'

// SPEC §1 — the four acceptance questions. They only get real answers once the
// scoring engine and tools land in M3/M4; until then they document the target.
const TARGET_QUESTIONS = [
  'Which airports in New England are strong candidates for terminal expansion?',
  'Compare LAX and SNA congestion levels.',
  'What is the percentage of long-haul flights out of Anchorage (ANC)?',
  'What is the unmet flight demand at SFO, and why?',
]

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [health, setHealth] = useState(null)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    fetch('/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Grow the box with the text. An empty box falls back to the CSS height —
  // measuring scrollHeight while empty would size it to the placeholder.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (!input) {
      el.style.height = ''
      return
    }
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  async function send(text = input) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const next = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Server returned ${res.status}`)
      setMessages([
        ...next,
        { role: 'assistant', content: data.reply, toolCalls: data.toolCalls },
      ])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <h1>Airport Investment Agent</h1>
            <p className="tagline">US terminal expansion — demand opportunity analysis</p>
          </div>
        </div>
        <div className={`status ${health?.ok ? 'up' : 'down'}`}>
          <span className="dot" aria-hidden="true" />
          <span className="status-text">
            {health ? (health.ok ? health.model : 'offline') : 'connecting…'}
          </span>
        </div>
      </header>

      <main className="messages">
        {messages.length === 0 && !loading && (
          <div className="welcome">
            <h2>Ask about US airport expansion candidates</h2>
            <p>
              Every figure comes from a deterministic scoring engine over BTS T-100 data —
              open the tool trace under any answer to see exactly which call produced it.
              Follow-up questions work; try “why is the second one ahead of the third?”.
            </p>
            <div className="chips">
              {TARGET_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="chip"
                  onClick={() => setInput(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, i) => (
          <article key={i} className={`row ${message.role}`}>
            <span className="who">{message.role === 'user' ? 'You' : AGENT_NAME}</span>
            <div className="bubble">{message.content}</div>
            <ToolTrace calls={message.toolCalls} />
          </article>
        ))}

        {loading && (
          <article className="row assistant">
            <span className="who">{AGENT_NAME}</span>
            <div className="bubble typing">
              <i />
              <i />
              <i />
            </div>
          </article>
        )}

        {error && (
          <div className="error">
            <span className="error-label">Request failed</span>
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div className="field">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about an airport…"
            rows={1}
            disabled={loading}
          />
          <button type="submit" aria-label="Send" disabled={loading || !input.trim()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M4 12h15M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <p className="hint">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </p>
      </form>
    </div>
  )
}

export default App
