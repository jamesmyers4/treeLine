import type { DomInteractiveElement } from '@treeline/acquire'
import { computeSelectorCandidates } from '@treeline/core'
import type { CrawledPage } from './input.js'
import { urlToClassName, urlToFileBaseName, elementToPropertyName, deduplicatePropertyNames, assignUniqueNames, sanitizeIdentifier, capitalize } from './naming.js'
import { detectRepeatingRegions } from './repeating-regions.js'
import type { RepeatingPatternGroup } from './repeating-regions.js'
import { assertGeneratedArtifactParses } from './syntax-gate.js'
import type { GeneratedPOM, GeneratedSpec, LocatorStrategy, POMGenerationResult, SelectorCandidate, SkippedElement } from './types.js'

const STRATEGY_PRIORITY: LocatorStrategy[] = ['role', 'testid', 'css', 'xpath']

function lowerFirst(word: string): string {
  if (word.length === 0) return word
  return word[0]!.toLowerCase() + word.slice(1)
}

const NTH_OF_TYPE_N = ':nth-of-type(N)'
const STRAY_DIGIT_PLACEHOLDER = /[#.]N(?![a-zA-Z0-9_-])/
const NON_ROLE_VALUES = new Set(['', 'generic', 'none'])

interface RowField {
  propertyName: string
  relativeCss: string | null
}

interface RowComponent {
  className: string
  accessorName: string
  rowRootExpression: string
  fields: RowField[]
}

function anchorKey(structuralSignature: string): string | null {
  const idx = structuralSignature.indexOf(NTH_OF_TYPE_N)
  if (idx === -1) return null
  return structuralSignature.slice(0, idx + NTH_OF_TYPE_N.length)
}

function representativeSuffix(group: RepeatingPatternGroup, segmentCount: number): string | null {
  const suffixes = group.members.map((member) => member.cssPath.split(' > ').slice(segmentCount).join(' > '))
  const first = suffixes[0]
  if (first === undefined || first === '') return null
  return suffixes.every((suffix) => suffix === first) ? first : null
}

function isSemanticToken(token: string): boolean {
  return !/\d{4,}/.test(token)
}

function classTokensOf(cssSegment: string): string[] {
  return (cssSegment.match(/\.[a-zA-Z_][a-zA-Z0-9_-]*/g) ?? []).map((token) => token.slice(1)).filter(isSemanticToken)
}

function deriveRowFieldName(role: string, tagName: string, suffixCss: string): string {
  const segments = suffixCss.split('>').map((segment) => segment.trim()).filter((segment) => segment.length > 0)
  for (const segment of segments) {
    const classTokens = classTokensOf(segment)
    if (classTokens.length > 0) return sanitizeIdentifier(`${lowerFirst(classTokens[0]!)}${capitalize(role)}`)
  }
  return sanitizeIdentifier(`${lowerFirst(role)}${capitalize(tagName)}`)
}

function deriveRowClassName(rowRootCss: string): string {
  const segments = rowRootCss.split('>').map((segment) => segment.trim()).filter((segment) => segment.length > 0)
  const lastSegment = segments[segments.length - 1] ?? 'row'
  const classTokens = classTokensOf(lastSegment)
  const tagMatch = lastSegment.match(/^[a-zA-Z][a-zA-Z0-9]*/)
  const hint = classTokens.length > 0 ? classTokens[0]! : tagMatch ? tagMatch[0] : 'row'
  return sanitizeIdentifier(`${capitalize(hint)}Row`)
}

function reserveClassName(usedClassNames: Set<string>, baseClassName: string): string {
  let className = baseClassName
  if (usedClassNames.has(className)) {
    let suffix = 2
    while (usedClassNames.has(`${className}${suffix}`)) suffix += 1
    className = `${className}${suffix}`
  }
  usedClassNames.add(className)
  return className
}

function buildStructuralRows(groups: RepeatingPatternGroup[], usedClassNames: Set<string>): { rows: RowComponent[]; consumed: Set<DomInteractiveElement> } {
  const clusters = new Map<string, RepeatingPatternGroup[]>()
  for (const group of groups) {
    const anchor = anchorKey(group.structuralSignature)
    if (anchor === null) continue
    const cluster = clusters.get(anchor)
    if (cluster) cluster.push(group)
    else clusters.set(anchor, [group])
  }
  const rows: RowComponent[] = []
  const consumed = new Set<DomInteractiveElement>()
  for (const [anchor, clusterGroups] of clusters) {
    const instanceCounts = new Set(clusterGroups.map((group) => group.instanceCount))
    if (instanceCounts.size !== 1) continue
    const rowRootCss = anchor.slice(0, anchor.length - NTH_OF_TYPE_N.length)
    if (STRAY_DIGIT_PLACEHOLDER.test(rowRootCss)) continue
    const segmentCount = anchor.split(' > ').length
    const fieldCandidates: { group: RepeatingPatternGroup; suffixCss: string }[] = []
    for (const group of clusterGroups) {
      const suffixCss = representativeSuffix(group, segmentCount)
      if (suffixCss === null || STRAY_DIGIT_PLACEHOLDER.test(suffixCss)) continue
      fieldCandidates.push({ group, suffixCss })
    }
    if (fieldCandidates.length === 0) continue
    const className = reserveClassName(usedClassNames, deriveRowClassName(rowRootCss))
    const fieldNames = deduplicatePropertyNames(fieldCandidates.map((f) => deriveRowFieldName(f.group.role, f.group.tagName, f.suffixCss)))
    const fields: RowField[] = fieldCandidates.map((f, index) => ({ propertyName: fieldNames[index]!, relativeCss: f.suffixCss }))
    const rowRootExpression = `this.page.locator(${JSON.stringify(rowRootCss)})`
    rows.push({ className, accessorName: lowerFirst(className), rowRootExpression, fields })
    for (const { group } of fieldCandidates) {
      for (const member of group.members) consumed.add(member)
    }
  }
  return { rows, consumed }
}

function buildFlatEntityRows(groups: RepeatingPatternGroup[], usedClassNames: Set<string>): { rows: RowComponent[]; consumed: Set<DomInteractiveElement> } {
  const rows: RowComponent[] = []
  const consumed = new Set<DomInteractiveElement>()
  for (const group of groups) {
    if (anchorKey(group.structuralSignature) !== null) continue
    const representative = group.members[0]!
    if (NON_ROLE_VALUES.has(representative.role) || representative.accessibleName.trim() === '') continue
    if (!group.members.every((member) => member.accessibleName === representative.accessibleName)) continue
    const fieldName = elementToPropertyName(representative)
    const className = reserveClassName(usedClassNames, sanitizeIdentifier(`${capitalize(fieldName)}Row`))
    const rowRootExpression = `this.page.getByRole(${JSON.stringify(representative.role)}, { name: ${JSON.stringify(representative.accessibleName)} })`
    rows.push({ className, accessorName: lowerFirst(className), rowRootExpression, fields: [{ propertyName: fieldName, relativeCss: null }] })
    for (const member of group.members) consumed.add(member)
  }
  return { rows, consumed }
}

function buildRowComponents(elements: DomInteractiveElement[]): { rows: RowComponent[]; consumed: Set<DomInteractiveElement> } {
  const groups = detectRepeatingRegions(elements)
  const usedClassNames = new Set<string>()
  const structural = buildStructuralRows(groups, usedClassNames)
  const flat = buildFlatEntityRows(groups, usedClassNames)
  return {
    rows: [...structural.rows, ...flat.rows],
    consumed: new Set([...structural.consumed, ...flat.consumed]),
  }
}

function renderRowClass(row: RowComponent): string {
  const fieldDeclarations = row.fields.map((f) => `  readonly ${f.propertyName}: Locator`).join('\n')
  const assignments = row.fields
    .map((f) => `    this.${f.propertyName} = ${f.relativeCss === null ? 'root' : `root.locator(${JSON.stringify(f.relativeCss)})`}`)
    .join('\n')
  return `export class ${row.className} {
  readonly root: Locator
${fieldDeclarations}

  constructor(root: Locator) {
    this.root = root
${assignments}
  }
}
`
}

function renderRowAccessor(row: RowComponent): string {
  return `  ${row.accessorName}(index: number): ${row.className} {
    return new ${row.className}(${row.rowRootExpression}.nth(index))
  }
`
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

function renderPOMCode(className: string, url: string, fields: { propertyName: string; locator: string }[], rows: RowComponent[]): string {
  const fieldDeclarations = fields.map((f) => `  readonly ${f.propertyName}: Locator`).join('\n')
  const assignments = fields.map((f) => `    this.${f.propertyName} = ${f.locator}`).join('\n')
  const rowClassesCode = rows.map((row) => `${renderRowClass(row)}\n`).join('')
  const accessorsBlock = rows.length > 0 ? `\n${rows.map(renderRowAccessor).join('\n')}` : ''
  return `import { Page, Locator } from '@playwright/test'

${rowClassesCode}export class ${className} {
  readonly page: Page
${fieldDeclarations}

  constructor(page: Page) {
    this.page = page
${assignments}
  }
${accessorsBlock}
  async goto(): Promise<void> {
    await this.page.goto(${JSON.stringify(url)})
  }
}
`
}

function buildPOM(page: CrawledPage, className: string, fileName: string): { pom: GeneratedPOM; skipped: SkippedElement[] } {
  const { rows, consumed } = buildRowComponents(page.interactiveElements)
  const remainingElements = page.interactiveElements.filter((element) => !consumed.has(element))
  const candidatesByElement = computeSelectorCandidates(remainingElements)
  const skipped: SkippedElement[] = []
  const chosen: { element: DomInteractiveElement; candidate: SelectorCandidate; propertyName: string }[] = []
  for (const element of remainingElements) {
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
    const matching = remainingElements.filter((el) => {
      const elCandidates = candidatesByElement.get(el)!
      return elCandidates.some((cand) => cand.strategy === c.candidate.strategy && cand.value === c.candidate.value)
    })
    const nth = c.candidate.uniqueOnPage ? null : matching.indexOf(c.element)
    return { propertyName: dedupedNames[index]!, locator: buildLocatorExpression(c.element, c.candidate, nth) }
  })
  const code = renderPOMCode(className, page.url, fields, rows)
  return { pom: { className, fileName, code }, skipped }
}

export function generatePOM(page: CrawledPage): { pom: GeneratedPOM; skipped: SkippedElement[] } {
  return buildPOM(page, urlToClassName(page.url), `${urlToFileBaseName(page.url)}.page.ts`)
}

export function generateSpec(pom: GeneratedPOM, pageUrl: string): GeneratedSpec {
  const importPath = `./${pom.fileName.replace(/\.ts$/, '')}`
  const instanceName = lowerFirst(pom.className)
  const fileName = `${pom.fileName.replace(/\.page\.ts$/, '')}.spec.ts`
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
  const { assignments, collisions } = assignUniqueNames(capturedPages.map((p) => p.url))
  const poms: GeneratedPOM[] = []
  const specs: GeneratedSpec[] = []
  const skipped: SkippedElement[] = []
  for (const page of capturedPages) {
    const assigned = assignments.get(page.url)!
    const result = buildPOM(page, assigned.className, `${assigned.fileBaseName}.page.ts`)
    assertGeneratedArtifactParses(result.pom.fileName, result.pom.code)
    const spec = generateSpec(result.pom, page.url)
    assertGeneratedArtifactParses(spec.fileName, spec.code)
    poms.push(result.pom)
    specs.push(spec)
    skipped.push(...result.skipped)
  }
  for (const collision of collisions) {
    const disambiguated = collision.urls.map((url, index) => `${collision.baseFileName}${index + 1}`).join(', ')
    console.warn(
      `[treeline] POM/spec filename collision: ${collision.urls.length} pages would all generate "${collision.baseFileName}.page.ts" — disambiguated as ${disambiguated}. URLs: ${collision.urls.join(', ')}`,
    )
  }
  return { poms, specs, skipped, collisions }
}
