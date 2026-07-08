import type { DomInteractiveElement } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { computeSelectorCandidates } from './selector-report.js'
import { urlToClassName, urlToFileBaseName, elementToPropertyName, deduplicatePropertyNames } from './naming.js'
import type { GeneratedPOM, GeneratedSpec, LocatorStrategy, POMGenerationResult, SelectorCandidate, SkippedElement } from './types.js'

const STRATEGY_PRIORITY: LocatorStrategy[] = ['role', 'testid', 'css', 'xpath']

function lowerFirst(word: string): string {
  if (word.length === 0) return word
  return word[0]!.toLowerCase() + word.slice(1)
}

function selectStableCandidate(candidates: SelectorCandidate[]): SelectorCandidate | undefined {
  for (const strategy of STRATEGY_PRIORITY) {
    const match = candidates.find((c) => c.strategy === strategy && c.stable)
    if (match) return match
  }
  return undefined
}

function buildLocatorExpression(element: DomInteractiveElement, candidate: SelectorCandidate, nth: number | null): string {
  let base: string
  if (candidate.strategy === 'role') {
    base = `page.getByRole(${JSON.stringify(element.role)}, { name: ${JSON.stringify(element.accessibleName)} })`
  } else if (candidate.strategy === 'xpath') {
    base = `page.locator(\`xpath=${candidate.value}\`)`
  } else {
    base = `page.locator(${JSON.stringify(candidate.value)})`
  }
  return nth === null ? base : `${base}.nth(${nth})`
}

function renderPOMCode(className: string, url: string, fields: { propertyName: string; locator: string }[]): string {
  const fieldDeclarations = fields.map((f) => `  readonly ${f.propertyName}: Locator`).join('\n')
  const assignments = fields.map((f) => `    this.${f.propertyName} = ${f.locator}`).join('\n')
  return `import { Page, Locator } from '@playwright/test'

export class ${className} {
  readonly page: Page
${fieldDeclarations}

  constructor(page: Page) {
    this.page = page
${assignments}
  }

  async goto(): Promise<void> {
    await this.page.goto(${JSON.stringify(url)})
  }
}
`
}

export function generatePOM(page: CrawledPage): { pom: GeneratedPOM; skipped: SkippedElement[] } {
  const candidatesByElement = computeSelectorCandidates(page.interactiveElements)
  const skipped: SkippedElement[] = []
  const chosen: { element: DomInteractiveElement; candidate: SelectorCandidate; propertyName: string }[] = []
  for (const element of page.interactiveElements) {
    const candidates = candidatesByElement.get(element)!
    const selected = selectStableCandidate(candidates)
    if (!selected) {
      skipped.push({ url: page.url, elementDescription: elementToPropertyName(element), reason: 'no stable selector candidate available' })
      continue
    }
    chosen.push({ element, candidate: selected, propertyName: elementToPropertyName(element) })
  }
  const dedupedNames = deduplicatePropertyNames(chosen.map((c) => c.propertyName))
  const fields = chosen.map((c, index) => {
    const matching = page.interactiveElements.filter((el) => {
      const elCandidates = candidatesByElement.get(el)!
      return elCandidates.some((cand) => cand.strategy === c.candidate.strategy && cand.value === c.candidate.value)
    })
    const nth = c.candidate.uniqueOnPage ? null : matching.indexOf(c.element)
    return { propertyName: dedupedNames[index]!, locator: buildLocatorExpression(c.element, c.candidate, nth) }
  })
  const className = urlToClassName(page.url)
  const fileName = `${urlToFileBaseName(page.url)}.page.ts`
  const code = renderPOMCode(className, page.url, fields)
  return { pom: { className, fileName, code }, skipped }
}

export function generateSpec(pom: GeneratedPOM, pageUrl: string): GeneratedSpec {
  const importPath = `./${pom.fileName.replace(/\.ts$/, '')}`
  const instanceName = lowerFirst(pom.className)
  const fileName = `${urlToFileBaseName(pageUrl)}.spec.ts`
  const code = `import { test, expect } from '@playwright/test'
import { ${pom.className} } from '${importPath}'

test('${pom.className} loads', async ({ page }) => {
  const ${instanceName} = new ${pom.className}(page)
  await ${instanceName}.goto()
  await expect(page).toHaveURL(${JSON.stringify(pageUrl)})
})
`
  return { fileName, code }
}

export function generatePOMsAndSpecs(pages: CrawledPage[]): POMGenerationResult {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  const poms: GeneratedPOM[] = []
  const specs: GeneratedSpec[] = []
  const skipped: SkippedElement[] = []
  for (const page of capturedPages) {
    const result = generatePOM(page)
    poms.push(result.pom)
    specs.push(generateSpec(result.pom, page.url))
    skipped.push(...result.skipped)
  }
  return { poms, specs, skipped }
}
