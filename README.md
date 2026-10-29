# Custom domains in Hono

An example Hono app where each customer connects their own domain. It's a small API docs product, Refdocs: every API company gets a docs site, and can serve it on `docs.theircompany.com` instead of a Refdocs URL. Pages are rendered on the server with `hono/jsx`.

It goes with the guide [How to Add Custom Domains to a Multi-Tenant Hono App](https://saascustomdomains.com/blog/posts/custom-domains-hono).

What's in it:

- One middleware, `resolveTenant`, finds the tenant from the request's hostname and puts it in `c.var.tenant` (typed `Variables`). Unknown and unverified domains get a 404.
- Requests from the [SaaS Custom Domains](https://saascustomdomains.com) proxy are accepted only with the upstream's auth token, so nobody can claim a customer's domain by sending `X-Served-For` themselves.
- A "Request an API key" form on every docs site, protected by `hono/csrf`, that works on customer domains (see [hono/csrf behind a proxy](#honocsrf-behind-a-proxy)).
- Canonical links and redirects that stay on the customer's domain.
- A dashboard to add a domain, check its DNS and remove it. Webhooks update the status.
- [SaaS Custom Domains](https://saascustomdomains.com) issues and renews every customer's TLS certificate and proxies their traffic to the app.

## Run it in 2 minutes

You need Docker.

```bash
git clone https://github.com/saas-custom-domains/custom-domains-hono
cd custom-domains-hono
docker compose up --build
```

1. Open http://localhost:3000 and add `acme.localhost` to Acme Payments.
2. Within a few seconds the status changes to **Live**: the mock API "found" the DNS records and sent a webhook.
3. Open http://acme.localhost. The request goes through the mock proxy on port 80, exactly like a real customer domain goes through SaaS Custom Domains, and you see Acme's API docs. Try the "Request an API key" form.

`*.localhost` always resolves to your own machine in Chrome, Firefox, Safari and curl, so there's nothing to add to `/etc/hosts`.

The mock is [scd-mock](https://github.com/saas-custom-domains/scd-mock): a local copy of the SaaS Custom Domains API and proxy, so you can try everything without an account.

### Run the app outside Docker

Keep the mock in Docker and point it at your dev server (Node.js 22.13 or newer):

```bash
SCD_MOCK_UPSTREAM_HOST=host.docker.internal \
SCD_MOCK_WEBHOOK_URL=http://host.docker.internal:3000/webhooks/saascustomdomains \
  docker compose up scd-mock -d
npm install
cp .env.example .env
npm run dev
```

## How it works

```
Browser ── docs.acme.com ──▶ SaaS Custom Domains ──▶ your Hono app
                             (TLS certificate,       Host: app.refdocs.dev
                              proxy)                 X-Served-For: docs.acme.com
                                                     X-SaaS-Domains-Auth-Token: …
```

| File | What it does |
| --- | --- |
| `src/app.ts` | Sends your own hostnames to the dashboard and everything else to the docs app |
| `src/docs.tsx` | `resolveTenant` (token check, hostname, `c.set('tenant')`), CSRF, the docs pages and the API key form |
| `src/dashboard.tsx` | Dashboard and webhook endpoint |
| `src/lib/tokens.ts` | Constant-time checks for the proxy and webhook tokens |
| `src/lib/proxy-headers.ts` | `publicOrigin()`: the origin the visitor's browser is on |
| `src/lib/domain-service.ts` | Add, check and remove domains |
| `src/lib/saas-domains.ts` | API client for SaaS Custom Domains, on `fetch` |
| `src/lib/tenants.ts` | SQL queries, including the one lookup by hostname |

The app code uses Web APIs and Hono only. `src/server.ts` (`@hono/node-server`) and `src/lib/db.ts` (`node:sqlite`) are the Node-specific parts, so the same middleware runs on Bun, Deno or Cloudflare Workers behind SaaS Custom Domains; swap the database.

## Hono behind a proxy

SaaS Custom Domains forwards your app's own hostname in `Host` and `X-Forwarded-Host`, because that's what hosting platforms route on and what most apps expect for allowed hosts, OAuth callbacks and links. The customer's domain arrives separately in `X-Served-For`. If your app needs the customer's domain for something, give it that domain once the auth token checks out. In this app that's three things.

### hono/csrf behind a proxy

`hono/csrf` accepts a form POST if `Sec-Fetch-Site` is `same-origin`, or else if `Origin` equals the origin of `c.req.url`. Behind the proxy, `c.req.url` is `http://app.refdocs.dev/...`, so a browser that sends no `Sec-Fetch-Site` gets a plain-text **403 `Forbidden`** on every form on a customer domain. Browsers only send `Sec-Fetch-Site` to secure origins, so you see this on plain HTTP (local development, the mock) and with browsers older than 2023. Over HTTPS, current browsers pass on `Sec-Fetch-Site` alone, which makes the bug easy to miss.

The fix is the `origin` option as a function, comparing with the customer's domain:

```ts
docs.use(csrf({ origin: (origin, c) => origin === c.get('origin') }))
```

`c.var.origin` is set by `resolveTenant` after the token check. `tests/unit/hono-gotchas.test.ts` shows the default rejecting the request and this app accepting it; the end-to-end test submits the form through the mock proxy.

### c.req.url has your own host, and http://

`@hono/node-server` builds `c.req.url` from the `Host` header and the socket. It ignores `X-Forwarded-Host` and `X-Forwarded-Proto`, so behind any proxy that terminates TLS the URL is `http://<your own host>/...`. Anything built from it points visitors at the wrong place: `new URL('/thanks', c.req.url)`, canonical links, links in emails. This app:

- redirects with relative paths (`c.redirect('/get-a-key?sent', 303)`), which browsers resolve against the customer's domain;
- builds absolute URLs from `publicOrigin()`, which takes the scheme from `X-Forwarded-Proto` and the host from `X-Served-For`.

Production always sends `X-Forwarded-Proto: https`. The mock speaks plain HTTP, so `compose.yaml` sets `SCD_MOCK_FORWARDED_PROTO=http` to match what the browser sees.

### Read the host from c.req.url, not c.req.header('host')

On Node both come from the `Host` header. A `Request` built in code, such as `app.request('http://docs.acme.com/')` in tests, has no `Host` header at all, so `c.req.header('host')` is `undefined`. This app reads `new URL(c.req.url).host`, which works on every runtime and in tests.

## Use it with your SaaS Custom Domains account

1. [Create an API token](https://app.saascustomdomains.com/api_tokens) and an upstream pointing at your deployed app.
2. Set the environment variables from `.env.example`: `SCD_API_TOKEN`, `SCD_ACCOUNT_UUID`, `SCD_UPSTREAM_UUID`, `PROXY_AUTH_TOKEN` (the upstream's auth token), `SCD_WEBHOOK_TOKEN` (from the webhook you create in the dashboard, pointed at `/webhooks/saascustomdomains`), and `APP_HOSTS`.
3. Remove `SCD_API_URL` so the client talks to the real API.

`APP_HOSTS` must list every hostname your own traffic arrives on: your app's domain, plus any internal name your platform uses to reach the app. `src/app.ts` treats any other host as a customer domain and returns 404 if it isn't connected. (In `compose.yaml` that's why `app` is listed: webhooks from the mock arrive as `Host: app:3000`.) The health check at `/up` comes before that, because load balancers call it by IP address.

Your customers point a CNAME at `in.saascustomdomains.com` (or A records at our two static IPs for a root domain). See the [docs](https://docs.saascustomdomains.com). If you'd rather receive the customer's domain in `X-Forwarded-Host`, support can switch that on for your upstream.

## Tests

```bash
npm test                       # unit tests (app.request(), tokens, hostnames, Hono behaviour)
docker compose up -d --build --wait
npx playwright install chromium
npm run test:e2e               # end to end, through the mock proxy
```

The end-to-end tests use `*.test` domains and send the browser's requests for them to the mock proxy, so nothing depends on DNS or on port 80. To run a second stack side by side, set `APP_PORT`, `SCD_MOCK_API_PORT` and `SCD_MOCK_PROXY_PORT` for both `docker compose` and `npm run test:e2e`.

CI runs both on every push and once a week, so a new Hono release that breaks something shows up here first.

## Tested with

| | Version |
| --- | --- |
| Hono | 4.13.14 |
| @hono/node-server | 2.1.5 |
| Node.js | 24 |
| TypeScript | 7.0 |

Last checked: 2026-10-28.

## Not production-ready on purpose

There's no login. In your app, check in every dashboard handler that the signed-in user owns the tenant and the domain. SQLite (`node:sqlite`) keeps the example small; use your own database.

## License

MIT
