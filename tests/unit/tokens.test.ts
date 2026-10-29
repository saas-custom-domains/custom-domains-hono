import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasValidProxyToken, hasValidWebhookToken } from '../../src/lib/tokens.ts'

afterEach(() => vi.unstubAllEnvs())

describe('hasValidProxyToken', () => {
  it('accepts only the exact token', async () => {
    expect(await hasValidProxyToken('test_proxy_token')).toBe(true)
    expect(await hasValidProxyToken('test_proxy_toke')).toBe(false)
    expect(await hasValidProxyToken('test_proxy_tokenX')).toBe(false)
    expect(await hasValidProxyToken(undefined)).toBe(false)
  })

  it('rejects everything when PROXY_AUTH_TOKEN is unset', async () => {
    vi.stubEnv('PROXY_AUTH_TOKEN', '')
    expect(await hasValidProxyToken('')).toBe(false)
    expect(await hasValidProxyToken('undefined')).toBe(false)
  })
})

describe('hasValidWebhookToken', () => {
  it('accepts only the exact token', async () => {
    expect(await hasValidWebhookToken('test_webhook_token')).toBe(true)
    expect(await hasValidWebhookToken('test_proxy_token')).toBe(false)
  })
})
