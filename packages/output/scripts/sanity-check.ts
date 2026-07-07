import { crawl, openCrawlDb } from "@treeline/core";
import {
  generateSelectorReport,
  renderSelectorReportMarkdown,
} from "../src/index.js";

const dbPath = "./sanity-check.sqlite";
const hardPagesDir = "./hard-pages";

await crawl(
  {
    seedUrl: "https://goldenpetbrands.com/",
    sameOriginOnly: true,
    maxDepth: 1,
    maxPages: 3,
    stealth: false,
    respectRobotsTxt: true,
    throttleMs: 500,
  },
  dbPath,
  hardPagesDir,
);

const db = openCrawlDb(dbPath);
const pages = db.getAllPages();
db.close();

const report = generateSelectorReport(pages);
console.log(renderSelectorReportMarkdown(report));
