import { promises as fs } from 'node:fs'
import path from 'node:path'
import { escapeHtml, htmlPage } from './template.js'
import type { RunMeta } from './types.js'

interface RunEntry {
  dirName: string
  meta: RunMeta
}

async function readRunMeta(runsRootDir: string, dirName: string): Promise<RunMeta | null> {
  try {
    const raw = await fs.readFile(path.join(runsRootDir, dirName, 'meta.json'), 'utf-8')
    return JSON.parse(raw) as RunMeta
  } catch {
    return null
  }
}

async function discoverRuns(runsRootDir: string): Promise<RunEntry[]> {
  let entries: string[]
  try {
    entries = (await fs.readdir(runsRootDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
  const runs: RunEntry[] = []
  for (const dirName of entries.sort()) {
    const meta = await readRunMeta(runsRootDir, dirName)
    if (meta) runs.push({ dirName, meta })
  }
  return runs.sort((a, b) => b.meta.renderedAt.localeCompare(a.meta.renderedAt))
}

function renderRunRow(run: RunEntry): string {
  const target = run.meta.targetUrl ? escapeHtml(run.meta.targetUrl) : '(unknown target)'
  const pageCount = run.meta.pageCount !== null ? String(run.meta.pageCount) : '—'
  return `<tr>
<td><a href="${escapeHtml(run.dirName)}/index.html">${target}</a></td>
<td>${escapeHtml(run.meta.mode)}</td>
<td>${escapeHtml(run.meta.renderedAt)}</td>
<td>${pageCount}</td>
</tr>`
}

function renderRunsIndexHtml(runs: RunEntry[]): string {
  const body =
    runs.length === 0
      ? '<h1>treeline runs</h1><p>No runs found.</p>'
      : `
<h1>treeline runs</h1>
<table>
<thead><tr><th>Target</th><th>Mode</th><th>Rendered</th><th>Pages</th></tr></thead>
<tbody>
${runs.map(renderRunRow).join('\n')}
</tbody>
</table>
`
  return htmlPage('treeline runs', body, null)
}

export async function buildRunsIndex(runsRootDir: string): Promise<void> {
  const runs = await discoverRuns(runsRootDir)
  await fs.writeFile(path.join(runsRootDir, 'index.html'), renderRunsIndexHtml(runs))
}
