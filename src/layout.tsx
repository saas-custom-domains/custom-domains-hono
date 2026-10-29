import type { Child } from 'hono/jsx'
import { jsxRenderer } from 'hono/jsx-renderer'

declare module 'hono' {
  interface ContextRenderer {
    (
      content: string | Promise<string>,
      props: { title: string; canonical?: string },
    ): Response | Promise<Response>
  }
}

const css = `
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 44rem; margin: 3rem auto; padding: 0 1.5rem; color: #18181b; }
  nav a { margin-right: 1rem; }
  pre { background: #f4f4f5; padding: 1rem; overflow-x: auto; border-radius: .5rem; }
  section { border: 1px solid #e4e4e7; border-radius: .75rem; padding: 1.25rem; margin: 1.5rem 0; }
  li form { display: inline; margin-left: .5rem; }
  .badge { padding: .1rem .5rem; border-radius: .25rem; background: #fef3c7; }
  .badge.ok { background: #dcfce7; }
  [role=alert] { color: #b91c1c; }
  [role=status] { color: #15803d; }
  label { display: block; margin: .5rem 0; }
`

export const renderer = jsxRenderer(
  ({ children, title, canonical }: { children?: Child; title: string; canonical?: string }) => (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {canonical && <link rel="canonical" href={canonical} />}
        <style>{css}</style>
      </head>
      <body>{children}</body>
    </html>
  ),
)
