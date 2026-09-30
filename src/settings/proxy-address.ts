/**
 * A proxy's host and port from whatever was typed or pasted: `isp.decodo.com`,
 * `http://isp.decodo.com:10000` and `user:pass@isp.decodo.com:10000` all give `isp.decodo.com`,
 * with the port when one was written. Throws when there is no usable host.
 */
export function parseProxyAddress(value: string) {
  const trimmed = value.trim()
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`)

  if (!url.hostname) {
    throw new TypeError('The proxy address has no host')
  }

  return { host: url.hostname.toLowerCase(), port: url.port ? Number(url.port) : null }
}

/** A port as typed, from 1 to 65535; null for anything else. */
export function parseProxyPort(value: string) {
  const trimmed = value.trim()

  if (!/^\d{1,5}$/u.test(trimmed)) {
    return null
  }

  const port = Number(trimmed)

  return port >= 1 && port <= 65_535 ? port : null
}
