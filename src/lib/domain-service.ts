import * as saasDomains from './saas-domains.ts'
import {
  type CustomDomain,
  deleteDomain,
  insertDomain,
  setProviderUuid,
  setStatus,
} from './tenants.ts'

// The unique index on host means two tenants can't race for one
// domain: the second insert fails before we call the API.
export async function addDomain(
  tenantId: number,
  host: string,
  dnsContact?: string,
): Promise<CustomDomain> {
  const domain = insertDomain(tenantId, host)
  try {
    const res = await saasDomains.createDomain(host, dnsContact)
    setProviderUuid(domain.id, res.uuid)
    return { ...domain, provider_uuid: res.uuid }
  } catch (e) {
    // Don't keep a row the proxy doesn't know about.
    deleteDomain(domain.id)
    throw e
  }
}

// Webhooks keep the status current; this is the "Check DNS" button.
export async function checkDomain(domain: CustomDomain): Promise<boolean> {
  if (!domain.provider_uuid) return false
  const res = await saasDomains.verifyDns(domain.provider_uuid)
  const valid = res.dns_status === 'valid'
  setStatus(domain.id, valid ? 'active' : 'pending')
  return valid
}

export async function removeDomain(domain: CustomDomain) {
  // Proxy first, database second: if the API call fails, the row is
  // still here and the user can retry.
  if (domain.provider_uuid) {
    await saasDomains.deleteDomain(domain.provider_uuid)
  }
  deleteDomain(domain.id)
}
