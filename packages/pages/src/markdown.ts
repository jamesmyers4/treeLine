import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true })

export function extractTitle(markdownSource: string, fallback: string): string {
  const match = markdownSource.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : fallback
}

export function renderMarkdownFragment(markdownSource: string): string {
  return md.render(markdownSource)
}
