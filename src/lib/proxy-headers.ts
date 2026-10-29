import type { Context } from 'hono'

// The origin the visitor's browser is on, e.g. "https://docs.acme.com".
// @hono/node-server builds c.req.url from the Host header and the
// socket, so behind a proxy that terminates TLS it reads
// "http://<your own host>". Pass the host the browser used; the scheme
// comes from X-Forwarded-Proto, which SaaS Custom Domains sets to https.
export function publicOrigin(c: Context, host: string): string {
  const forwarded = c.req
    .header('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
  const scheme =
    forwarded || new URL(c.req.url).protocol.slice(0, -1)
  return `${scheme}://${host}`
}
