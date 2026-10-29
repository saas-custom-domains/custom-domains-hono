// "Docs.Acme.com." and "docs.acme.com:443" are the same host.
export function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
}

function hostList(value: string | undefined): string[] {
  return (value ?? '').split(',').map(normalizeHost).filter(Boolean)
}

// Hostnames that serve this app itself (dashboard, webhooks), not a
// customer's docs. Set APP_HOSTS in production; include any internal
// name your platform uses to reach the app.
const APP_HOSTS = hostList(process.env.APP_HOSTS ?? 'localhost')

// The domain customers can't claim (e.g. "refdocs.dev").
const APP_DOMAIN = normalizeHost(process.env.APP_DOMAIN ?? '')

export function isAppHost(host: string): boolean {
  return APP_HOSTS.includes(host)
}

export function isReservedHost(host: string): boolean {
  if (isAppHost(host)) return true
  if (!APP_DOMAIN) return false
  return host === APP_DOMAIN || host.endsWith(`.${APP_DOMAIN}`)
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

export function isValidHost(host: string): boolean {
  if (host.length > 253) return false
  const labels = host.split('.')
  return labels.length >= 2 && labels.every((l) => LABEL.test(l))
}
