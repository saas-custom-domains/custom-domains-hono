import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../src/app.ts'
import { db } from '../../src/lib/db.ts'
import { findDomain } from '../../src/lib/tenants.ts'

// What the SaaS Custom Domains proxy sends: the request goes to the
// upstream's own hostname (http://app:3000 here) and the customer's
// domain is in X-Served-For.
const APP = 'http://app:3000'
const viaProxy = (domain: string, token = 'test_proxy_token') => ({
  'x-forwarded-host': 'app:3000',
  'x-forwarded-proto': 'https',
  'x-served-for': domain,
  'x-saas-domains-auth-token': token,
})

beforeEach(() => {
  db().exec(`
    DELETE FROM custom_domains;
    DELETE FROM key_requests;
    INSERT INTO custom_domains (id, tenant_id, host, status, provider_uuid) VALUES
      (1, 1, 'docs.acme.com', 'active', 'dom_acme'),
      (2, 2, 'docs.globex.com', 'pending', 'dom_globex');
  `)
})

describe('host routing', () => {
  it('serves the dashboard on the app host', async () => {
    const res = await app.request('http://localhost:3000/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Refdocs dashboard')
  })

  it('serves an active custom domain by Host (your own proxy)', async () => {
    const res = await app.request('http://docs.acme.com/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Acme Payments API')
  })

  it('serves an active custom domain from X-Served-For with the token', async () => {
    const res = await app.request(`${APP}/docs/authentication`, {
      headers: viaProxy('docs.acme.com'),
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Bearer sk_test_')
  })

  it('returns 404 for pending and unknown domains', async () => {
    expect((await app.request('http://docs.globex.com/')).status).toBe(404)
    expect((await app.request('http://evil.example/')).status).toBe(404)
    const viaProxyUnknown = await app.request(`${APP}/`, { headers: viaProxy('evil.example') })
    expect(viaProxyUnknown.status).toBe(404)
  })

  it('keeps docs pages off the app host', async () => {
    const res = await app.request('http://localhost:3000/docs/authentication')
    expect(res.status).toBe(404)
  })

  it('keeps the dashboard off customer domains', async () => {
    const res = await app.request('http://docs.acme.com/domains', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin' },
      body: new URLSearchParams({ tenantId: '1', host: 'x.example.com' }),
    })
    expect(res.status).toBe(404)
  })

  it('answers the health check on any host', async () => {
    const res = await app.request('http://10.0.0.12:3000/up')
    expect(res.status).toBe(200)
  })
})

describe('proxy token', () => {
  it('rejects X-Served-For without the token', async () => {
    const { 'x-saas-domains-auth-token': _, ...spoofed } = viaProxy('docs.acme.com')
    expect((await app.request(`${APP}/`, { headers: spoofed })).status).toBe(403)
  })

  it('rejects X-Served-For with the wrong token', async () => {
    const res = await app.request(`${APP}/`, { headers: viaProxy('docs.acme.com', 'guess') })
    expect(res.status).toBe(403)
  })

  it('rejects X-Served-For on the app host too', async () => {
    const res = await app.request('http://localhost:3000/', {
      headers: { 'x-served-for': 'docs.acme.com' },
    })
    expect(res.status).toBe(403)
  })
})

describe('request an API key', () => {
  const form = new URLSearchParams({ email: 'dev@example.com', use_case: 'Checkout' })

  it('takes the tenant from the domain and redirects on the same domain', async () => {
    const res = await app.request(`${APP}/get-a-key`, {
      method: 'POST',
      headers: { ...viaProxy('docs.acme.com'), origin: 'https://docs.acme.com' },
      body: form,
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/get-a-key?sent')
    const row = db().prepare('SELECT tenant_id FROM key_requests').get()
    expect(row).toEqual({ tenant_id: 1 })
  })

  it('rejects a POST from another site', async () => {
    const res = await app.request(`${APP}/get-a-key`, {
      method: 'POST',
      headers: { ...viaProxy('docs.acme.com'), origin: 'https://evil.example' },
      body: form,
    })
    expect(res.status).toBe(403)
  })
})

// Stands in for the SaaS Custom Domains API.
function mockApi(status: number, body: object) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('dashboard', () => {
  const post = (path: string, body: Record<string, string>) =>
    app.request(`http://localhost${path}`, {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: new URLSearchParams(body),
    })

  it('rejects our own domains', async () => {
    const res = await post('/domains', { tenantId: '1', host: 'admin.refdocs.dev' })
    expect(res.status).toBe(422)
    expect(await res.text()).toContain("That&#39;s one of our domains.")
  })

  it('rejects a domain that is already connected', async () => {
    const res = await post('/domains', { tenantId: '2', host: 'Docs.Acme.com' })
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('docs.acme.com is already connected')
  })

  it('adds a normalized domain as pending and registers it with the API', async () => {
    const fetch = mockApi(201, { uuid: 'dom_new', host: 'api.globex.com' })
    const res = await post('/domains', {
      tenantId: '2',
      host: ' API.Globex.com. ',
      dnsContact: 'it@globex.example',
    })
    expect(res.status).toBe(303)
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe(
      'http://scd.test/api/v1/accounts/acc_test/upstreams/up_test/custom_domains',
    )
    expect(JSON.parse(String(init?.body))).toEqual({
      host: 'api.globex.com',
      instructions_recipient: 'it@globex.example',
    })
    const row = db().prepare("SELECT status, provider_uuid FROM custom_domains WHERE host = 'api.globex.com'").get()
    expect(row).toEqual({ status: 'pending', provider_uuid: 'dom_new' })
  })

  it("doesn't keep the row when the API refuses the domain", async () => {
    mockApi(400, { error: 'Host has already been taken', error_code: 'host_taken' })
    const res = await post('/domains', { tenantId: '2', host: 'taken.example.com' })
    expect(res.status).toBe(422)
    expect(await res.text()).toContain('taken.example.com is already connected')
    const row = db().prepare("SELECT 1 FROM custom_domains WHERE host = 'taken.example.com'").get()
    expect(row).toBeUndefined()
  })

  it('takes the status from verify_dns_records', async () => {
    mockApi(200, { dns_status: 'valid', host: 'docs.globex.com' })
    expect((await post('/domains/2/check', {})).status).toBe(303)
    expect(findDomain(2)?.status).toBe('active')
  })

  it('removes a domain the API has already forgotten (404)', async () => {
    mockApi(404, { error: 'Custom domain dom_acme not found.', error_code: 'not_found' })
    expect((await post('/domains/1/remove', {})).status).toBe(303)
    expect(findDomain(1)).toBeNull()
  })

  it('keeps the domain when the API fails to remove it', async () => {
    mockApi(500, {})
    expect((await post('/domains/1/remove', {})).status).toBe(500)
    expect(findDomain(1)).not.toBeNull()
  })
})

describe('webhooks', () => {
  const send = (event: string, uuid: string, token = 'test_webhook_token') =>
    app.request(`http://app:3000/webhooks/saascustomdomains?token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, domain: { uuid, host: 'x' } }),
    })

  it('needs the right token', async () => {
    expect((await send('domain_dns_proxy_record_valid', 'dom_globex', 'nope')).status).toBe(401)
    expect(findDomain(2)?.status).toBe('pending')
  })

  it('updates the status and HTTPS flag', async () => {
    expect((await send('domain_dns_proxy_record_valid', 'dom_globex')).status).toBe(204)
    expect((await send('tls_certificate_issued', 'dom_globex')).status).toBe(204)
    expect(findDomain(2)).toMatchObject({ status: 'active', https_ready: 1 })
    await send('domain_dns_proxy_record_invalid', 'dom_globex')
    expect(findDomain(2)?.status).toBe('pending')
  })

  it('removes the domain on domain_deleted and ignores unknown ones', async () => {
    expect((await send('domain_deleted', 'dom_acme')).status).toBe(204)
    expect(findDomain(1)).toBeNull()
    expect((await send('domain_deleted', 'dom_unknown')).status).toBe(204)
  })
})
