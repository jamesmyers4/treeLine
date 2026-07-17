import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type { Browser } from 'playwright'
import { performLogin, checkAuthStillValid, normalizeForComparison, LoginFailedError, type LoginCredentials } from './auth.js'
import { buildAuthFixtureServer, FIXTURE_USERNAME, FIXTURE_PASSWORD, SESSION_COOKIE_NAME } from './auth-fixture-server.js'
import { launchHardened } from './launch.js'
import type { FastifyInstance } from 'fastify'

describe('auth', () => {
  let server: FastifyInstance
  let baseUrl: string
  let validCreds: LoginCredentials

  beforeAll(async () => {
    server = buildAuthFixtureServer()
    baseUrl = await server.listen({ port: 0, host: '127.0.0.1' })
    validCreds = {
      loginUrl: `${baseUrl}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
    }
  })

  afterAll(async () => {
    await server.close()
  })

  describe('performLogin', () => {
    it('succeeds against valid credentials and returns a storageState containing the session cookie', async () => {
      const browser = await launchHardened()
      try {
        const state = await performLogin(browser, validCreds)
        expect(state.cookies.some((c) => c.name === SESSION_COOKIE_NAME)).toBe(true)
      } finally {
        await browser.close()
      }
    }, 30000)

    it('throws LoginFailedError against wrong credentials', async () => {
      const browser = await launchHardened()
      try {
        await expect(
          performLogin(browser, { ...validCreds, username: 'wronguser', password: 'wrongpass' }),
        ).rejects.toThrow(LoginFailedError)
      } finally {
        await browser.close()
      }
    }, 30000)
  })

  describe('seeded storageState', () => {
    let browser: Browser

    beforeAll(async () => {
      browser = await launchHardened()
    })

    afterAll(async () => {
      await browser.close()
    })

    it('can load /dashboard directly using a seeded storageState, without hitting /login', async () => {
      const state = await performLogin(browser, validCreds)
      const context = await browser.newContext({ storageState: state })
      try {
        const page = await context.newPage()
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
        expect(normalizeForComparison(page.url())).toBe(normalizeForComparison(`${baseUrl}/dashboard`))
        expect(await page.locator('#logout-link').count()).toBeGreaterThan(0)
      } finally {
        await context.close()
      }
    }, 30000)

    it('checkAuthStillValid returns true on /dashboard with a valid session', async () => {
      const state = await performLogin(browser, validCreds)
      const context = await browser.newContext({ storageState: state })
      try {
        const page = await context.newPage()
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
        expect(await checkAuthStillValid(page, '#logout-link', validCreds.loginUrl)).toBe(true)
      } finally {
        await context.close()
      }
    }, 30000)

    it('checkAuthStillValid returns true on /change-password with a valid session (false-positive regression)', async () => {
      const state = await performLogin(browser, validCreds)
      const context = await browser.newContext({ storageState: state })
      try {
        const page = await context.newPage()
        await page.goto(`${baseUrl}/change-password`, { waitUntil: 'domcontentloaded' })
        expect(await page.locator('input[type=password]').count()).toBeGreaterThan(0)
        expect(await checkAuthStillValid(page, '#logout-link', validCreds.loginUrl)).toBe(true)
      } finally {
        await context.close()
      }
    }, 30000)

    it('checkAuthStillValid returns false after hitting /logout then loading /dashboard again', async () => {
      const state = await performLogin(browser, validCreds)
      const context = await browser.newContext({ storageState: state })
      try {
        const page = await context.newPage()
        await page.goto(`${baseUrl}/logout`, { waitUntil: 'domcontentloaded' })
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
        expect(await checkAuthStillValid(page, '#logout-link', validCreds.loginUrl)).toBe(false)
      } finally {
        await context.close()
      }
    }, 30000)
  })

  describe('normalizeForComparison', () => {
    it('treats a URL with and without a trailing slash as equal', () => {
      expect(normalizeForComparison('https://x.com/login')).toBe(normalizeForComparison('https://x.com/login/'))
    })

    it('preserves query params and returns malformed input unchanged rather than throwing', () => {
      expect(normalizeForComparison('https://x.com/login?next=/dashboard')).toBe('https://x.com/login?next=/dashboard')
      expect(() => normalizeForComparison('not a url')).not.toThrow()
      expect(normalizeForComparison('not a url')).toBe('not a url')
    })
  })
})
