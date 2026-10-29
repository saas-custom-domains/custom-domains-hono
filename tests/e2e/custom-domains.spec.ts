import { expect, test } from '@playwright/test'

// Customer domains go through the mock proxy (see playwright.config.ts).
// Use page.goto for them: page.request tunnels plain HTTP through the
// proxy with CONNECT, which the mock doesn't support.
const customerUrl = (host: string, path = '/') => `http://${host}${path}`

test('connect a domain, serve the docs through the proxy, remove it', async ({
  page,
}) => {
  const host = `docs-${Date.now()}.acme.test`
  const tenant = page.getByTestId('tenant-acme')

  await page.goto('/')
  await tenant.getByLabel('Domain').fill(host)
  await tenant.getByRole('button', { name: 'Add domain' }).click()
  const row = page.getByTestId(`domain-${host}`)
  await expect(row).toBeVisible()

  // The mock marks *.test as pointed after ~2s and sends webhooks.
  await expect(async () => {
    await page.reload()
    await expect(row).toContainText('Live')
  }).toPass({ timeout: 15_000 })

  await page.goto(customerUrl(host))
  await expect(page.getByRole('heading', { name: 'Acme Payments API' })).toBeVisible()
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    `http://${host}/`,
  )

  await page.getByRole('link', { name: 'Authentication' }).click()
  await expect(page).toHaveURL(customerUrl(host, '/docs/authentication'))
  await expect(page.getByRole('heading', { name: 'Authentication' })).toBeVisible()

  // The customer-facing form, through the proxy. Chromium sends no
  // Sec-Fetch-Site on plain-HTTP *.test, so hono/csrf checks Origin.
  await page.goto(customerUrl(host, '/get-a-key'))
  await page.getByLabel('Email').fill('dev@example.com')
  await page.getByLabel('What will you build?').fill('A checkout page')
  await page.getByRole('button', { name: 'Request key' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Thanks. Acme Payments will email your key.',
  )
  // The redirect kept the visitor on the customer's domain.
  await expect(page).toHaveURL(customerUrl(host, '/get-a-key?sent'))

  await page.goto('/')
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(row).toBeHidden()
  const gone = await page.goto(customerUrl(host))
  expect(gone?.status()).toBe(404)
})

test('a domain that does not point at us stays pending', async ({ page }) => {
  const host = `docs-${Date.now()}.example.com`
  const tenant = page.getByTestId('tenant-globex')

  await page.goto('/')
  await tenant.getByLabel('Domain').fill(host)
  await tenant.getByLabel('DNS contact email (optional)').fill('it@globex.example')
  await tenant.getByRole('button', { name: 'Add domain' }).click()
  const row = page.getByTestId(`domain-${host}`)
  await row.getByRole('button', { name: 'Check DNS' }).click()
  await expect(row).toContainText('Waiting for DNS')

  // Pending domains don't reach the app.
  const res = await page.goto(customerUrl(host))
  expect(res?.status()).not.toBe(200)

  await page.goto('/')
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(row).toBeHidden()
})

test('rejects our own domains', async ({ page }) => {
  const tenant = page.getByTestId('tenant-acme')
  await page.goto('/')
  await tenant.getByLabel('Domain').fill('admin.refdocs.dev')
  await tenant.getByRole('button', { name: 'Add domain' }).click()
  await expect(tenant.getByRole('alert')).toHaveText("That's one of our domains.")
})

test('docs pages are not reachable on the app host', async ({ request }) => {
  const res = await request.get('/docs/authentication')
  expect(res.status()).toBe(404)
})

test('requests that skip the proxy cannot claim a domain', async ({
  request,
}) => {
  const spoofed = await request.get('/', {
    headers: { 'X-Served-For': 'acme.test' },
  })
  expect(spoofed.status()).toBe(403)

  const wrongToken = await request.get('/', {
    headers: {
      'X-Served-For': 'acme.test',
      'X-SaaS-Domains-Auth-Token': 'guess',
    },
  })
  expect(wrongToken.status()).toBe(403)
})

test('webhooks need the right token', async ({ request }) => {
  const res = await request.post('/webhooks/saascustomdomains?token=x', {
    data: { event: 'domain_dns_proxy_record_valid', domain: { uuid: 'x' } },
  })
  expect(res.status()).toBe(401)
})

test('unknown domains get a 404', async ({ page }) => {
  const res = await page.goto(customerUrl('unknown.test'))
  expect(res?.status()).toBe(404)
})
