const BASE_STYLE = `
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 0; background: #f4f6f9; color: #1a2744; }
  header { background: #1a2744; color: white; padding: 16px 24px; }
  header a { color: #aac4ff; text-decoration: none; }
  header a:hover { text-decoration: underline; }
  main { max-width: 960px; margin: 0 auto; padding: 24px; background: white; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 14px; overflow-wrap: anywhere; word-break: break-word; }
  th { background: #eef1f6; }
  img { max-width: 100%; }
  pre { overflow-x: auto; padding: 16px; border-radius: 6px; }
  code { font-family: 'SF Mono', Consolas, Menlo, monospace; }
  h1, h2, h3 { color: #1a2744; }
  a { color: #1a5fd6; }
`

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function htmlPage(title: string, bodyHtml: string, backHref: string | null): string {
  const header = backHref
    ? `<header><a href="${backHref}">&larr; treeline run</a></header>`
    : `<header>treeline run</header>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${BASE_STYLE}</style>
</head>
<body>
${header}
<main>
${bodyHtml}
</main>
</body>
</html>
`
}
