import { codeToHtml } from 'shiki'

export async function renderTypeScriptFragment(source: string): Promise<string> {
  return codeToHtml(source, { lang: 'typescript', theme: 'github-dark' })
}
