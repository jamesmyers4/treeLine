import { openCrawlDb } from "@treeline/core";
import { generateAtlas, renderAtlasMarkdown } from "../src/index.js";

const db = openCrawlDb("./sanity-check.sqlite");
const pages = db.getAllPages();
const interpretations = db.getAllInterpretations();
db.close();

const atlas = generateAtlas(pages, interpretations);
console.log(renderAtlasMarkdown(atlas));
