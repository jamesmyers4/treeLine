import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HardPageEntry } from './types.js'

export function writeHardPageEntry(dir: string, entry: HardPageEntry): void {
  mkdirSync(dir, { recursive: true })
  const slug = createHash('sha1').update(entry.url).digest('hex').slice(0, 12)
  writeFileSync(join(dir, `${slug}.json`), JSON.stringify(entry, null, 2))
}
