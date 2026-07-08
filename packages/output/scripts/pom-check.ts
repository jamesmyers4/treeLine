import { openCrawlDb } from "@treeline/core";
import { generatePOMsAndSpecs } from "../src/index.js";

const db = openCrawlDb("./sanity-check.sqlite");
const pages = db.getAllPages();
db.close();

const result = generatePOMsAndSpecs(pages);

for (const pom of result.poms) {
  console.log(`=== ${pom.fileName} ===`);
  console.log(pom.code);
}

for (const spec of result.specs) {
  console.log(`=== ${spec.fileName} ===`);
  console.log(spec.code);
}

console.log(`=== skipped (${result.skipped.length}) ===`);
console.log(JSON.stringify(result.skipped, null, 2));
