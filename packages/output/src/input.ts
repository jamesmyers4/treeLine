import type { openCrawlDb } from '@treeline/core'

export type CrawledPage = ReturnType<ReturnType<typeof openCrawlDb>['getAllPages']>[number]
