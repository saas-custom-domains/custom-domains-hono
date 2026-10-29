// Hono behaviour behind a proxy that this app works around. Each test
// pins down what the framework does, so a release that changes it
// shows up here.
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { getRequestListener } from '@hono/node-server'
import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.ts'
import { db } from '../../src/lib/db.ts'

beforeAll(() => {
  db().exec(`
    DELETE FROM custom_domains;
    INSERT INTO custom_domains (tenant_id, host, status)
    VALUES (1, 'docs.acme.com', 'active');
  `)
})

// A form POST from https://docs.acme.com as it reaches the app through
// SaaS Custom Domains, from a browser that sends no Sec-Fetch-Site
// (older browsers, and every browser on plain-HTTP sites).
const proxiedFormPost = {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'https://docs.acme.com',
    'x-forwarded-host': 'app:3000',
    'x-forwarded-proto': 'https',
    'x-served-for': 'docs.acme.com',
    'x-saas-domains-auth-token': 'test_proxy_token',
  },
  body: 'email=dev%40example.com',
}

describe('hono/csrf with default options', () => {
  const plain = new Hono().use(csrf()).post('/get-a-key', (c) => c.text('ok'))

  it('rejects a form POST made on a customer domain: 403 "Forbidden"', async () => {
    const res = await plain.request('http://app:3000/get-a-key', proxiedFormPost)
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('Forbidden')
  })

  it('lets it through when the browser sends Sec-Fetch-Site: same-origin', async () => {
    const res = await plain.request('http://app:3000/get-a-key', {
      ...proxiedFormPost,
      headers: { ...proxiedFormPost.headers, 'sec-fetch-site': 'same-origin' },
    })
    expect(res.status).toBe(200)
  })
})

describe('this app', () => {
  it('accepts the same POST, comparing Origin with the customer domain', async () => {
    const res = await app.request('http://app:3000/get-a-key', proxiedFormPost)
    expect(res.status).toBe(303)
  })

  it('builds canonical URLs on the customer domain', async () => {
    const res = await app.request('http://app:3000/docs/authentication', {
      headers: proxiedFormPost.headers,
    })
    expect(await res.text()).toContain(
      '<link rel="canonical" href="https://docs.acme.com/docs/authentication"/>',
    )
  })
})

describe('@hono/node-server', () => {
  it('builds c.req.url from Host and the socket, not X-Forwarded-*', async () => {
    const probe = new Hono().get('/x', (c) =>
      c.json({ url: c.req.url, host: c.req.header('host') }),
    )
    const server = createServer(getRequestListener(probe.fetch))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo

    const body = await new Promise<string>((resolve, reject) => {
      httpRequest(
        {
          port,
          path: '/x',
          headers: {
            host: 'app:3000',
            'x-forwarded-host': 'docs.acme.com',
            'x-forwarded-proto': 'https',
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => (data += chunk))
          res.on('end', () => resolve(data))
        },
      ).on('error', reject).end()
    })
    server.close()

    expect(JSON.parse(body)).toEqual({ url: 'http://app:3000/x', host: 'app:3000' })
  })
})

describe('app.request()', () => {
  it('sends no Host header, so read the host from c.req.url', async () => {
    const probe = new Hono().get('/', (c) =>
      c.json({ header: c.req.header('host') ?? null, url: new URL(c.req.url).host }),
    )
    const res = await probe.request('http://docs.acme.com/')
    expect(await res.json()).toEqual({ header: null, url: 'docs.acme.com' })
  })
})
