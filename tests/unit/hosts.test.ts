import { describe, expect, it } from 'vitest'
import { isAppHost, isReservedHost, isValidHost, normalizeHost } from '../../src/lib/hosts.ts'

describe('normalizeHost', () => {
  it('lowercases and strips the port and trailing dot', () => {
    expect(normalizeHost(' Docs.Acme.com.:443 ')).toBe('docs.acme.com')
    expect(normalizeHost('app:3000')).toBe('app')
  })
})

describe('isValidHost', () => {
  it.each(['docs.acme.com', 'acme.co.uk', 'xn--bcher-kva.example'])(
    'accepts %s',
    (host) => expect(isValidHost(host)).toBe(true),
  )
  it.each(['acme', '-acme.com', 'acme..com', 'ac me.com', 'https://a.com', ''])(
    'rejects %s',
    (host) => expect(isValidHost(host)).toBe(false),
  )
})

describe('isReservedHost', () => {
  it('blocks our own domain, its subdomains and APP_HOSTS', () => {
    expect(isReservedHost('refdocs.dev')).toBe(true)
    expect(isReservedHost('admin.refdocs.dev')).toBe(true)
    expect(isReservedHost('localhost')).toBe(true)
    expect(isReservedHost('notrefdocs.dev')).toBe(false)
  })
})

describe('isAppHost', () => {
  it('matches APP_HOSTS exactly', () => {
    expect(isAppHost('app')).toBe(true)
    expect(isAppHost('acme.localhost')).toBe(false)
  })
})
