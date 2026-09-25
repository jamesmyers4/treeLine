import type { openCrawlDb } from '@treeline/core'

export type CrawledPage = ReturnType<ReturnType<typeof openCrawlDb>['getAllPages']>[number]

export function isHttpErrorPage(page: CrawledPage): boolean {
  return page.httpStatus !== null && page.httpStatus >= 400
}
