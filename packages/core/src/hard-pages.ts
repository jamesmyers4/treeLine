import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HardPageEntry } from './types.js'

function hardPageEntryPath(dir: string, url: string): string {
  const slug = createHash('sha1').update(url).digest('hex').slice(0, 12)
  return join(dir, `${slug}.json`)
}

export function writeHardPageEntry(dir: string, entry: HardPageEntry): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(hardPageEntryPath(dir, entry.url), JSON.stringify(entry, null, 2))
}

export function clearHardPageEntry(dir: string, url: string): void {
  rmSync(hardPageEntryPath(dir, url), { force: true })
}
