import { Hono } from 'hono'
import { dashboard } from './dashboard.tsx'
import { docs } from './docs.tsx'
import { isAppHost, normalizeHost } from './lib/hosts.ts'

export const app = new Hono()

// Load balancers call this by IP address, so it comes first.
app.get('/up', (c) => c.text('ok'))

// Your own hostnames get the dashboard and webhooks. Every other
// host, and anything carrying X-Served-For, is a docs site. Both
// have a "/" page, so pick the app before routing.
app.all('*', (c) => {
  // c.req.url, not c.req.header('host'): a Request built in code
  // (app.request() in tests) has no Host header.
  const host = normalizeHost(new URL(c.req.url).host)
  const fromProxy = c.req.header('x-served-for') !== undefined
  const target = !fromProxy && isAppHost(host) ? dashboard : docs
  return target.fetch(c.req.raw, c.env)
})

