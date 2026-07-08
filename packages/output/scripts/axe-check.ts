import { openCrawlDb } from "@treeline/core";

const db = openCrawlDb("../cli/treeline-output/gpb-axe-test/crawl.sqlite");
const pages = db.getAllPages();
db.close();

for (const page of pages) {
  console.log(`=== ${page.url} (${page.axeViolations.length} violations) ===`);
  for (const v of page.axeViolations) {
    console.log(`[${v.impact}] ${v.id}: ${v.help}`);
    console.log(
      `  affects ${v.nodes.length} element(s), e.g. ${v.nodes[0]?.target.join(" ")}`,
    );
  }
}
