import { describe, expect, it, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openCrawlDb } from '@treeline/core'
import type { StoredInterpretation } from '@treeline/core'
import {
  generateAtlas,
  renderAtlasMarkdown,
  generateSelectorReport,
  renderSelectorReportMarkdown,
  generateTestIdAudit,
  renderTestIdAuditMarkdown,
} from '@treeline/output'
import { renderOutputToHtml } from './render.js'

const SCRIPT_PAYLOAD = '<script>alert(1)</script>'
const PIPE_PAYLOAD = 'Evil | Injected | Column'
const ADVERSARIAL_URL = 'https://evil.example.com/page'

const tmpDirs: string[] = []

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
})

function makeAdversarialInterpretation(): StoredInterpretation {
  return {
    url: ADVERSARIAL_URL,
    tierUsed: 'haiku',
    pageType: SCRIPT_PAYLOAD,
    purpose: `Steals data ${SCRIPT_PAYLOAD}\n# Fake heading injected via newline`,
    keyDataEntities: [`entity ${PIPE_PAYLOAD}`],
    confidence: 0.5,
    interpretedAt: new Date().toISOString(),
    proposedAssertion: null,
  }
}

async function buildAdversarialReportsDir(): Promise<string> {
  const outputDir = await makeTmpDir('treeline-injection-src-')
  await fs.mkdir(path.join(outputDir, 'reports'), { recursive: true })

  const dbPath = path.join(outputDir, 'crawl.sqlite')
  const db = openCrawlDb(dbPath)
  db.recordPageState({
    url: ADVERSARIAL_URL,
    title: `${SCRIPT_PAYLOAD} ${PIPE_PAYLOAD}`,
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: new Date().toISOString(),
    pageLoadMs: 500,
    interactiveElements: [
      {
        role: 'button',
        accessibleName: PIPE_PAYLOAD,
        testId: null,
        tagName: 'button',
        elementId: null,
        classList: [],
        cssPath: 'body > button',
        xpath: '/html/body/button',
        appearedAtMs: null,
      },
    ],
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
    colorPalette: [],
    assertableAttributes: [],
  })
  const pages = db.getAllPages()
  db.close()

  const interpretation = makeAdversarialInterpretation()

  const atlas = generateAtlas(pages, [interpretation])
  await fs.writeFile(path.join(outputDir, 'reports', 'atlas.md'), renderAtlasMarkdown(atlas))

  const selectorReport = generateSelectorReport(pages)
  await fs.writeFile(path.join(outputDir, 'reports', 'selector-report.md'), renderSelectorReportMarkdown(selectorReport))

  const testIdAudit = generateTestIdAudit(pages)
  await fs.writeFile(path.join(outputDir, 'reports', 'testid-audit.md'), renderTestIdAuditMarkdown(testIdAudit))

  return outputDir
}

describe('adversarial crawled content through the real report + rendering pipeline', () => {
  it('never produces a live <script> tag in the published HTML', async () => {
    const outputDir = await buildAdversarialReportsDir()
    const targetDir = await makeTmpDir('treeline-injection-out-')

    await renderOutputToHtml(outputDir, targetDir)

    for (const reportFile of ['atlas.html', 'selector-report.html', 'testid-audit.html']) {
      const html = await fs.readFile(path.join(targetDir, 'reports', reportFile), 'utf-8')
      expect(html).not.toContain(SCRIPT_PAYLOAD)
      expect(html.toLowerCase()).not.toMatch(/<script[^>]*>alert/i)
    }

    const atlasHtml = await fs.readFile(path.join(targetDir, 'reports', 'atlas.html'), 'utf-8')
    expect(atlasHtml).toContain('&lt;script&gt;')

    const indexHtml = await fs.readFile(path.join(targetDir, 'index.html'), 'utf-8')
    expect(indexHtml).not.toContain(SCRIPT_PAYLOAD)
  })

  it('does not let a stray "|" character corrupt the selector-report table structure', async () => {
    const outputDir = await buildAdversarialReportsDir()
    const targetDir = await makeTmpDir('treeline-injection-out-')

    await renderOutputToHtml(outputDir, targetDir)

    const html = await fs.readFile(path.join(targetDir, 'reports', 'selector-report.html'), 'utf-8')
    const rowMatch = html.match(/<tr>\s*<td>.*?<\/tr>/s)
    expect(rowMatch).not.toBeNull()
    const cellCount = (rowMatch![0].match(/<td>/g) ?? []).length
    expect(cellCount).toBe(6)
    expect(html).toContain('Evil | Injected | Column')
  })

  it('does not let an embedded newline inject a fake heading into the atlas report', async () => {
    const outputDir = await buildAdversarialReportsDir()
    const targetDir = await makeTmpDir('treeline-injection-out-')

    await renderOutputToHtml(outputDir, targetDir)

    const html = await fs.readFile(path.join(targetDir, 'reports', 'atlas.html'), 'utf-8')
    expect(html).not.toContain('<h1>Fake heading injected via newline</h1>')
  })
})
