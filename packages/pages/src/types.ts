export interface RenderedPage {
  title: string
  sourcePath: string
  outputPath: string
}

export interface RenderResult {
  outputDir: string
  targetDir: string
  indexPath: string
  reports: RenderedPage[]
  poms: RenderedPage[]
  specs: RenderedPage[]
  visualDiffImages: string[]
}
