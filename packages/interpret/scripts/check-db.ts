import { openCrawlDb } from '@treeline/core'

const db = openCrawlDb('../output/sanity-check.sqlite')
const pages = db.getAllPages()
console.log(`pages: ${pages.length}`)
for (const p of pages) {
console.log(p.url, 'title:', p.title !== null, 'aria:', p.ariaSnapshot !== null, 'capturedAt:', p.capturedAt !== null)
}
const interps = db.getAllInterpretations()
console.log(`interpretations: ${interps.length}`)
db.close()
