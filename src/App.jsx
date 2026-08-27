import { useCallback, useEffect, useRef, useState } from 'react'
import ToolTrace from './ToolTrace.jsx'
import LivePanel from './LivePanel.jsx'
import Markdown from './Markdown.jsx'
import { toPlainText } from './markdown.js'
import { useDictation, useSpeech } from './voice.js'
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
  // Which brain answers, and over which pipe. All three share the same tools.
  const [providers, setProviders] = useState([])
  const [providerId, setProviderId] = useState('gemini')
  // Applies to all three paths: it steers the reply, and on the live paths the
  // transcriber and the voice as well.
  const [lang, setLang] = useState('en')
  const [readAloud, setReadAloud] = useState(false)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  // Anything already typed stays put; dictation appends to it rather than replacing it.
  const dictationBase = useRef('')
  const dictation = useDictation({
    onTranscript: (heard) => setInput(`${dictationBase.current} ${heard}`.trimStart()),
  })
  const { speak, cancel: cancelSpeech, supported: speechSupported } = useSpeech()

  // Index of the last message read out, so a re-render never repeats an answer.
  const spokenThrough = useRef(0)

  useEffect(() => {
    fetch('/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }))

    fetch('/api/voice/providers')
      .then((res) => res.json())
      .then((d) => setProviders(d.providers ?? []))
      .catch(() => setProviders([]))
  }, [])

  useEffect(() => {
    if (!readAloud || messages.length <= spokenThrough.current) return
    spokenThrough.current = messages.length
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant') speak(toPlainText(last.content))
  }, [messages, readAloud, speak])

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

    dictation.stop()
    cancelSpeech()

    const next = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, lang }),
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

  // A live turn lands in the same list a typed one does, so ToolTrace renders it the same.
  const appendLive = useCallback((message) => {
    setMessages((prev) => [...prev, message])
    setError(null)
  }, [])

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  function toggleMic() {
    if (dictation.listening) {
      dictation.stop()
      return
    }
    dictationBase.current = input
    dictation.start()
  }

  // Turning it on mid-conversation should not replay the answer already on screen.
  function toggleReadAloud() {
    if (readAloud) {
      cancelSpeech()
      setReadAloud(false)
      return
    }
    spokenThrough.current = messages.length
    setReadAloud(true)
  }

  const activeProvider = providers.find((p) => p.id === providerId) ?? null
  const live = activeProvider?.mode === 'live'

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
        <div className="topbar-right">
          <button
            type="button"
            className={`toggle ${readAloud ? 'on' : ''}`}
            onClick={toggleReadAloud}
            disabled={!speechSupported}
            aria-pressed={readAloud}
            title={
              speechSupported
                ? 'Read answers aloud'
                : 'This browser has no speech synthesis — try Chrome or Edge'
            }
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M11 5 6.5 9H3v6h3.5L11 19V5Z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              {readAloud ? (
                <path
                  d="M15 9.5a3.5 3.5 0 0 1 0 5M17.8 6.8a7 7 0 0 1 0 10.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="m16 10 5 4m0-4-5 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              )}
            </svg>
            <span>{readAloud ? 'voice on' : 'voice off'}</span>
          </button>

          <label
            className="switcher lang"
            title={
              providerId === 'elevenlabs'
                ? 'Reply language. On this provider it also switches the transcriber and the voice, so choose it before starting the call — it cannot change mid-session.'
                : 'Reply language. Speech recognition auto-detects, so you can ask in one language and be answered in another, or just ask the agent to switch.'
            }
          >
            <select value={lang} onChange={(event) => setLang(event.target.value)} aria-label="Language">
              <option value="en">EN</option>
              <option value="he">HE</option>
            </select>
          </label>

          <label className={`switcher ${health?.ok ? 'up' : 'down'} ${live ? 'live' : ''}`}>
            <span className="dot" aria-hidden="true" />
            <select
              value={providerId}
              onChange={(event) => {
                setProviderId(event.target.value)
                setError(null)
              }}
              aria-label="Model and transport"
              title="Same tools, same scoring engine — only the model and the transport change"
            >
              {providers.length === 0 && (
                <option value="gemini">{health?.model ?? 'connecting…'}</option>
              )}
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}
                  {p.available ? '' : ' — no key'}
                </option>
              ))}
            </select>
          </label>
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
            <div className="bubble">
              {message.role === 'user' ? message.content : <Markdown text={message.content} />}
            </div>
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

      {live ? (
        <LivePanel provider={activeProvider} lang={lang} onAppend={appendLive} onError={setError} />
      ) : (
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
            placeholder={dictation.listening ? 'Listening…' : 'Ask about an airport…'}
            rows={1}
            disabled={loading}
          />
          <button
            type="button"
            className={`ghost ${dictation.listening ? 'live' : ''}`}
            onClick={toggleMic}
            disabled={loading || !dictation.supported}
            aria-pressed={dictation.listening}
            title={
              dictation.supported
                ? 'Ask by voice'
                : 'This browser has no speech recognition — try Chrome or Edge'
            }
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <rect
                x="9"
                y="2.5"
                width="6"
                height="11"
                rx="3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
              />
              <path
                d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
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
          {dictation.error ? (
            <span className="hint-warn">{dictation.error}</span>
          ) : dictation.listening ? (
            'Speak your question — it stops on its own when you pause.'
          ) : (
            <>
              <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line ·
              mic to dictate
            </>
          )}
        </p>
      </form>
      )}
    </div>
  )
}

export default App
