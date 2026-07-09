import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from 'playwright'
import type { AcquireOptions, AxeIncompleteResult, AxeViolation, CapturedForm, CaptureHandler, DomInteractiveElement, NetworkEntry, PageState } from './types.js'
import { launchHardened } from './launch.js'

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

export async function capturePage(url: string, options?: AcquireOptions): Promise<PageState> {
  const browser = await launchHardened(options)
  const context = await browser.newContext()
  const page = await context.newPage()
  const networkLog: NetworkEntry[] = []
  const pending = new Map<string, { method: string; resourceType: string }>()
  page.on('request', (req) => {
    pending.set(req.url(), { method: req.method(), resourceType: req.resourceType() })
  })
  page.on('response', (res) => {
    const req = pending.get(res.url())
    if (req) {
      networkLog.push({ url: res.url(), method: req.method, status: res.status(), resourceType: req.resourceType })
    }
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => undefined)
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
    'button, a[href], input, select, textarea, [role]',
    (els) =>
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
        }
      }),
  )
  const forms = await extractForms(page)
  let screenshot: Buffer | null = null
  try {
    screenshot = await page.screenshot({ type: 'png', fullPage: true })
  } catch (err) {
    console.warn(`screenshot capture failed for ${url}`, err)
  }
  await page.close()
  await browser.close()
  return {
    url,
    title,
    ariaSnapshot,
    links,
    networkLog,
    screenshot,
    capturedAt: new Date().toISOString(),
    interactiveElements,
    axeViolations,
    axeIncomplete,
    forms,
  }
}

export const defaultCaptureHandler: CaptureHandler = {
  matches: async () => true,
  capture: capturePage,
}
