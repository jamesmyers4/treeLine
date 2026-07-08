import { openCrawlDb } from "@treeline/core";
import { generateAxeReport, renderAxeReportMarkdown } from "../src/index.js";

const db = openCrawlDb("../cli/treeline-output/gpb-axe-test-v2/crawl.sqlite");
const pages = db.getAllPages();
db.close();

const report = generateAxeReport(pages);
console.log(renderAxeReportMarkdown(report));
