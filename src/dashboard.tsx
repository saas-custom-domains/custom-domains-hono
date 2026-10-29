import { type Context, Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { renderer } from './layout.tsx'
import { addDomain, checkDomain, removeDomain } from './lib/domain-service.ts'
import { isReservedHost, isValidHost, normalizeHost } from './lib/hosts.ts'
import { hasValidWebhookToken } from './lib/tokens.ts'
import { publicOrigin } from './lib/proxy-headers.ts'
import { SaasDomainsError } from './lib/saas-domains.ts'
import {
  type CustomDomain,
  deleteDomain,
  findDomain,
  findDomainByProviderUuid,
  listTenants,
  setHttpsReady,
  setStatus,
} from './lib/tenants.ts'

// Everything on your own hostnames (APP_HOSTS). This example has no
// login; in your app, check that the signed-in user owns the tenant
// and the domain in every handler below.
export const dashboard = new Hono()

// Webhooks: https://docs.saascustomdomains.com/webhooks
// Registered before csrf(): they come from a server, not a browser.
dashboard.post('/webhooks/saascustomdomains', async (c) => {
  if (!(await hasValidWebhookToken(c.req.query('token')))) {
    return c.text('Unauthorized', 401)
  }

  const { event, domain: payload } = await c.req.json<{
    event: string
    domain?: { uuid?: string }
  }>()
  const domain = payload?.uuid
    ? findDomainByProviderUuid(payload.uuid)
    : null
  // Not ours, or already removed: acknowledge it anyway.
  if (!domain) return c.body(null, 204)

  switch (event) {
    case 'domain_dns_proxy_record_valid':
      setStatus(domain.id, 'active')
      break
    case 'domain_dns_proxy_record_invalid':
      setStatus(domain.id, 'pending')
      break
    case 'tls_certificate_issued':
      setHttpsReady(domain.id)
      break
    case 'domain_deleted':
      deleteDomain(domain.id)
      break
  }
  return c.body(null, 204)
})

// Behind a load balancer that terminates TLS, c.req.url starts with
// http:// while the browser's Origin starts with https://.
dashboard.use(
  csrf({
    origin: (origin, c) =>
      origin === publicOrigin(c, new URL(c.req.url).host),
  }),
)
dashboard.use(renderer)

type FormError = { tenantId: number; message: string }

function render(c: Context, error?: FormError) {
  return c.render(<Dashboard error={error} />, { title: 'Refdocs dashboard' })
}

dashboard.get('/', (c) => render(c))

dashboard.post('/domains', async (c) => {
  const body = await c.req.parseBody()
  const tenantId = Number(body.tenantId)
  const host = normalizeHost(String(body.host ?? ''))
  const dnsContact = String(body.dnsContact ?? '').trim() || undefined
  const fail = (message: string) => {
    c.status(422)
    return render(c, { tenantId, message })
  }

  if (!isValidHost(host)) return fail(`"${host}" isn't a valid domain.`)
  if (isReservedHost(host)) return fail("That's one of our domains.")

  try {
    await addDomain(tenantId, host, dnsContact)
  } catch (e) {
    if (String(e).includes('UNIQUE') ||
      (e instanceof SaasDomainsError && e.code === 'host_taken')) {
      return fail(`${host} is already connected to a docs site.`)
    }
    console.error(e)
    return fail('Could not add the domain. Try again.')
  }
  return c.redirect('/', 303)
})

dashboard.post('/domains/:id/check', async (c) => {
  const domain = findDomain(Number(c.req.param('id')))
  if (domain) await checkDomain(domain)
  return c.redirect('/', 303)
})

dashboard.post('/domains/:id/remove', async (c) => {
  const domain = findDomain(Number(c.req.param('id')))
  if (domain) await removeDomain(domain)
  return c.redirect('/', 303)
})

function Dashboard({ error }: { error?: FormError }) {
  return (
    <main>
      <h1>Refdocs dashboard</h1>
      <p>Connect a custom domain to each docs site.</p>
      {listTenants().map((tenant) => (
        <section data-testid={`tenant-${tenant.slug}`}>
          <h2>{tenant.name}</h2>
          <ul>
            {tenant.domains.map((d) => (
              <li data-testid={`domain-${d.host}`}>
                <code>{d.host}</code> <StatusBadge domain={d} />
                <form method="post" action={`/domains/${d.id}/check`}>
                  <button>Check DNS</button>
                </form>
                <form method="post" action={`/domains/${d.id}/remove`}>
                  <button>Remove</button>
                </form>
              </li>
            ))}
          </ul>
          <form method="post" action="/domains">
            <input type="hidden" name="tenantId" value={String(tenant.id)} />
            <label>
              Domain <input name="host" placeholder="docs.example.com" required />
            </label>
            <label>
              DNS contact email (optional) <input type="email" name="dnsContact" />
            </label>
            {error?.tenantId === tenant.id && <p role="alert">{error.message}</p>}
            <button>Add domain</button>
          </form>
        </section>
      ))}
    </main>
  )
}

function StatusBadge({ domain }: { domain: CustomDomain }) {
  if (domain.status !== 'active') return <span class="badge">Waiting for DNS</span>
  return domain.https_ready
    ? <span class="badge ok">Live</span>
    : <span class="badge ok">DNS OK, waiting for HTTPS</span>
}
