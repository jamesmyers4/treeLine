import { promises as fs } from 'node:fs'
import path from 'node:path'

const KNOWN_REPORT_ORDER = [
  'atlas.md',
  'selector-report.md',
  'testid-audit.md',
  'axe-report.md',
  'flow-map.md',
  'diff-report.md'
]

async function listFiles(dir: string, extension: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  return entries.filter((entry) => entry.endsWith(extension)).sort()
}

export async function discoverReports(outputDir: string): Promise<string[]> {
  const reportsDir = path.join(outputDir, 'reports')
  const found = await listFiles(reportsDir, '.md')
  return found.sort((a, b) => {
    const ai = KNOWN_REPORT_ORDER.indexOf(a)
    const bi = KNOWN_REPORT_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

export async function discoverPoms(outputDir: string): Promise<string[]> {
  return listFiles(path.join(outputDir, 'poms'), '.ts')
}

export async function discoverSpecs(outputDir: string): Promise<string[]> {
  return listFiles(path.join(outputDir, 'specs'), '.ts')
}

export async function discoverVisualDiffs(outputDir: string): Promise<string[]> {
  return listFiles(path.join(outputDir, 'reports', 'visual-diffs'), '.png')
}
