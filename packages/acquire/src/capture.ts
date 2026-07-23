import { AxeBuilder } from '@axe-core/playwright'
import type { Browser, BrowserContext, Page, Request } from 'playwright'
import type { AcquireOptions, AxeIncompleteResult, AxeViolation, CapturedForm, CaptureHandler, ColorSwatch, DomInteractiveElement, NetworkEntry, PageState, RequestBodyContentTypeCategory } from './types.js'
import { launchHardened } from './launch.js'
import { AuthExpiredError, AuthWallError, SeedAuthenticationError, checkAuthStillValid } from './auth.js'

const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [role]'
const APPEARED_ATTR = 'data-treeline-appeared-at'
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 512000
const DEFAULT_MAX_REQUEST_BODY_BYTES = 65536
const CAPTURABLE_RESOURCE_TYPES = new Set(['xhr', 'fetch'])
const COLOR_SELECTOR = 'body, header, nav, main, footer, h1, h2, h3, h4, h5, h6, p, a, button, input, [class*="btn" i], table, tr, td, th'
const MAX_COLOR_SWATCHES = 20

function parseQueryParams(url: string): Record<string, string> {
  try {
    const params: Record<string, string> = {}
    for (const [key, value] of new URL(url).searchParams) params[key] = value
    return params
  } catch {
    return {}
  }
}

function inferShallowSchema(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const schema: Record<string, string> = {}
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    schema[key] = fieldValue === null ? 'null' : Array.isArray(fieldValue) ? 'array' : typeof fieldValue
  }
  return schema
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function categorizeRequestBodyContentType(contentType: string): RequestBodyContentTypeCategory {
  const normalized = contentType.toLowerCase()
  if (normalized.startsWith('application/json')) return 'json'
  if (normalized.startsWith('application/x-www-form-urlencoded')) return 'form-urlencoded'
  if (normalized.startsWith('multipart/form-data')) return 'multipart'
  return 'other'
}

interface RequestBodyExtractionResult {
  requestBody: string[] | null
  requestBodyContentTypeCategory: RequestBodyContentTypeCategory | null
  requestBodyExceededSizeCap: boolean
}

const NO_BODY_RESULT: RequestBodyExtractionResult = { requestBody: null, requestBodyContentTypeCategory: null, requestBodyExceededSizeCap: false }

function extractRequestBodyFieldNames(req: Request, maxBytes: number, sampledEndpoints: Set<string>): RequestBodyExtractionResult {
  // Derived from the Content-Type header directly, not gated on req.postData() —
  // Playwright's postData() returns null for a real multipart/form-data request (the
  // body is a stream/Blob, not exposable as text), so a category derived only when
  // postData() is non-null would never see 'multipart' at all.
  const contentTypeHeader = req.headers()['content-type']
  const category = contentTypeHeader ? categorizeRequestBodyContentType(contentTypeHeader) : null
  const postData = req.postData()
  if (!postData) return { requestBody: null, requestBodyContentTypeCategory: category, requestBodyExceededSizeCap: false }
  // 'REQ ' keeps this in its own namespace within the shared sampledEndpoints Set
  // so it can never collide with the unprefixed response-body dedup key below.
  const key = `REQ ${req.method()} ${req.url()}`
  const exceededSizeCap = Buffer.byteLength(postData, 'utf-8') > maxBytes
  if (exceededSizeCap || sampledEndpoints.has(key)) {
    return { requestBody: null, requestBodyContentTypeCategory: category, requestBodyExceededSizeCap: exceededSizeCap }
  }
  try {
    if (category === 'json') {
      const parsed = JSON.parse(postData)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { requestBody: null, requestBodyContentTypeCategory: category, requestBodyExceededSizeCap: false }
      }
      sampledEndpoints.add(key)
      return { requestBody: Object.keys(parsed), requestBodyContentTypeCategory: category, requestBodyExceededSizeCap: false }
    }
    if (category === 'form-urlencoded') {
      const fields = Array.from(new Set(new URLSearchParams(postData).keys()))
      sampledEndpoints.add(key)
      return { requestBody: fields, requestBodyContentTypeCategory: category, requestBodyExceededSizeCap: false }
    }
    return { requestBody: null, requestBodyContentTypeCategory: category, requestBodyExceededSizeCap: false }
  } catch {
    return { requestBody: null, requestBodyContentTypeCategory: category, requestBodyExceededSizeCap: false }
  }
}

async function installAppearanceTracker(page: Page): Promise<void> {
  await page.addInitScript(
    ({ selector, attr }) => {
      const t0 = Date.now()
      let domReady = false
      document.addEventListener('DOMContentLoaded', () => { domReady = true }, { once: true })
      const tag = (el: Element) => {
        if (!el.hasAttribute(attr) && el.matches(selector)) el.setAttribute(attr, String(Date.now() - t0))
      }
      const observer = new MutationObserver((mutations) => {
        if (!domReady) return
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return
            tag(node)
            node.querySelectorAll(selector).forEach((child) => tag(child))
          })
        }
      })
      observer.observe(document, { childList: true, subtree: true })
    },
    { selector: INTERACTIVE_SELECTOR, attr: APPEARED_ATTR },
  )
}

export async function extractForms(page: Page): Promise<CapturedForm[]> {
  return page.$$eval('form', (formEls) => {
    const computeCssPath = (target: Element): string => {
      if (target.id && document.querySelectorAll(`#${CSS.escape(target.id)}`).length === 1) {
        return `#${CSS.escape(target.id)}`
      }
      const parts: string[] = []
      let current: Element | null = target
      while (current && current !== document.body && current.parentElement) {
        const currentTag = current.tagName.toLowerCase()
        let selector = currentTag
        const classes = Array.from(current.classList)
        if (classes.length > 0) selector += '.' + classes.map((c) => CSS.escape(c)).join('.')
        const parent: Element = current.parentElement
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current!.tagName)
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1
          selector += `:nth-of-type(${index})`
        }
        parts.unshift(selector)
        current = parent
      }
      return parts.join(' > ')
    }
    return formEls.map((formEl, formIndex) => {
      const formElement = formEl as HTMLFormElement
      const action = formElement.action
      const method = (formElement.method || 'get').toUpperCase()
      const fieldEls = Array.from(formElement.querySelectorAll('input, select, textarea'))
      const fields = fieldEls.map((el) => {
        const tagName = el.tagName.toLowerCase()
        let role: string
        if (tagName === 'input') {
          const inputEl = el as HTMLInputElement
          const type = inputEl.type?.toLowerCase() ?? 'text'
          if (type === 'submit' || type === 'button' || type === 'reset') role = 'button'
          else if (type === 'checkbox') role = 'checkbox'
          else if (type === 'radio') role = 'radio'
          else if (type === 'range') role = 'slider'
          else role = 'textbox'
        } else if (tagName === 'select') {
          role = 'combobox'
        } else {
          role = 'textbox'
        }
        const ariaLabel = el.getAttribute('aria-label')
        let accessibleName = ''
        if (ariaLabel) {
          accessibleName = ariaLabel.trim()
        } else {
          const labelledBy = el.getAttribute('aria-labelledby')
          if (labelledBy) {
            const labelEl = document.getElementById(labelledBy)
            if (labelEl) accessibleName = labelEl.textContent?.trim() ?? ''
          }
          if (!accessibleName) accessibleName = el.textContent?.trim() ?? ''
          if (!accessibleName) {
            const inputEl = el as HTMLInputElement
            accessibleName = inputEl.placeholder?.trim() ?? inputEl.value?.trim() ?? ''
          }
        }
        const inputType = tagName === 'input' ? ((el as HTMLInputElement).type?.toLowerCase() ?? 'text') : null
        const required = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).required
        return {
          role,
          accessibleName,
          tagName,
          inputType,
          required,
          pattern: el.getAttribute('pattern'),
          testId: el.getAttribute('data-testid'),
          cssPath: computeCssPath(el),
        }
      })
      return { formIndex, action, method, fields }
    })
  })
}

export async function extractColorPalette(page: Page): Promise<ColorSwatch[]> {
  const swatches = await page.$$eval(COLOR_SELECTOR, (els) => {
    const computeCssPath = (target: Element): string => {
      if (target === document.body) return 'body'
      if (target.id && document.querySelectorAll(`#${CSS.escape(target.id)}`).length === 1) {
        return `#${CSS.escape(target.id)}`
      }
      const parts: string[] = []
      let current: Element | null = target
      while (current && current !== document.body && current.parentElement) {
        const currentTag = current.tagName.toLowerCase()
        let selector = currentTag
        const classes = Array.from(current.classList)
        if (classes.length > 0) selector += '.' + classes.map((c) => CSS.escape(c)).join('.')
        const parent: Element = current.parentElement
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current!.tagName)
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1
          selector += `:nth-of-type(${index})`
        }
        parts.unshift(selector)
        current = parent
      }
      return parts.join(' > ')
    }
    const parseColor = (value: string): string | null => {
      const match = value.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/)
      if (!match) return null
      const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1
      if (alpha === 0) return null
      const toHex = (n: string) => Math.round(parseFloat(n)).toString(16).padStart(2, '0')
      return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`
    }
    const counts = new Map<string, { property: 'color' | 'background-color'; hex: string; usageCount: number; exampleSelector: string }>()
    for (const el of els) {
      const style = getComputedStyle(el)
      const candidates: Array<['color' | 'background-color', string]> = [
        ['color', style.color],
        ['background-color', style.backgroundColor],
      ]
      for (const [property, rawValue] of candidates) {
        const hex = parseColor(rawValue)
        if (!hex) continue
        const key = `${property}:${hex}`
        const existing = counts.get(key)
        if (existing) {
          existing.usageCount += 1
        } else {
          counts.set(key, { property, hex, usageCount: 1, exampleSelector: computeCssPath(el) })
        }
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.usageCount - a.usageCount)
  })
  return swatches.slice(0, MAX_COLOR_SWATCHES)
}

export async function capturePage(url: string, options?: AcquireOptions): Promise<PageState> {
  const browser = await launchHardened(options)
  try {
    return await capturePageWithBrowser(url, browser, options)
  } finally {
    await browser.close()
  }
}

export async function capturePageWithBrowser(url: string, browser: Browser, options?: AcquireOptions): Promise<PageState> {
  const context = await browser.newContext({
    ...(options?.authSession ? { storageState: options.authSession.storageState } : {}),
    ...(options?.insecureCerts ? { ignoreHTTPSErrors: true } : {}),
  })
  try {
    return await captureWithContext(url, context, options)
  } finally {
    await context.close()
  }
}

export async function resolveSeedUrl(url: string, options?: AcquireOptions): Promise<{ resolvedUrl: string; html: string | null }> {
  const browser = await launchHardened(options)
  try {
    return await resolveSeedUrlWithBrowser(url, browser, options)
  } finally {
    await browser.close()
  }
}

export async function resolveSeedUrlWithBrowser(url: string, browser: Browser, options?: AcquireOptions): Promise<{ resolvedUrl: string; html: string | null }> {
  const context = await browser.newContext({
    ...(options?.authSession ? { storageState: options.authSession.storageState } : {}),
    ...(options?.insecureCerts ? { ignoreHTTPSErrors: true } : {}),
  })
  try {
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const resolvedUrl = page.url()
    const html = await page.content()
    if (options?.authSession) {
      const stillValid = await checkAuthStillValid(page, options.authSession.successIndicator, options.authSession.loginUrl)
      if (!stillValid) throw new SeedAuthenticationError(url, resolvedUrl)
    }
    return { resolvedUrl, html }
  } finally {
    await context.close()
  }
}

async function captureWithContext(url: string, context: BrowserContext, options?: AcquireOptions): Promise<PageState> {
  const page = await context.newPage()
  const networkLog: NetworkEntry[] = []
  const pending = new Map<
    string,
    {
      method: string
      resourceType: string
      startedAt: number
      requestHeaderNames: string[]
      queryParams: Record<string, string>
      requestBody: string[] | null
      requestBodyContentTypeCategory: RequestBodyContentTypeCategory | null
      requestBodyExceededSizeCap: boolean
    }
  >()
  const bodyReads: Promise<void>[] = []
  const sampledEndpoints = options?.sampledEndpoints ?? new Set<string>()
  const maxResponseBodyBytes = options?.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES
  const maxRequestBodyBytes = options?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  const requiresAuth = Boolean(options?.authSession)
  page.on('request', (req) => {
    const bodyExtraction = options?.captureRequestBodies
      ? extractRequestBodyFieldNames(req, maxRequestBodyBytes, sampledEndpoints)
      : NO_BODY_RESULT
    pending.set(req.url(), {
      method: req.method(),
      resourceType: req.resourceType(),
      startedAt: Date.now(),
      requestHeaderNames: Object.keys(req.headers()),
      queryParams: parseQueryParams(req.url()),
      requestBody: bodyExtraction.requestBody,
      requestBodyContentTypeCategory: bodyExtraction.requestBodyContentTypeCategory,
      requestBodyExceededSizeCap: bodyExtraction.requestBodyExceededSizeCap,
    })
  })
  page.on('response', (res) => {
    const req = pending.get(res.url())
    if (!req) return
    const entry: NetworkEntry = {
      url: res.url(),
      method: req.method,
      status: res.status(),
      resourceType: req.resourceType,
      durationMs: Date.now() - req.startedAt,
      responseBodySample: null,
      responseBodySchema: null,
      requestBody: req.requestBody,
      requestBodyContentTypeCategory: req.requestBodyContentTypeCategory,
      requestBodyExceededSizeCap: req.requestBodyExceededSizeCap,
      requestHeaderNames: req.requestHeaderNames,
      queryParams: req.queryParams,
      requiresAuth,
    }
    networkLog.push(entry)
    if (!options?.captureResponseBodies) return
    if (!CAPTURABLE_RESOURCE_TYPES.has(req.resourceType)) return
    const contentType = res.headers()['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) return
    const key = `${req.method} ${res.url()}`
    if (sampledEndpoints.has(key)) return
    bodyReads.push(
      (async () => {
        try {
          const body = await res.text()
          sampledEndpoints.add(key)
          if (Buffer.byteLength(body, 'utf-8') <= maxResponseBodyBytes) {
            entry.responseBodySample = body
            entry.responseBodySchema = inferShallowSchema(safeJsonParse(body))
          }
        } catch {
          // response body unreadable (redirected, already consumed) — leave unsampled, eligible for retry
        }
      })(),
    )
  })
  await installAppearanceTracker(page)
  const navigationStart = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
  const pageLoadMs = Date.now() - navigationStart
  const title = await page.title()
  const ariaSnapshot = await page.locator('body').ariaSnapshot()
  let axeViolations: AxeViolation[] = []
  let axeIncomplete: AxeIncompleteResult[] = []
  try {
    const axeResults = await new AxeBuilder({ page }).analyze()
    axeViolations = axeResults.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target as string[],
        html: node.html,
        failureSummary: node.failureSummary ?? null,
      })),
    }))
    axeIncomplete = axeResults.incomplete.map((incomplete) => ({
      id: incomplete.id,
      impact: incomplete.impact ?? null,
      description: incomplete.description,
      help: incomplete.help,
      helpUrl: incomplete.helpUrl,
      nodes: incomplete.nodes.map((node) => ({
        target: node.target as string[],
        html: node.html,
        failureSummary: node.failureSummary ?? null,
      })),
    }))
  } catch (err) {
    console.warn(`axe-core scan failed for ${url}`, err)
  }
  const links = await page.locator('a[href]').evaluateAll((els) =>
    (els as HTMLAnchorElement[]).map((el) => el.href).filter(Boolean),
  )
  const interactiveElements: DomInteractiveElement[] = await page.$$eval(
    INTERACTIVE_SELECTOR,
    (els, attr) =>
      els.map((el) => {
        const tagName = el.tagName.toLowerCase()
        const explicitRole = el.getAttribute('role')
        let role: string
        if (explicitRole) {
          role = explicitRole
        } else if (tagName === 'a') {
          role = 'link'
        } else if (tagName === 'button') {
          role = 'button'
        } else if (tagName === 'input') {
          const inputEl = el as HTMLInputElement
          const type = inputEl.type?.toLowerCase() ?? 'text'
          if (type === 'submit' || type === 'button' || type === 'reset') role = 'button'
          else if (type === 'checkbox') role = 'checkbox'
          else if (type === 'radio') role = 'radio'
          else if (type === 'range') role = 'slider'
          else role = 'textbox'
        } else if (tagName === 'select') {
          role = 'combobox'
        } else if (tagName === 'textarea') {
          role = 'textbox'
        } else {
          role = tagName
        }
        const ariaLabel = el.getAttribute('aria-label')
        let accessibleName = ''
        if (ariaLabel) {
          accessibleName = ariaLabel.trim()
        } else {
          const labelledBy = el.getAttribute('aria-labelledby')
          if (labelledBy) {
            const labelEl = document.getElementById(labelledBy)
            if (labelEl) accessibleName = labelEl.textContent?.trim() ?? ''
          }
          if (!accessibleName) accessibleName = el.textContent?.trim() ?? ''
          if (!accessibleName) {
            const inputEl = el as HTMLInputElement
            accessibleName = inputEl.placeholder?.trim() ?? inputEl.value?.trim() ?? ''
          }
        }
        const computeCssPath = (target: Element): string => {
          if (target.id && document.querySelectorAll(`#${CSS.escape(target.id)}`).length === 1) {
            return `#${CSS.escape(target.id)}`
          }
          const parts: string[] = []
          let current: Element | null = target
          while (current && current !== document.body && current.parentElement) {
            const currentTag = current.tagName.toLowerCase()
            let selector = currentTag
            const classes = Array.from(current.classList)
            if (classes.length > 0) selector += '.' + classes.map((c) => CSS.escape(c)).join('.')
            const parent: Element = current.parentElement
            const siblings = Array.from(parent.children).filter((c) => c.tagName === current!.tagName)
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1
              selector += `:nth-of-type(${index})`
            }
            parts.unshift(selector)
            current = parent
          }
          return parts.join(' > ')
        }
        const computeXPath = (target: Element): string => {
          const parts: string[] = []
          let current: Element | null = target
          while (current) {
            const currentTag = current.tagName.toLowerCase()
            const parent: Element | null = current.parentElement
            if (currentTag === 'html' || !parent) {
              parts.unshift(currentTag)
              break
            }
            const siblings = Array.from(parent.children).filter((c) => c.tagName === current!.tagName)
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1
              parts.unshift(`${currentTag}[${index}]`)
            } else {
              parts.unshift(currentTag)
            }
            current = parent
          }
          return '/' + parts.join('/')
        }
        return {
          role,
          accessibleName,
          testId: el.getAttribute('data-testid'),
          tagName,
          elementId: el.id || null,
          classList: Array.from(el.classList),
          cssPath: computeCssPath(el),
          xpath: computeXPath(el),
          appearedAtMs: el.hasAttribute(attr) ? Number(el.getAttribute(attr)) : null,
        }
      }),
    APPEARED_ATTR,
  )
  const forms = await extractForms(page)
  const colorPalette = await extractColorPalette(page)
  let screenshot: Buffer | null = null
  try {
    screenshot = await page.screenshot({ type: 'png', fullPage: true })
  } catch (err) {
    console.warn(`screenshot capture failed for ${url}`, err)
  }
  await Promise.all(bodyReads)
  const pageState: PageState = {
    url,
    title,
    ariaSnapshot,
    links,
    networkLog,
    screenshot,
    capturedAt: new Date().toISOString(),
    pageLoadMs,
    interactiveElements,
    axeViolations,
    axeIncomplete,
    forms,
    colorPalette,
  }
  if (options?.detectAuthWall && !options?.authSession) {
    const hasPasswordField = forms.some((form) => form.fields.some((field) => field.inputType === 'password'))
    if (hasPasswordField) throw new AuthWallError(url)
  }
  if (options?.authSession) {
    const stillValid = await checkAuthStillValid(page, options.authSession.successIndicator, options.authSession.loginUrl)
    if (!stillValid) throw new AuthExpiredError(url)
  }
  return pageState
}

export const defaultCaptureHandler: CaptureHandler = {
  matches: async () => true,
  capture: capturePage,
}
