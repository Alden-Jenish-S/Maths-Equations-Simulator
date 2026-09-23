import { readFile } from "node:fs/promises";

const required = [
  "README.md",
  "docs/METHODOLOGY.md",
  "docs/NUMERICS.md",
  "docs/SCORING.md",
  "docs/VALIDATION.md",
  "docs/EXPERIMENTS.md",
  "docs/LIVE.md",
  "index.html",
  "styles.css",
];
for (const path of required) {
  const content = await readFile(path, "utf8");
  if (content.trim().length < 120) throw new Error(`${path} is too short`);
}
const html = await readFile("index.html", "utf8");
for (const token of ["family-select", "discovery-select", "parameter-controls", "trace-canvas", "regenerate-button"]) {
  if (!html.includes(token)) throw new Error(`missing UI control ${token}`);
}
console.log("DOCS_PASS ui_controls=present");
