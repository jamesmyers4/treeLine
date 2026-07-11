import { openCrawlDb } from "@treeline/core";
import { interpretPage } from "../src/index.js";
import type { PageState } from "@treeline/acquire";

const dbPath = "../output/sanity-check.sqlite";
const db = openCrawlDb(dbPath);
const pages = db.getAllPages();
db.close();

const candidate = pages.find(
  (p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null,
);
if (!candidate) {
  throw new Error("no successfully captured page found in the db");
}
const page: PageState = {
  ...candidate,
  title: candidate.title!,
  ariaSnapshot: candidate.ariaSnapshot!,
  capturedAt: candidate.capturedAt!,
  pageLoadMs: candidate.pageLoadMs!,
};
console.log(`interpreting: ${page.url}`);
const result = await interpretPage(page);
console.log(JSON.stringify(result, null, 2));
