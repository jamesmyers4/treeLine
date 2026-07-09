import path from 'node:path'
import type { RenderedPage } from './types.js'
import { escapeHtml, htmlPage } from './template.js'

function toHref(targetDir: string, outputPath: string): string {
  return path.relative(targetDir, outputPath).split(path.sep).join('/')
}

function renderList(targetDir: string, pages: RenderedPage[]): string {
  if (pages.length === 0) return '<p>None.</p>'
  const items = pages
    .map((p) => `<li><a href="${toHref(targetDir, p.outputPath)}">${escapeHtml(p.title)}</a></li>`)
    .join('\n')
  return `<ul>${items}</ul>`
}

export function renderIndexHtml(
  targetDir: string,
  reports: RenderedPage[],
  poms: RenderedPage[],
  specs: RenderedPage[]
): string {
  const body = `
<h1>treeline run</h1>
<h2>Reports</h2>
${renderList(targetDir, reports)}
<h2>Page Object Models</h2>
${renderList(targetDir, poms)}
<h2>Specs</h2>
${renderList(targetDir, specs)}
`
  return htmlPage('treeline run', body, null)
}
