import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://goldenpetbrands.com/our-brands.html");
const results = await new AxeBuilder({ page }).analyze();
console.log("incomplete:", JSON.stringify(results.incomplete, null, 2));
await browser.close();
