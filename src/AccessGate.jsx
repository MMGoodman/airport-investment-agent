import { useEffect, useState } from 'react'
import { setToken } from './accessToken.js'
import './AccessGate.css'

/**
 * Asks for the token, and only when the server is actually asking for one.
 *
 * WHY IT PROBES INSTEAD OF READING A BUILD FLAG
 *
 * Whether the gate is on is a property of the DEPLOYMENT, not of the bundle: the same built
 * files run on a laptop with no token and on a public host with one. A compile-time flag
 * would mean two builds, and the wrong one shipping is a screen demanding a password nobody
 * set — or worse, no screen in front of a server that needs one, which reads as "the app is
 * broken" rather than "you are not signed in".
 *
 * So it asks. `/api/health` is open by design and answers either way; any other endpoint
 * answers 401 when the gate is on. One request, and the page knows which world it is in.
 *
 * WHAT THIS IS NOT
 *
 * Not a login. There is no account, no session, no recovery. It is the one string that says
 * you are allowed to use this deployment, and the honest framing of that is on the screen —
 * calling it a password would imply an identity behind it that does not exist.
 */
export default function AccessGate({ children }) {
  const [state, setState] = useState('checking')
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)

  const probe = () =>
    // A gated endpoint, not /api/health — health answers 200 with or without a token and
    // would report every deployment as open.
    fetch('/api/agents')
      .then((r) => setState(r.status === 401 ? 'locked' : 'open'))
      // A server that is down is not a server that is locked; saying "wrong token" here
      // would send someone hunting for a string that was never the problem.
      .catch(() => setState('open'))

  useEffect(() => {
    probe()
  }, [])

  const submit = (event) => {
    event.preventDefault()
    setToken(value.trim())
    setError(null)
    fetch('/api/agents').then((r) => {
      if (r.ok) setState('open')
      else {
        setToken('')
        setError('הטוקן לא התקבל')
      }
    })
  }

  if (state === 'checking') return null
  if (state === 'open') return children

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1>סוכנים קוליים</h1>
        <p>
          הפריסה הזו סגורה בטוקן גישה. הוא לא סיסמה ואין מאחוריו חשבון — הוא המחרוזת שאומרת
          שמותר לך להשתמש בשרת הזה.
        </p>
        <input
          type="password"
          value={value}
          autoFocus
          placeholder="טוקן גישה"
          onChange={(e) => setValue(e.target.value)}
        />
        {error && <span className="gate-error">{error}</span>}
        <button type="submit" disabled={!value.trim()}>
          כניסה
        </button>
        {/* The one thing a person locked out actually needs to know. */}
        <small>הוא מוגדר כ-APP_ACCESS_TOKEN במשתני הסביבה של השרת.</small>
      </form>
    </div>
  )
}
