export function sanitizeMarkdownText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ')
}

export function sanitizeMarkdownTableCell(text: string): string {
  return sanitizeMarkdownText(text).replace(/\|/g, '\\|')
}

export function safeCodeFence(content: string): string {
  const runs = content.match(/`+/g) ?? []
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0)
  const fenceLength = Math.max(3, longestRun + 1)
  return '`'.repeat(fenceLength)
}
