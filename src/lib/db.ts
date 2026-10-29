import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

let instance: DatabaseSync | undefined

// One SQLite connection per process, opened on first use. The queries
// are plain SQL, so swapping in Postgres (or D1 on Cloudflare Workers)
// only touches this file and tenants.ts.
export function db(): DatabaseSync {
  instance ??= open()
  return instance
}

function open() {
  const file = process.env.DATABASE_PATH ??
    path.join(process.env.DATA_DIR ?? 'data', 'app.db')
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file, { timeout: 5000 })
  migrate(db)
  seed(db)
  return db
}

function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      api_base_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      example TEXT,
      position INTEGER NOT NULL,
      UNIQUE (tenant_id, slug)
    );

    CREATE TABLE IF NOT EXISTS custom_domains (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      host TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active')),
      https_ready INTEGER NOT NULL DEFAULT 0,
      provider_uuid TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS key_requests (
      id INTEGER PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      use_case TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
}

type SeedPage = { slug: string; title: string; body: string; example?: string }

const SEED: {
  slug: string
  name: string
  tagline: string
  apiBaseUrl: string
  pages: SeedPage[]
}[] = [
  {
    slug: 'acme',
    name: 'Acme Payments',
    tagline: 'Accept cards and bank transfers with one API.',
    apiBaseUrl: 'https://api.acmepay.example/v1',
    pages: [
      {
        slug: 'authentication',
        title: 'Authentication',
        body: 'Send your secret key as a bearer token. Keys starting with sk_test_ only touch test data.',
        example: 'curl https://api.acmepay.example/v1/balance \\\n  -H "Authorization: Bearer sk_test_..."',
      },
      {
        slug: 'payments',
        title: 'Create a payment',
        body: 'Amounts are in the smallest currency unit, so 1999 is $19.99.',
        example: 'curl https://api.acmepay.example/v1/payments \\\n  -H "Authorization: Bearer sk_test_..." \\\n  -d amount=1999 -d currency=usd',
      },
    ],
  },
  {
    slug: 'globex',
    name: 'Globex Maps',
    tagline: 'Geocoding and routing for logistics teams.',
    apiBaseUrl: 'https://api.globexmaps.example',
    pages: [
      {
        slug: 'authentication',
        title: 'Authentication',
        body: 'Pass your key in the X-Api-Key header. Keys are scoped to one project.',
        example: 'curl https://api.globexmaps.example/geocode?q=Berlin \\\n  -H "X-Api-Key: gx_..."',
      },
      {
        slug: 'rate-limits',
        title: 'Rate limits',
        body: 'Each key gets 50 requests per second. Over the limit you get a 429 with a Retry-After header.',
      },
    ],
  },
]

function seed(db: DatabaseSync) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM tenants').get() as {
    n: number
  }
  if (n > 0) return

  const insertTenant = db.prepare(
    `INSERT INTO tenants (slug, name, tagline, api_base_url)
     VALUES (?, ?, ?, ?) RETURNING id`,
  )
  const insertPage = db.prepare(
    `INSERT INTO pages (tenant_id, slug, title, body, example, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const t of SEED) {
    const { id } = insertTenant.get(t.slug, t.name, t.tagline, t.apiBaseUrl) as {
      id: number
    }
    t.pages.forEach((p, i) =>
      insertPage.run(id, p.slug, p.title, p.body, p.example ?? null, i),
    )
  }
}
