// A small client for the SaaS Custom Domains API, on plain fetch so it
// runs on Node, Bun, Deno and Workers.
// Docs: https://docs.saascustomdomains.com/custom-domains
const API_URL = process.env.SCD_API_URL ?? 'https://app.saascustomdomains.com'

type DomainResponse = { uuid: string; host: string; status: string }
type VerifyResponse = { dns_status: 'valid' | 'pending' | 'invalid' }

export class SaasDomainsError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`SaaS Custom Domains API ${status}: ${body}`)
  }

  // Validation errors come back as 400 {"error", "error_code"}.
  get code(): string | undefined {
    try {
      return JSON.parse(this.body).error_code
    } catch {
      return undefined
    }
  }
}

async function request<T>(method: string, path = '', body?: object): Promise<T> {
  const account = process.env.SCD_ACCOUNT_UUID
  const upstream = process.env.SCD_UPSTREAM_UUID
  const url =
    `${API_URL}/api/v1/accounts/${account}` +
    `/upstreams/${upstream}/custom_domains${path}`

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SCD_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new SaasDomainsError(res.status, await res.text())
  return (await res.json()) as T
}

export function createDomain(host: string, instructionsRecipient?: string) {
  return request<DomainResponse>('POST', '', {
    host,
    // We email this address the exact DNS records to add.
    ...(instructionsRecipient && {
      instructions_recipient: instructionsRecipient,
    }),
  })
}

export function verifyDns(uuid: string) {
  return request<VerifyResponse>('POST', `/${uuid}/verify_dns_records`)
}

export async function deleteDomain(uuid: string) {
  try {
    await request('DELETE', `/${uuid}`)
  } catch (e) {
    // Already gone is fine: the goal is that it doesn't exist.
    if (!(e instanceof SaasDomainsError && e.status === 404)) throw e
  }
}
