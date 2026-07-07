import type { AcquireOptions, CaptureHandler, NetworkEntry, PageState } from './types.js'
import { launchHardened } from './launch.js'

export async function capturePage(url: string, options?: AcquireOptions): Promise<PageState> {
  const browser = await launchHardened(options)
  const page = await browser.newPage()
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
  const links = await page.locator('a[href]').evaluateAll((els) =>
    (els as HTMLAnchorElement[]).map((el) => el.href).filter(Boolean),
  )
  await page.close()
  await browser.close()
  return {
    url,
    title,
    ariaSnapshot,
    links,
    networkLog,
    screenshot: null,
    capturedAt: new Date().toISOString(),
  }
}

export const defaultCaptureHandler: CaptureHandler = {
  matches: async () => true,
  capture: capturePage,
}
