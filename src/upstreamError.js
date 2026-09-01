/**
 * Turn an outbound failure into something a reader can act on.
 *
 * Node reports every unreachable host as the same two words: "fetch failed". On screen that
 * is indistinguishable from a missing key, a bad model name, a rejected request or a typo
 * in a URL — a caller saw it under both the voice panel and the chat pane at once and had
 * no way to tell a dropped connection from a broken build. The cause and the cure are
 * different for each, and only one of them is "try again".
 *
 * The underlying reason is on err.cause, where undici puts the DNS or socket error, so it
 * is worth surfacing: ENOTFOUND is a name that does not resolve, ECONNREFUSED is a door
 * that is shut, ETIMEDOUT is one that never answered.
 */
export function describeUpstreamError(err, what) {
  const code = err?.cause?.code ?? err?.code ?? null
  const detail = err?.cause?.message ?? err?.message ?? String(err)

  if (err?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return `${what} did not answer in time. The request left this server and nothing came back — usually the network, not the configuration. Try again.`
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `${what} could not be resolved (${code}). This server has no working DNS for it right now. Try again; if it persists, the machine is offline.`
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') {
    return `The connection to ${what} was dropped (${code}). Try again.`
  }
  if (detail === 'fetch failed') {
    return `Could not reach ${what}. The request never left this server or never got an answer — a connectivity problem, not a configuration one. Try again.`
  }
  return `${what}: ${detail}`
}
