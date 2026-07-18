import type { Browser, BrowserContext, Page } from 'playwright'

export interface LoginCredentials {
  loginUrl: string
  username: string
  password: string
  successIndicator: string
  usernameSelector?: string
  passwordSelector?: string
  submitSelector?: string
}

export interface StorageStateCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

export interface StorageState {
  cookies: StorageStateCookie[]
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>
}

const DEFAULT_USERNAME_SELECTOR = 'input[type=email], input[type=text][name*=user i]'
const DEFAULT_PASSWORD_SELECTOR = 'input[type=password]'
const DEFAULT_SUBMIT_SELECTOR = 'button[type=submit], input[type=submit]'

export class LoginFailedError extends Error {
  constructor(loginUrl: string) {
    super(`Login failed: success indicator not found after submitting credentials at ${loginUrl}`)
    this.name = 'LoginFailedError'
  }
}

export class AuthExpiredError extends Error {
  constructor(url: string) {
    super(`Authenticated session is no longer valid at ${url}`)
    this.name = 'AuthExpiredError'
  }
}

export class AuthWallError extends Error {
  constructor(url: string) {
    super(`Auth wall detected at ${url}: page appears to require authentication`)
    this.name = 'AuthWallError'
  }
}

export class SeedAuthenticationError extends Error {
  constructor(seedUrl: string, resolvedUrl: string) {
    super(
      `Seed URL ${seedUrl} could not be resolved as authenticated content — landed on ${resolvedUrl} instead. The supplied login credentials or session do not appear to be valid; verify them before crawling.`,
    )
    this.name = 'SeedAuthenticationError'
  }
}

async function submitLogin(page: Page, creds: LoginCredentials): Promise<void> {
  await page.goto(creds.loginUrl, { waitUntil: 'domcontentloaded' })
  await page.locator(creds.usernameSelector ?? DEFAULT_USERNAME_SELECTOR).first().fill(creds.username)
  await page.locator(creds.passwordSelector ?? DEFAULT_PASSWORD_SELECTOR).first().fill(creds.password)
  await page.locator(creds.submitSelector ?? DEFAULT_SUBMIT_SELECTOR).first().click()
  await page.waitForLoadState('networkidle').catch(() => undefined)
  const indicatorCount = await page.locator(creds.successIndicator).count()
  if (indicatorCount === 0) {
    throw new LoginFailedError(creds.loginUrl)
  }
}

export async function performLogin(browser: Browser, creds: LoginCredentials, options?: { insecureCerts?: boolean }): Promise<StorageState> {
  const context = await browser.newContext(options?.insecureCerts ? { ignoreHTTPSErrors: true } : undefined)
  const page = await context.newPage()
  try {
    await submitLogin(page, creds)
    return await context.storageState()
  } finally {
    await page.close()
    await context.close()
  }
}

export async function performLoginSession(browser: Browser, creds: LoginCredentials, options?: { insecureCerts?: boolean }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options?.insecureCerts ? { ignoreHTTPSErrors: true } : undefined)
  const page = await context.newPage()
  try {
    await submitLogin(page, creds)
    return { context, page }
  } catch (err) {
    await page.close()
    await context.close()
    throw err
  }
}

export function normalizeForComparison(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}`
  } catch {
    return url
  }
}

export async function checkAuthStillValid(page: Page, indicator: string, loginUrl: string): Promise<boolean> {
  if (normalizeForComparison(page.url()) === normalizeForComparison(loginUrl)) return false
  return (await page.locator(indicator).count()) > 0
}
