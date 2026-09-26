import { launchHardened } from '@treeline/acquire'
import type { AcquireOptions, Browser } from '@treeline/acquire'

export interface SharedBrowser {
  get(): Promise<Browser>
  close(): Promise<void>
}

export function createSharedBrowser(launchOptions: Pick<AcquireOptions, 'stealth' | 'headless'>): SharedBrowser {
  let browser: Browser | null = null
  const closeQuietly = async (target: Browser): Promise<void> => {
    try {
      await target.close()
    } catch {
      return
    }
  }
  return {
    async get() {
      if (browser && browser.isConnected()) return browser
      if (browser) {
        console.warn('[treeline] Shared crawl browser disconnected — relaunching.')
        await closeQuietly(browser)
        browser = null
      }
      browser = await launchHardened({ stealth: launchOptions.stealth, headless: launchOptions.headless })
      return browser
    },
    async close() {
      if (!browser) return
      const target = browser
      browser = null
      await closeQuietly(target)
    },
  }
}
