/**
 * The session cookie: how a request says which world it is about.
 *
 * ⚠ **A cookie rather than a header or a query parameter, and that is the whole
 * reason the renderer needs no changes.** The browser attaches a same-origin
 * cookie to `fetch('/api/...')` and to the `/ws` upgrade alike, so both
 * transports identify the visitor without either of them learning that sessions
 * exist. A header would have meant editing `HttpRendererTransport` *and*
 * `WebSocketRendererTransport`; a query parameter would have meant the client
 * generating and storing an id, which is the server's job.
 *
 * Deliberately not signed and not a login: the id names a world, and the worst a
 * forged one can do is join a stranger's simulation of grass and animals. There
 * is nothing behind it to protect, so a signing secret would be ceremony rather
 * than security.
 */
export const SESSION_COOKIE = 'biome.sid';

/** A conservative cookie-value shape — the ids we mint are UUIDs. */
const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Read the session id from a raw `Cookie` header, or null.
 *
 * ⚠ Validated rather than trusted. The value is attacker-controlled and becomes
 * a `Map` key, so an unbounded string would let a client mint arbitrarily many
 * arbitrarily large keys; anything that is not a plausible id is treated as
 * absent and a fresh one is issued.
 *
 * @param {string | undefined} header the request's `Cookie` header
 * @returns {string | null}
 */
export function readSessionId(header) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return VALID_ID.test(value) ? value : null;
  }
  return null;
}

/**
 * The `Set-Cookie` value that issues `id`.
 *
 * `SameSite=Lax` because nothing here is cross-site; `HttpOnly` because no
 * client script has any reason to read it; no `Expires`, so it is a session
 * cookie that dies with the browser — matching a world that is never persisted.
 * `Secure` only when served over TLS, so local http development still works.
 *
 * @param {string} id
 * @param {boolean} secure
 */
export function sessionCookieHeader(id, secure) {
  const parts = [`${SESSION_COOKIE}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
