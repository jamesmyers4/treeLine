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
})
