import { describe, it, expect } from 'vitest'
import { decideTier } from './routing.js'
import type { PageState } from '@treeline/acquire'

function makePageState(ariaSnapshot: string): PageState {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    ariaSnapshot,
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: new Date().toISOString(),
    interactiveElements: []
  }
}

describe('decideTier', () => {
  it('routes to haiku when snapshot is small and has few interactive roles', () => {
    const snapshot = 'heading "Welcome"\nparagraph "Some content"\nlink "Home"'
    const result = decideTier(makePageState(snapshot))
    expect(result.tier).toBe('haiku')
    expect(result.reason).toMatch(/1 interactive roles/)
  })

  it('routes to sonnet when interactive role count meets threshold', () => {
    const roles = Array.from({ length: 8 }, (_, i) => `button "Action ${i}"`).join('\n')
    const result = decideTier(makePageState(roles))
    expect(result.tier).toBe('sonnet')
    expect(result.reason).toMatch(/8 interactive roles/)
  })

  it('routes to sonnet when snapshot length meets threshold', () => {
    const snapshot = 'link "Go"\n' + 'x'.repeat(4000)
    const result = decideTier(makePageState(snapshot))
    expect(result.tier).toBe('sonnet')
  })

  it('routes to haiku when exactly below both thresholds', () => {
    const snapshot = Array.from({ length: 7 }, (_, i) => `button "Action ${i}"`).join('\n')
    const result = decideTier(makePageState(snapshot))
    expect(result.tier).toBe('haiku')
    expect(result.reason).toMatch(/7 interactive roles/)
  })

  it('counts all interactive role types', () => {
    const snapshot = 'button "B"\nlink "L"\ntextbox "T"\ncombobox "C"\ncheckbox "Ch"\nradio "R"\nmenuitem "M"'
    const result = decideTier(makePageState(snapshot))
    expect(result.tier).toBe('haiku')
    expect(result.reason).toMatch(/^7 interactive roles/)
  })

  it('routes to sonnet when interactive count is high regardless of snapshot length', () => {
    const snapshot = Array.from({ length: 10 }, (_, i) => `link "Page ${i}"`).join('\n')
    const result = decideTier(makePageState(snapshot))
    expect(result.tier).toBe('sonnet')
  })

  it('includes snapshot length in reason string', () => {
    const snapshot = 'heading "Title"'
    const result = decideTier(makePageState(snapshot))
    expect(result.reason).toContain(`snapshot ${snapshot.length} chars`)
  })
})
