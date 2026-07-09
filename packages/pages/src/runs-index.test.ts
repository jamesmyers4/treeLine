import { describe, expect, it, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildRunsIndex } from './runs-index.js'
import type { RunMeta } from './types.js'

const tmpDirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'treeline-pages-runs-index-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
})

async function writeRun(runsRootDir: string, dirName: string, meta: RunMeta): Promise<void> {
  const runDir = path.join(runsRootDir, dirName)
  await fs.mkdir(runDir, { recursive: true })
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2))
  await fs.writeFile(path.join(runDir, 'index.html'), `<html><body>${dirName}</body></html>`)
}

describe('buildRunsIndex', () => {
  it('lists 3 simulated runs, newest first, mixing crawl and diff modes', async () => {
    const runsRootDir = await makeTmpDir()
    await writeRun(runsRootDir, 'run-1', {
      targetUrl: 'https://example.com/',
      mode: 'crawl',
      renderedAt: '2026-07-01T00:00:00.000Z',
      pageCount: 5,
    })
    await writeRun(runsRootDir, 'run-2', {
      targetUrl: 'https://example.com/',
      mode: 'diff',
      renderedAt: '2026-07-03T00:00:00.000Z',
      pageCount: 6,
    })
    await writeRun(runsRootDir, 'run-3', {
      targetUrl: 'https://another.example/',
      mode: 'crawl',
      renderedAt: '2026-07-02T00:00:00.000Z',
      pageCount: 3,
    })

    await buildRunsIndex(runsRootDir)

    const html = await fs.readFile(path.join(runsRootDir, 'index.html'), 'utf-8')
    expect(html).toContain('run-1/index.html')
    expect(html).toContain('run-2/index.html')
    expect(html).toContain('run-3/index.html')
    expect(html).toContain('https://example.com/')
    expect(html).toContain('https://another.example/')
    expect(html).toContain('crawl')
    expect(html).toContain('diff')

    const run2Index = html.indexOf('run-2/index.html')
    const run3Index = html.indexOf('run-3/index.html')
    const run1Index = html.indexOf('run-1/index.html')
    expect(run2Index).toBeLessThan(run3Index)
    expect(run3Index).toBeLessThan(run1Index)
  })

  it('shows a placeholder for unknown target and page count', async () => {
    const runsRootDir = await makeTmpDir()
    await writeRun(runsRootDir, 'run-unknown', {
      targetUrl: null,
      mode: 'crawl',
      renderedAt: '2026-07-01T00:00:00.000Z',
      pageCount: null,
    })

    await buildRunsIndex(runsRootDir)

    const html = await fs.readFile(path.join(runsRootDir, 'index.html'), 'utf-8')
    expect(html).toContain('(unknown target)')
  })

  it('skips subdirectories without a meta.json', async () => {
    const runsRootDir = await makeTmpDir()
    await writeRun(runsRootDir, 'run-1', {
      targetUrl: 'https://example.com/',
      mode: 'crawl',
      renderedAt: '2026-07-01T00:00:00.000Z',
      pageCount: 1,
    })
    await fs.mkdir(path.join(runsRootDir, 'not-a-run'), { recursive: true })

    await buildRunsIndex(runsRootDir)

    const html = await fs.readFile(path.join(runsRootDir, 'index.html'), 'utf-8')
    expect(html).toContain('run-1/index.html')
    expect(html).not.toContain('not-a-run')
  })

  it('renders a "no runs found" message when the root has no valid runs', async () => {
    const runsRootDir = await makeTmpDir()

    await buildRunsIndex(runsRootDir)

    const html = await fs.readFile(path.join(runsRootDir, 'index.html'), 'utf-8')
    expect(html).toContain('No runs found.')
  })
})
