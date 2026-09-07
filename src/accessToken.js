/**
 * The shared token, remembered here and attached to everything that leaves the page.
 *
 * WHY IT PATCHES `fetch` INSTEAD OF BEING PASSED AROUND
 *
 * There are well over a hundred `fetch('/api/…')` calls across this app, written over weeks
 * by someone who had no reason to think about a header. Threading a token through all of
 * them means touching every one, and — the part that actually matters — it means the next
 * one written forgets, and forgets silently: a 401 in a pane nobody was looking at reads as
 * "the feature is broken", not "the request was unauthenticated".
 *
 * Patching the one function they all go through makes the gate impossible to route around
 * by accident. It is a big hammer and it is deliberately confined: same-origin `/api/`
 * requests only, so nothing here can leak the token to a third party.
 *
 * WHY localStorage
 *
 * It is not a password and there is no account behind it. It is the string that says which
 * deployment you are allowed to talk to, and it has to survive a reload or you type it every
 * time. Anyone who can read this page's localStorage already has the page.
 */
const KEY = 'app-access-token'

export const getToken = () => {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    // A private window. The token then lives for this page load only, which still works.
    return memory
  }
}

let memory = ''

export const setToken = (value) => {
  memory = value ?? ''
  try {
    if (value) localStorage.setItem(KEY, value)
    else localStorage.removeItem(KEY)
  } catch {
    /* memory holds it for this load */
  }
}

/**
 * A WebSocket cannot carry a header, so its token rides in the URL.
 *
 * Not a shortcut: the `WebSocket` constructor takes a URL and subprotocols, and that is the
 * whole API. The server accepts the token from either place for exactly this reason.
 */
export const withToken = (url) => {
  const token = getToken()
  if (!token) return url
  return url + (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`
}

/** Installed once, from main.jsx, before anything has had a chance to call fetch. */
export function installAuth() {
  const original = window.fetch.bind(window)

  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url ?? ''
    // Same-origin API calls only. A relative /api/ path, or this origin's own /api/.
    const ours = url.startsWith('/api/') || url.startsWith(`${location.origin}/api/`)
    const token = getToken()
    if (!ours || !token) return original(input, init)

    const headers = new Headers(init.headers ?? (typeof input === 'object' ? input.headers : undefined))
    headers.set('x-access-token', token)
    return original(input, { ...init, headers })
  }
}
