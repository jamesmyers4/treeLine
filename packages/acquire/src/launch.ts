import { chromium as patchrightChromium } from 'patchright'
import { chromium, type Browser } from 'playwright'
import type { AcquireOptions } from './types.js'

export async function launchHardened(options: AcquireOptions = {}): Promise<Browser> {
  const proxy = options.proxy ? { server: options.proxy } : undefined
  if (options.stealth) {
    return patchrightChromium.launch({
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
      proxy,
    }) as unknown as Browser
  }
  return chromium.launch({
    headless: false,
    proxy,
  })
}
