import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import type { Browser } from 'playwright'
import type { FastifyInstance } from 'fastify'
import { resolveSeedUrlWithBrowser } from './capture.js'
import { performLogin, SeedAuthenticationError, type LoginCredentials, type StorageState } from './auth.js'
import { buildAuthFixtureServer, FIXTURE_USERNAME, FIXTURE_PASSWORD, SESSION_COOKIE_NAME } from './auth-fixture-server.js'
import { launchHardened } from './launch.js'

describe('resolveSeedUrlWithBrowser', () => {
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

  it('resolves a public page with no redirect and no authSession', async () => {
    const result = await resolveSeedUrlWithBrowser(`${baseUrl}/login`, browser)
    expect(result.resolvedUrl).toBe(`${baseUrl}/login`)
    expect(result.html).toContain('<form')
  }, 30000)

  it('resolves a gated seed URL to itself, without redirecting to login, when seeded with a valid authSession', async () => {
    const storageState = await performLogin(browser, validCreds)
    const result = await resolveSeedUrlWithBrowser(`${baseUrl}/dashboard`, browser, {
      authSession: { storageState, successIndicator: validCreds.successIndicator, loginUrl: validCreds.loginUrl },
    })
    expect(result.resolvedUrl).toBe(`${baseUrl}/dashboard`)
    expect(result.html).toContain('logout-link')
  }, 30000)

  it('reflects the real redirect-to-login target when a gated seed URL is resolved with no authSession', async () => {
    const result = await resolveSeedUrlWithBrowser(`${baseUrl}/dashboard`, browser)
    expect(result.resolvedUrl).toBe(`${baseUrl}/login`)
  }, 30000)

  it('throws SeedAuthenticationError against a gated seed URL when the supplied authSession does not actually authenticate', async () => {
    const invalidStorageState: StorageState = {
      cookies: [
        {
          name: SESSION_COOKIE_NAME,
          value: 'garbage-session-id-never-issued-by-login',
          domain: new URL(baseUrl).hostname,
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }
    await expect(
      resolveSeedUrlWithBrowser(`${baseUrl}/dashboard`, browser, {
        authSession: { storageState: invalidStorageState, successIndicator: validCreds.successIndicator, loginUrl: validCreds.loginUrl },
      }),
    ).rejects.toThrow(SeedAuthenticationError)
  }, 30000)
})
