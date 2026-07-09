export interface RenderedPage {
  title: string
  sourcePath: string
  outputPath: string
}

export type RunMode = 'crawl' | 'diff'

export interface RunMeta {
  targetUrl: string | null
  mode: RunMode
  renderedAt: string
  pageCount: number | null
}

export interface RenderResult {
  outputDir: string
  targetDir: string
  indexPath: string
  reports: RenderedPage[]
  poms: RenderedPage[]
  specs: RenderedPage[]
  visualDiffImages: string[]
  meta: RunMeta
}
