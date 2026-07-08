import { openCrawlDb } from '@treeline/core'

const db = openCrawlDb('../output/sanity-check.sqlite')
console.log(db.getAllInterpretations())
db.close()
