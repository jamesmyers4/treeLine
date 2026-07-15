import { describe, it, expect } from 'vitest'
import { safeCodeFence, sanitizeMarkdownText, sanitizeMarkdownTableCell } from './markdown-safety.js'

describe('safeCodeFence', () => {
  it('returns a standard 3-backtick fence for content with no backticks', () => {
    expect(safeCodeFence('{"hello":"world"}')).toBe('```')
  })

  it('returns a fence longer than the longest backtick run in the content', () => {
    const content = 'some ```triple backtick``` content'
    const fence = safeCodeFence(content)
    expect(fence.length).toBeGreaterThan(3)
    expect(fence).not.toContain(content)
    const longestRun = Math.max(...(content.match(/`+/g) ?? ['']).map((run) => run.length))
    expect(fence.length).toBeGreaterThan(longestRun)
  })

  it('handles content with mixed-length backtick runs by using the longest one', () => {
    const content = 'a `single` b ````four```` c'
    const fence = safeCodeFence(content)
    expect(fence.length).toBe(5)
  })
})

describe('sanitizeMarkdownText and sanitizeMarkdownTableCell (existing behavior, unchanged)', () => {
  it('still strips newlines from inline text', () => {
    expect(sanitizeMarkdownText('a\nb')).toBe('a b')
  })

  it('still escapes pipes in table cells', () => {
    expect(sanitizeMarkdownTableCell('a|b')).toBe('a\\|b')
  })
})
