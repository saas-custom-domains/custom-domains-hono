import { db } from './db.ts'

export type Tenant = {
  id: number
  slug: string
  name: string
  tagline: string
  api_base_url: string
}
export type Page = {
  slug: string
  title: string
  body: string
  example: string | null
}
export type CustomDomain = {
  id: number
  tenant_id: number
  host: string
  status: 'pending' | 'active'
  https_ready: number
  provider_uuid: string | null
}

// The lookup every request on a customer domain depends on. The
// UNIQUE index on custom_domains.host keeps it fast and unambiguous.
export function findTenantByActiveHost(host: string): Tenant | null {
  return (db()
    .prepare(
      `SELECT tenants.* FROM tenants
       JOIN custom_domains ON custom_domains.tenant_id = tenants.id
       WHERE custom_domains.host = ? AND custom_domains.status = 'active'`,
    )
    .get(host) ?? null) as Tenant | null
}

export function isActiveHost(host: string): boolean {
  return findTenantByActiveHost(host) !== null
}

export function listPages(tenantId: number): Page[] {
  return db()
    .prepare(
      `SELECT slug, title, body, example FROM pages
       WHERE tenant_id = ? ORDER BY position`,
    )
    .all(tenantId) as Page[]
}

export function findPage(tenantId: number, slug: string): Page | null {
  return (db()
    .prepare(
      `SELECT slug, title, body, example FROM pages
       WHERE tenant_id = ? AND slug = ?`,
    )
    .get(tenantId, slug) ?? null) as Page | null
}

export function listTenants(): (Tenant & { domains: CustomDomain[] })[] {
  const tenants = db().prepare('SELECT * FROM tenants ORDER BY id').all() as
    Tenant[]
  const domains = db()
    .prepare('SELECT * FROM custom_domains ORDER BY id')
    .all() as CustomDomain[]
  return tenants.map((t) => ({
    ...t,
    domains: domains.filter((d) => d.tenant_id === t.id),
  }))
}

export function findDomain(id: number): CustomDomain | null {
  return (db().prepare('SELECT * FROM custom_domains WHERE id = ?').get(id) ??
    null) as CustomDomain | null
}

export function findDomainByProviderUuid(uuid: string): CustomDomain | null {
  return (db()
    .prepare('SELECT * FROM custom_domains WHERE provider_uuid = ?')
    .get(uuid) ?? null) as CustomDomain | null
}

export function insertDomain(tenantId: number, host: string): CustomDomain {
  return db()
    .prepare(
      'INSERT INTO custom_domains (tenant_id, host) VALUES (?, ?) RETURNING *',
    )
    .get(tenantId, host) as CustomDomain
}

export function setStatus(id: number, status: CustomDomain['status']) {
  db().prepare('UPDATE custom_domains SET status = ? WHERE id = ?')
    .run(status, id)
}

export function setHttpsReady(id: number) {
  db().prepare('UPDATE custom_domains SET https_ready = 1 WHERE id = ?').run(id)
}

export function setProviderUuid(id: number, uuid: string) {
  db().prepare('UPDATE custom_domains SET provider_uuid = ? WHERE id = ?')
    .run(uuid, id)
}

export function deleteDomain(id: number) {
  db().prepare('DELETE FROM custom_domains WHERE id = ?').run(id)
}

export function addKeyRequest(tenantId: number, email: string, useCase: string) {
  db().prepare(
    'INSERT INTO key_requests (tenant_id, email, use_case) VALUES (?, ?, ?)',
  ).run(tenantId, email, useCase)
}

export function countKeyRequests(tenantId: number): number {
  const row = db()
    .prepare('SELECT COUNT(*) AS n FROM key_requests WHERE tenant_id = ?')
    .get(tenantId) as { n: number }
  return row.n
}
