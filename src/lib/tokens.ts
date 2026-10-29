import { timingSafeEqual } from 'hono/utils/buffer'

// Constant time, so a wrong guess doesn't reveal how much was right.
// An unset secret never matches, not even an empty header.
async function matches(given: string | undefined, secret: string | undefined) {
  if (!secret || given === undefined) return false
  return timingSafeEqual(given, secret)
}

// SaaS Custom Domains sends your upstream's auth token with every
// request it forwards. Only a request carrying it may tell you, in
// X-Served-For, which customer domain it was made on.
export function hasValidProxyToken(token: string | undefined) {
  return matches(token, process.env.PROXY_AUTH_TOKEN)
}

// The token SaaS Custom Domains adds to your webhook URL (?token=...).
export function hasValidWebhookToken(token: string | undefined) {
  return matches(token, process.env.SCD_WEBHOOK_TOKEN)
}
