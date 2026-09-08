import { useEffect, useRef, useState } from 'react'
import { setToken } from './accessToken.js'
import './AccessGate.css'

/**
 * The code screen — and the reason a visitor stares at nothing before they see it.
 *
 * WHY IT PROBES INSTEAD OF READING A BUILD FLAG
 *
 * Whether the gate is on is a property of the DEPLOYMENT, not of the bundle: the same built
 * files run on a laptop with no code set and on a public host with one. A compile-time flag
 * would mean two builds, and the wrong one shipping is a screen demanding a code nobody set
 * — or worse, no screen in front of a server that needs one, which reads as "the app is
 * broken" rather than "you are not signed in".
 *
 * So it asks. One request to a gated endpoint, and the page knows which world it is in.
 *
 * WHY THE WAITING STATE EXISTS AT ALL
 *
 * This used to be `if (state === 'checking') return null`, which is exactly right for the
 * eighty milliseconds that probe takes on a laptop. On a free host the instance sleeps after
 * fifteen idle minutes and the same request takes about fifty seconds — during which the
 * page drew NOTHING. No spinner, no text, a blank white rectangle for the better part of a
 * minute. Anybody sent the link closes it and reports that the link is broken, and they are
 * not being unreasonable.
 *
 * The fix is not a spinner. A spinner for fifty seconds looks stuck too. It has to say WHY,
 * so the wait reads as a known cost rather than a hang — and it appears only after a beat,
 * so a fast local load does not flash it.
 */
export default function AccessGate({ children }) {
  const [state, setState] = useState('checking')
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  /** Distinguishes "still checking" from "checking, and it has been a while". */
  const [slow, setSlow] = useState(false)
  const started = useRef(Date.now())

  const probe = () =>
    // A gated endpoint, not /api/health — health answers 200 with or without a code and
    // would report every deployment as open.
    fetch('/api/agents')
      .then((r) => setState(r.status === 401 || r.status === 429 ? 'locked' : 'open'))
      // A server that is down is not a server that is locked; saying "wrong code" here would
      // send someone hunting for a string that was never the problem.
      .catch(() => setState('open'))

  useEffect(() => {
    probe()
    // Long enough that a warm load never sees it, short enough that a cold one is not left
    // guessing.
    const t = setTimeout(() => setSlow(true), 1200)
    return () => clearTimeout(t)
  }, [])

  const submit = (event) => {
    event.preventDefault()
    setToken(value.trim())
    setError(null)
    fetch('/api/agents').then((r) => {
      if (r.ok) return setState('open')
      setToken('')
      // The two refusals mean different things and a person can act on only one of them.
      setError(r.status === 429 ? 'יותר מדי ניסיונות. המתן דקה.' : 'הקוד לא התקבל')
    })
  }

  if (state === 'open') return children

  if (state === 'checking') {
    if (!slow) return null
    const waited = Math.round((Date.now() - started.current) / 1000)
    return (
      <div className="gate">
        <div className="gate-card gate-waking">
          <h1>סוכנים קוליים</h1>
          <p className="gate-waking-line">
            <span className="gate-dot" aria-hidden="true" />
            מעיר את השרת…
          </p>
          {/* The reason, not a reassurance. "Loading" for fifty seconds looks broken; "the
              free instance sleeps" is a fact somebody can wait through. */}
          <p>
            הפריסה נרדמת אחרי רבע שעה בלי תנועה, וההערה לוקחת עד דקה. זה קורה פעם אחת, ואז
            הכל מהיר.
          </p>
          {waited > 8 && <small>{waited} שניות</small>}
        </div>
      </div>
    )
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1>סוכנים קוליים</h1>
        <p>הזן את קוד הכניסה כדי להיכנס לסביבה.</p>
        <input
          /**
           * `text`, not `password`.
           *
           * This is a code somebody was told in a meeting or read off a slide, not a secret
           * they chose. Masking it stops them checking what they typed, which is the single
           * most useful thing to be able to do when a code does not work — and it protects
           * nothing here, because the person typing it is the person who was given it.
           */
          type="text"
          className="gate-code"
          value={value}
          autoFocus
          autoComplete="off"
          spellCheck="false"
          placeholder="קוד כניסה"
          onChange={(e) => setValue(e.target.value)}
        />
        {/* Capitals, spaces and dashes are all ignored — say so, or somebody who typed it in
            lowercase will assume that was the problem. */}
        <small>אותיות גדולות, רווחים ומקפים לא משנים.</small>
        {error && <span className="gate-error">{error}</span>}
        <button type="submit" disabled={!value.trim()}>
          כניסה
        </button>
      </form>
    </div>
  )
}
