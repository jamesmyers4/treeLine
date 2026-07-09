import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { extractForms } from './capture.js'
import { launchHardened } from './launch.js'

async function loadFixture(page: Page, path: string, html: string): Promise<void> {
  const url = `http://fixture.test${path}`
  await page.route(url, (route) => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto(url)
}

describe('extractForms', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await launchHardened()
    const context = await browser.newContext()
    page = await context.newPage()
  })

  afterAll(async () => {
    await browser.close()
  })

  it('captures one simple form with action, method, text input, and submit button', async () => {
    await loadFixture(page, '/simple', `
      <html><body>
        <form action="/submit" method="post">
          <input type="text" name="username" aria-label="Username" />
          <button type="submit">Submit</button>
        </form>
      </body></html>
    `)
    const forms = await extractForms(page)
    expect(forms.length).toBe(1)
    expect(forms[0].formIndex).toBe(0)
    expect(forms[0].method).toBe('POST')
    expect(forms[0].action).toBe('http://fixture.test/submit')
    expect(forms[0].fields.length).toBe(1)
    expect(forms[0].fields[0].tagName).toBe('input')
    expect(forms[0].fields[0].accessibleName).toBe('Username')
  })

  it('returns an empty array, not undefined, for a page with no forms', async () => {
    await loadFixture(page, '/no-forms', `<html><body><p>No forms here</p></body></html>`)
    const forms = await extractForms(page)
    expect(Array.isArray(forms)).toBe(true)
    expect(forms).toEqual([])
  })

  it('captures multiple forms with correct DOM-order formIndex', async () => {
    await loadFixture(page, '/multi', `
      <html><body>
        <form action="/first" method="get">
          <input type="text" name="a" aria-label="Field A" />
        </form>
        <form action="/second" method="post">
          <input type="text" name="b" aria-label="Field B" />
        </form>
      </body></html>
    `)
    const forms = await extractForms(page)
    expect(forms.length).toBe(2)
    expect(forms[0].formIndex).toBe(0)
    expect(forms[0].action).toBe('http://fixture.test/first')
    expect(forms[1].formIndex).toBe(1)
    expect(forms[1].action).toBe('http://fixture.test/second')
  })

  it('captures required: true vs required: false correctly', async () => {
    await loadFixture(page, '/required', `
      <html><body>
        <form>
          <input type="text" name="req" required aria-label="Required Field" />
          <input type="text" name="opt" aria-label="Optional Field" />
        </form>
      </body></html>
    `)
    const forms = await extractForms(page)
    const required = forms[0].fields.find((f) => f.accessibleName === 'Required Field')
    const optional = forms[0].fields.find((f) => f.accessibleName === 'Optional Field')
    expect(required?.required).toBe(true)
    expect(optional?.required).toBe(false)
  })

  it('captures pattern string vs null correctly', async () => {
    await loadFixture(page, '/pattern', `
      <html><body>
        <form>
          <input type="text" name="withPattern" pattern="[0-9]{5}" aria-label="Zip" />
          <input type="text" name="noPattern" aria-label="Plain" />
        </form>
      </body></html>
    `)
    const forms = await extractForms(page)
    const withPattern = forms[0].fields.find((f) => f.accessibleName === 'Zip')
    const noPattern = forms[0].fields.find((f) => f.accessibleName === 'Plain')
    expect(withPattern?.pattern).toBe('[0-9]{5}')
    expect(noPattern?.pattern).toBeNull()
  })

  it('normalizes a missing method attribute to GET', async () => {
    await loadFixture(page, '/no-method', `
      <html><body>
        <form action="/no-method-target">
          <input type="text" name="x" aria-label="X" />
        </form>
      </body></html>
    `)
    const forms = await extractForms(page)
    expect(forms[0].method).toBe('GET')
  })

  it('resolves a relative action the same way links are resolved', async () => {
    await loadFixture(page, '/relative-action', `
      <html><body>
        <form action="/submit-relative">
          <input type="text" name="x" aria-label="X" />
        </form>
      </body></html>
    `)
    const forms = await extractForms(page)
    expect(forms[0].action).toBe('http://fixture.test/submit-relative')
  })

  it("resolves a missing action to the page's own current URL", async () => {
    await loadFixture(page, '/no-action', `
      <html><body>
        <form>
          <input type="text" name="x" aria-label="X" />
        </form>
      </body></html>
    `)
    const forms = await extractForms(page)
    expect(forms[0].action).toBe(page.url())
  })

  it('captures inputType across real HTML5 types and null for select/textarea', async () => {
    await loadFixture(page, '/input-types', `
      <html><body>
        <form>
          <input type="email" name="email" aria-label="Email" />
          <input type="tel" name="tel" aria-label="Tel" />
          <input type="number" name="number" aria-label="Number" />
          <input type="text" name="text" aria-label="Text" />
          <select name="sel" aria-label="Select">
            <option value="1">One</option>
          </select>
          <textarea name="ta" aria-label="Textarea"></textarea>
        </form>
      </body></html>
    `)
    const forms = await extractForms(page)
    const byName = (name: string) => forms[0].fields.find((f) => f.accessibleName === name)
    expect(byName('Email')?.inputType).toBe('email')
    expect(byName('Tel')?.inputType).toBe('tel')
    expect(byName('Number')?.inputType).toBe('number')
    expect(byName('Text')?.inputType).toBe('text')
    expect(byName('Select')?.inputType).toBeNull()
    expect(byName('Textarea')?.inputType).toBeNull()
    expect(byName('Select')?.tagName).toBe('select')
    expect(byName('Select')?.role).toBe('combobox')
    expect(byName('Textarea')?.tagName).toBe('textarea')
  })
})
