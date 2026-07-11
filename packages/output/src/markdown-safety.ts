export function sanitizeMarkdownText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ')
}

export function sanitizeMarkdownTableCell(text: string): string {
  return sanitizeMarkdownText(text).replace(/\|/g, '\\|')
}
