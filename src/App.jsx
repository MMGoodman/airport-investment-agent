import { useEffect, useRef, useState } from 'react'
import './App.css'

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(event) {
    event.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    const next = [...messages, { role: 'user', content: text }]
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
      setMessages([...next, { role: 'assistant', content: data.reply }])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Airport Investment Agent</h1>
        <p>Step 1 — chat shell</p>
      </header>

      <main className="messages">
        {messages.length === 0 && !loading && (
          <p className="empty">Ask anything to check the connection.</p>
        )}
        {messages.map((message, i) => (
          <div key={i} className={`message ${message.role}`}>
            <span className="who">{message.role === 'user' ? 'You' : 'Claude'}</span>
            <div className="bubble">{message.content}</div>
          </div>
        ))}
        {loading && (
          <div className="message assistant">
            <span className="who">Claude</span>
            <div className="bubble">…</div>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div ref={bottomRef} />
      </main>

      <form className="composer" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}

export default App
