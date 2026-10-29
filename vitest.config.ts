import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    env: {
      APP_HOSTS: 'localhost,app',
      APP_DOMAIN: 'refdocs.dev',
      PROXY_AUTH_TOKEN: 'test_proxy_token',
      SCD_WEBHOOK_TOKEN: 'test_webhook_token',
      DATABASE_PATH: ':memory:',
      SCD_API_URL: 'http://scd.test',
      SCD_ACCOUNT_UUID: 'acc_test',
      SCD_UPSTREAM_UUID: 'up_test',
      SCD_API_TOKEN: 'api_token',
    },
  },
})
