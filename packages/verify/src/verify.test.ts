import type { Server } from 'node:http'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startFixtureServer, FIXTURE_USERNAME, FIXTURE_PASSWORD } from './fixture-server.js'
import { runNavMapAudit } from './verify.js'

describe('runNavMapAudit', () => {
  let server: Server
  let port: number
  let outputDir: string

  beforeAll(async () => {
    const started = await startFixtureServer()
    server = started.server
    port = started.port
  })

  afterAll(() => {
    server.close()
  })

  it('flags a mismatched destination and confirms a matching one, without a false positive', async () => {
    outputDir = mkdtempSync(join(tmpdir(), 'treeline-verify-test-'))
    const navMapPath = join(outputDir, 'nav-map.json')
    writeFileSync(navMapPath, JSON.stringify([
      { label: 'Reports', expectedUrl: `http://localhost:${port}/reports`, clickPath: ['Reports'] },
      { label: 'Settings', expectedUrl: `http://localhost:${port}/settings`, clickPath: ['Settings'] },
      { label: 'Billing', expectedUrl: `http://localhost:${port}/billing`, clickPath: ['Billing'], precondition: 'requires a selected account, not reachable from this fixture' },
      { label: 'Audit Log', expectedUrl: `http://localhost:${port}/audit-log`, clickPath: ['Audit Log'] },
    ]))

    const summary = await runNavMapAudit({
      navMapPath,
      baseUrl: `http://localhost:${port}/dashboard`,
      loginUrl: `http://localhost:${port}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
      outputDir,
    })

    expect(summary.totalEntries).toBe(4)
    expect(summary.matches).toBe(2)
    expect(summary.mismatches).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(summary.errors).toBe(0)

    const report = readFileSync(summary.reportPath, 'utf-8')
    expect(report).toContain('| Reports |')
    expect(report).toContain('match')
    expect(report).toContain('mismatch')
    expect(report).toContain(`http://localhost:${port}/settings-legacy`)
    expect(report).not.toContain('only the query string differs')
    expect(report).toContain('## Skipped (precondition required)')
    expect(report).toContain('Billing')
    expect(report).toContain('Audit Log')
  }, 60000)

  it('does not flag a genuinely matching nav link', async () => {
    const matchOnlyDir = mkdtempSync(join(tmpdir(), 'treeline-verify-test-match-'))
    const navMapPath = join(matchOnlyDir, 'nav-map.json')
    writeFileSync(navMapPath, JSON.stringify([
      { label: 'Reports', expectedUrl: `http://localhost:${port}/reports`, clickPath: ['Reports'] },
    ]))

    const summary = await runNavMapAudit({
      navMapPath,
      baseUrl: `http://localhost:${port}/dashboard`,
      loginUrl: `http://localhost:${port}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
      outputDir: matchOnlyDir,
    })

    expect(summary.mismatches).toBe(0)
    expect(summary.matches).toBe(1)
    rmSync(matchOnlyDir, { recursive: true, force: true })
  }, 60000)

  it('observes a click-triggered iframe navigation that lands well after networkidle already resolved, not just an immediate one (real OpenEMR shape: session 61)', async () => {
    const delayedDir = mkdtempSync(join(tmpdir(), 'treeline-verify-test-delayed-'))
    const navMapPath = join(delayedDir, 'nav-map.json')
    writeFileSync(navMapPath, JSON.stringify([
      { label: 'Delayed Report', expectedUrl: `http://localhost:${port}/iframe-target`, clickPath: ['Delayed Report'] },
    ]))

    const summary = await runNavMapAudit({
      navMapPath,
      baseUrl: `http://localhost:${port}/iframe-dashboard`,
      loginUrl: `http://localhost:${port}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
      outputDir: delayedDir,
    })

    expect(summary.errors).toBe(0)
    expect(summary.mismatches).toBe(0)
    expect(summary.matches).toBe(1)
    rmSync(delayedDir, { recursive: true, force: true })
  }, 60000)

  it('flags a query-string-only mismatch as a real mismatch, but annotates it distinctly from a genuinely wrong destination (real shape: a per-session CSRF token)', async () => {
    const tokenDir = mkdtempSync(join(tmpdir(), 'treeline-verify-test-token-'))
    const navMapPath = join(tokenDir, 'nav-map.json')
    writeFileSync(navMapPath, JSON.stringify([
      { label: 'Reports Token', expectedUrl: `http://localhost:${port}/reports`, clickPath: ['Reports Token'] },
    ]))

    const summary = await runNavMapAudit({
      navMapPath,
      baseUrl: `http://localhost:${port}/token-dashboard`,
      loginUrl: `http://localhost:${port}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
      outputDir: tokenDir,
    })

    expect(summary.mismatches).toBe(1)
    const report = readFileSync(summary.reportPath, 'utf-8')
    expect(report).toContain(`http://localhost:${port}/reports?tok=xyz123`)
    expect(report).toContain('only the query string differs')
    rmSync(tokenDir, { recursive: true, force: true })
  }, 60000)

  it('retries the click target lookup rather than failing immediately when the element is transiently absent (real OpenEMR shape: session 61, a nav item intermittently not found right after a prior heavy navigation)', async () => {
    const retryDir = mkdtempSync(join(tmpdir(), 'treeline-verify-test-retry-'))
    const navMapPath = join(retryDir, 'nav-map.json')
    writeFileSync(navMapPath, JSON.stringify([
      { label: 'Delayed Link', expectedUrl: `http://localhost:${port}/reports`, clickPath: ['Delayed Link'] },
    ]))

    const summary = await runNavMapAudit({
      navMapPath,
      baseUrl: `http://localhost:${port}/delayed-target-dashboard`,
      loginUrl: `http://localhost:${port}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
      outputDir: retryDir,
    })

    expect(summary.errors).toBe(0)
    expect(summary.matches).toBe(1)
    rmSync(retryDir, { recursive: true, force: true })
  }, 60000)

  it('reports a false auth-expired error against a real content page whose template never renders --success-indicator\'s marker, when authValidIndicator is not set (the --success-indicator template-divergence bug)', async () => {
    const contentDir = mkdtempSync(join(tmpdir(), 'treeline-verify-test-content-'))
    const navMapPath = join(contentDir, 'nav-map.json')
    writeFileSync(navMapPath, JSON.stringify([
      { label: 'Content Page', expectedUrl: `http://localhost:${port}/content-only`, clickPath: ['Content Page'] },
    ]))

    const summary = await runNavMapAudit({
      navMapPath,
      baseUrl: `http://localhost:${port}/content-dashboard`,
      loginUrl: `http://localhost:${port}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
      outputDir: contentDir,
    })

    expect(summary.errors).toBe(1)
    expect(summary.matches).toBe(0)
    rmSync(contentDir, { recursive: true, force: true })
  }, 60000)

  it('correctly matches the same content page once authValidIndicator supplies just the content-page-specific marker — the tool ORs it with successIndicator automatically, so the operator never hand-writes a CSS union selector', async () => {
    const contentFixedDir = mkdtempSync(join(tmpdir(), 'treeline-verify-test-content-fixed-'))
    const navMapPath = join(contentFixedDir, 'nav-map.json')
    writeFileSync(navMapPath, JSON.stringify([
      { label: 'Content Page', expectedUrl: `http://localhost:${port}/content-only`, clickPath: ['Content Page'] },
    ]))

    const summary = await runNavMapAudit({
      navMapPath,
      baseUrl: `http://localhost:${port}/content-dashboard`,
      loginUrl: `http://localhost:${port}/login`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      successIndicator: '#logout-link',
      authValidIndicator: '[data-restore-session]',
      outputDir: contentFixedDir,
    })

    expect(summary.errors).toBe(0)
    expect(summary.matches).toBe(1)
    rmSync(contentFixedDir, { recursive: true, force: true })
  }, 60000)
})
