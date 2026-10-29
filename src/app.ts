import { Hono } from 'hono'
import { dashboard } from './dashboard.tsx'
import { docs } from './docs.tsx'
import { isAppHost, normalizeHost } from './lib/hosts.ts'

export const app = new Hono()

// Health check for Docker and load balancers. It comes before the host
// check because they call it by IP address.
app.get('/up', (c) => c.text('ok'))

// Your own hostnames get the dashboard and webhooks. Everything else,
// and anything sent through SaaS Custom Domains (X-Served-For), is a
// customer's docs site. Both have a "/" page, so pick the app first.
app.all('*', (c) => {
  // c.req.url, not c.req.header('host'): on Node they agree, but a
  // Request built in code (app.request() in tests) has no Host header.
  const host = normalizeHost(new URL(c.req.url).host)
  const fromProxy = c.req.header('x-served-for') !== undefined
  const target = !fromProxy && isAppHost(host) ? dashboard : docs
  return target.fetch(c.req.raw, c.env)
})

