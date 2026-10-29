import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { csrf } from 'hono/csrf'
import { renderer } from './layout.tsx'
import { normalizeHost } from './lib/hosts.ts'
import { publicOrigin } from './lib/proxy-headers.ts'
import { hasValidProxyToken } from './lib/tokens.ts'
import {
  type Tenant,
  addKeyRequest,
  findPage,
  findTenantByActiveHost,
  listPages,
} from './lib/tenants.ts'

export type DocsEnv = {
  Variables: {
    tenant: Tenant
    // Where the visitor is, e.g. "https://docs.acme.com".
    origin: string
  }
}

// Finds the tenant for a request on a customer's domain. This is the
// only place that reads the hostname.
export const resolveTenant = createMiddleware<DocsEnv>(
  async (c, next) => {
    // Behind SaaS Custom Domains, Host is your own hostname and the
    // customer's domain arrives in X-Served-For. Trust it only with
    // the upstream's auth token, or anyone could claim any domain.
    const servedFor = c.req.header('x-served-for')
    if (
      servedFor !== undefined &&
      !(await hasValidProxyToken(
        c.req.header('x-saas-domains-auth-token'),
      ))
    ) {
      return c.text('Forbidden', 403)
    }

    // Without X-Served-For, the request's own host is the
    // customer's domain (e.g. http://acme.localhost:3000).
    const requested = servedFor ?? new URL(c.req.url).host
    const tenant = findTenantByActiveHost(normalizeHost(requested))
    if (!tenant) return c.text('Unknown domain', 404)

    c.set('tenant', tenant)
    c.set('origin', publicOrigin(c, requested))
    await next()
  },
)

export const docs = new Hono<DocsEnv>()

docs.use(resolveTenant)

// hono/csrf accepts a form POST if Sec-Fetch-Site is "same-origin"
// or, failing that, if Origin equals the origin of c.req.url, which
// has your own hostname behind the proxy. Compare Origin with the
// customer's domain, which resolveTenant stored after checking the
// proxy token.
docs.use(
  csrf({ origin: (origin, c) => origin === c.get('origin') }),
)

docs.use(renderer)

docs.get('/', (c) => {
  const { tenant } = c.var
  const pages = listPages(tenant.id)
  return c.render(
    <main>
      <h1>{tenant.name} API</h1>
      <p>{tenant.tagline}</p>
      <p>
        Base URL: <code>{tenant.api_base_url}</code>
      </p>
      <h2>Guides</h2>
      <ul>
        {pages.map((p) => (
          <li>
            <a href={`/docs/${p.slug}`}>{p.title}</a>
          </li>
        ))}
      </ul>
      <p>
        <a href="/get-a-key">Request an API key</a>
      </p>
    </main>,
    { title: `${tenant.name} API`, canonical: `${c.var.origin}/` },
  )
})

docs.get('/docs/:slug', (c) => {
  const { tenant } = c.var
  const page = findPage(tenant.id, c.req.param('slug'))
  if (!page) return c.notFound()
  return c.render(
    <main>
      <Nav tenant={tenant} />
      <h1>{page.title}</h1>
      <p>{page.body}</p>
      {page.example && <pre><code>{page.example}</code></pre>}
    </main>,
    {
      title: `${page.title} | ${tenant.name} API`,
      canonical: `${c.var.origin}/docs/${page.slug}`,
    },
  )
})

docs.get('/get-a-key', (c) => {
  const { tenant, origin } = c.var
  const sent = c.req.query('sent') !== undefined
  return c.render(<KeyRequestPage tenant={tenant} sent={sent} />, {
    title: `Request an API key | ${tenant.name} API`,
    canonical: `${origin}/get-a-key`,
  })
})

// The customer-facing form. The tenant comes from the request's
// domain, never from the form.
docs.post('/get-a-key', async (c) => {
  const { tenant } = c.var
  const body = await c.req.parseBody()
  const email = String(body.email ?? '').trim()
  const useCase = String(body.use_case ?? '').trim()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    c.status(422)
    return c.render(
      <KeyRequestPage tenant={tenant} useCase={useCase} invalid />,
      { title: `Request an API key | ${tenant.name} API` },
    )
  }

  addKeyRequest(tenant.id, email, useCase)
  // A relative Location keeps the visitor on the customer's domain.
  // new URL('/get-a-key', c.req.url) would send them to your host.
  return c.redirect('/get-a-key?sent', 303)
})

function Nav({ tenant }: { tenant: Tenant }) {
  return (
    <nav>
      <a href="/">{tenant.name} API</a>
    </nav>
  )
}

function KeyRequestPage(props: {
  tenant: Tenant
  sent?: boolean
  invalid?: boolean
  useCase?: string
}) {
  const { tenant } = props
  return (
    <main>
      <Nav tenant={tenant} />
      <h1>Request an API key</h1>
      {props.sent ? (
        <p role="status">Thanks. {tenant.name} will email your key.</p>
      ) : (
        <>
          {props.invalid && (
            <p role="alert">Enter a valid email address.</p>
          )}
          <form method="post">
            <label>
              Email <input type="email" name="email" required />
            </label>
            <label>
              What will you build?{' '}
              <input name="use_case" value={props.useCase ?? ''} />
            </label>
            <button>Request key</button>
          </form>
        </>
      )}
    </main>
  )
}
