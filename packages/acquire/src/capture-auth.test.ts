import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type { Browser } from 'playwright'
import type { FastifyInstance } from 'fastify'
import { capturePageWithBrowser } from './capture.js'
import { performLogin, AuthExpiredError, AuthWallError, type LoginCredentials } from './auth.js'
import { buildAuthFixtureServer, FIXTURE_USERNAME, FIXTURE_PASSWORD } from './auth-fixture-server.js'
import { launchHardened } from './launch.js'

describe('capturePageWithBrowser (auth threading)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let validCreds: LoginCredentials
  let browser: Browser

  beforeAll(async () => {
    server = buildAuthFixtureServer()
    baseUrl = await server.listen({ port: 0, host: '127.0.0.1' })
    validCreds = {
      loginUrl: `${baseUrl}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
    }
    browser = await launchHardened()
  })

  afterAll(async () => {
    await browser.close()
    await server.close()
  })

  it('captures /dashboard successfully when seeded with valid session state from performLogin', async () => {
    const storageState = await performLogin(browser, validCreds)
    const pageState = await capturePageWithBrowser(`${baseUrl}/dashboard`, browser, {
      authSession: { storageState, successIndicator: validCreds.successIndicator, loginUrl: validCreds.loginUrl },
    })
    expect(pageState.url).toBe(`${baseUrl}/dashboard`)
    expect(pageState.ariaSnapshot).toBeTruthy()
  }, 30000)

  it('throws AuthWallError against /dashboard with an unseeded context and detectAuthWall: true', async () => {
    await expect(
      capturePageWithBrowser(`${baseUrl}/dashboard`, browser, { detectAuthWall: true }),
    ).rejects.toThrow(AuthWallError)
  }, 30000)

  it('does not throw with detectAuthWall false or unset, capturing normally (default-off gate)', async () => {
    const pageState = await capturePageWithBrowser(`${baseUrl}/dashboard`, browser, {})
    expect(pageState.url).toBe(`${baseUrl}/dashboard`)
  }, 30000)

  it('does not throw AuthWallError against /change-password with valid seeded state and detectAuthWall: true (regression)', async () => {
    const storageState = await performLogin(browser, validCreds)
    const pageState = await capturePageWithBrowser(`${baseUrl}/change-password`, browser, {
      authSession: { storageState, successIndicator: validCreds.successIndicator, loginUrl: validCreds.loginUrl },
      detectAuthWall: true,
    })
    expect(pageState.url).toBe(`${baseUrl}/change-password`)
    expect(pageState.forms.some((form) => form.fields.some((field) => field.inputType === 'password'))).toBe(true)
  }, 30000)

  it('throws AuthExpiredError when the seeded session expired mid-crawl (hit /logout, then capture /dashboard)', async () => {
    const storageState = await performLogin(browser, validCreds)
    const context = await browser.newContext({ storageState })
    let expiredState
    try {
      const page = await context.newPage()
      await page.goto(`${baseUrl}/logout`, { waitUntil: 'domcontentloaded' })
      expiredState = await context.storageState()
    } finally {
      await context.close()
    }
    await expect(
      capturePageWithBrowser(`${baseUrl}/dashboard`, browser, {
        authSession: { storageState: expiredState, successIndicator: validCreds.successIndicator, loginUrl: validCreds.loginUrl },
      }),
    ).rejects.toThrow(AuthExpiredError)
  }, 30000)

  it('throws a false-positive AuthExpiredError against /content-fragment with a genuinely valid session, when authValidIndicator is not set and successIndicator is the login-landing-only marker (the --success-indicator template-divergence bug)', async () => {
    const storageState = await performLogin(browser, validCreds)
    await expect(
      capturePageWithBrowser(`${baseUrl}/content-fragment`, browser, {
        authSession: { storageState, successIndicator: validCreds.successIndicator, loginUrl: validCreds.loginUrl },
      }),
    ).rejects.toThrow(AuthExpiredError)
  }, 30000)

  it('captures /content-fragment successfully with a valid session when authValidIndicator supplies the content-page-specific marker', async () => {
    const storageState = await performLogin(browser, validCreds)
    const pageState = await capturePageWithBrowser(`${baseUrl}/content-fragment`, browser, {
      authSession: {
        storageState,
        successIndicator: validCreds.successIndicator,
        authValidIndicator: '[data-restore-session]',
        loginUrl: validCreds.loginUrl,
      },
    })
    expect(pageState.url).toBe(`${baseUrl}/content-fragment`)
  }, 30000)
})
