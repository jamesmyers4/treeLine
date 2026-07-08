import { runInterpretation } from "../src/index.js";

await runInterpretation(
  "../output/sanity-check.sqlite",
  "../output/hard-pages",
);
console.log("done");
