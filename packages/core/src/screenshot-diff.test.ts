import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PNG } from 'pngjs'
import type { PageState } from '@treeline/acquire'
import { openCrawlDb } from './persistence.js'
import { diffCrawls } from './diff.js'
import { diffScreenshots } from './screenshot-diff.js'

function makePng(width: number, height: number, colorAt: (x: number, y: number) => [number, number, number]): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4
      const [r, g, b] = colorAt(x, y)
      png.data[idx] = r
      png.data[idx + 1] = g
      png.data[idx + 2] = b
      png.data[idx + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

function solidPng(width: number, height: number, color: [number, number, number]): Buffer {
  return makePng(width, height, () => color)
}

function horizontalBandPng(width: number, height: number, bandRow: number, bandColor: number): Buffer {
  return makePng(width, height, (_x, y) => {
    if (y < bandRow) return [255, 255, 255]
    if (y === bandRow) return [bandColor, bandColor, bandColor]
    return [0, 0, 0]
  })
}

function makePage(url: string, screenshot: Buffer | null): PageState {
  return {
    url,
    title: 'Title',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot,
    capturedAt: new Date().toISOString(),
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
  }
}

function seedDb(dbPath: string, pages: PageState[]): void {
  const db = openCrawlDb(dbPath)
  for (const page of pages) {
    db.recordPageState(page)
  }
  db.close()
}

let tmpDir: string
let baselinePath: string
let currentPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-screenshot-diff-test-'))
  baselinePath = join(tmpDir, 'baseline', 'crawl.db')
  currentPath = join(tmpDir, 'current', 'crawl.db')
  mkdirSync(join(tmpDir, 'baseline'), { recursive: true })
  mkdirSync(join(tmpDir, 'current'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('diffScreenshots', () => {
  it('reports unchanged for two identical screenshots', () => {
    const png = solidPng(20, 20, [10, 20, 30])
    seedDb(baselinePath, [makePage('https://example.com/', png)])
    seedDb(currentPath, [makePage('https://example.com/', png)])

    const result = diffScreenshots(baselinePath, currentPath)

    expect(result).toEqual([
      { url: 'https://example.com/', method: 'pixel-diff', status: 'unchanged', diffPixelCount: 0, diffPixelPercent: 0 },
    ])
  })

  it('reports changed for two meaningfully different screenshots', () => {
    seedDb(baselinePath, [makePage('https://example.com/', solidPng(20, 20, [255, 255, 255]))])
    seedDb(currentPath, [makePage('https://example.com/', solidPng(20, 20, [0, 0, 0]))])

    const result = diffScreenshots(baselinePath, currentPath)

    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('changed')
    expect(result[0]!.diffPixelCount).toBe(400)
    expect(result[0]!.diffPixelPercent).toBe(100)
  })

  it('stays unchanged for an anti-aliasing-only difference', () => {
    seedDb(baselinePath, [makePage('https://example.com/', horizontalBandPng(20, 20, 10, 100))])
    seedDb(currentPath, [makePage('https://example.com/', horizontalBandPng(20, 20, 10, 160))])

    const result = diffScreenshots(baselinePath, currentPath)

    expect(result).toEqual([
      { url: 'https://example.com/', method: 'pixel-diff', status: 'unchanged', diffPixelCount: 0, diffPixelPercent: 0 },
    ])
  })

  it('reports baseline-missing when the baseline screenshot is null', () => {
    seedDb(baselinePath, [makePage('https://example.com/', null)])
    seedDb(currentPath, [makePage('https://example.com/', solidPng(10, 10, [0, 0, 0]))])

    const result = diffScreenshots(baselinePath, currentPath)

    expect(result).toEqual([
      { url: 'https://example.com/', method: 'pixel-diff', status: 'baseline-missing', diffPixelCount: null, diffPixelPercent: null },
    ])
  })

  it('reports current-missing when the current screenshot is null', () => {
    seedDb(baselinePath, [makePage('https://example.com/', solidPng(10, 10, [0, 0, 0]))])
    seedDb(currentPath, [makePage('https://example.com/', null)])

    const result = diffScreenshots(baselinePath, currentPath)

    expect(result).toEqual([
      { url: 'https://example.com/', method: 'pixel-diff', status: 'current-missing', diffPixelCount: null, diffPixelPercent: null },
    ])
  })

  it('reports dimensions-changed without calling pixelmatch when sizes differ', () => {
    seedDb(baselinePath, [makePage('https://example.com/', solidPng(10, 10, [0, 0, 0]))])
    seedDb(currentPath, [makePage('https://example.com/', solidPng(20, 20, [0, 0, 0]))])

    const result = diffScreenshots(baselinePath, currentPath)

    expect(result).toEqual([
      { url: 'https://example.com/', method: 'pixel-diff', status: 'dimensions-changed', diffPixelCount: null, diffPixelPercent: null },
    ])
  })

  it('excludes a page present in only one of the two runs', () => {
    seedDb(baselinePath, [
      makePage('https://example.com/', solidPng(10, 10, [0, 0, 0])),
      makePage('https://example.com/old', solidPng(10, 10, [0, 0, 0])),
    ])
    seedDb(currentPath, [
      makePage('https://example.com/', solidPng(10, 10, [0, 0, 0])),
      makePage('https://example.com/new', solidPng(10, 10, [0, 0, 0])),
    ])

    const result = diffScreenshots(baselinePath, currentPath)

    expect(result.map((c) => c.url)).toEqual(['https://example.com/'])
  })

  it('is independently callable and returns the same result as diffCrawls.visualChanges', () => {
    seedDb(baselinePath, [makePage('https://example.com/', solidPng(20, 20, [255, 255, 255]))])
    seedDb(currentPath, [makePage('https://example.com/', solidPng(20, 20, [0, 0, 0]))])

    const direct = diffScreenshots(baselinePath, currentPath)
    const viaDiffCrawls = diffCrawls(baselinePath, currentPath).visualChanges

    expect(direct).toEqual(viaDiffCrawls)
    expect(direct).toHaveLength(1)
  })
})
