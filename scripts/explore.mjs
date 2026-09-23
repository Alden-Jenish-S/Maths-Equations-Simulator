import { mkdir, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { explore, discoveryMarkdown, validateExplorationOptions } from "../src/explorer.js";
import { canonicalSerialize } from "../src/fingerprint.js";

const USAGE = "node scripts/explore.mjs [--families all|id,id] [--samples 1..100] [--top 1..100] [--seed 0..4294967295] [--preview 0..10000]";
const OPTIONS = { "--seed": "seed", "--samples": "samplesPerFamily", "--top": "top", "--families": "families", "--preview": "previewPoints" };

export function parseExploreArgs(args) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!Object.hasOwn(OPTIONS, name)) throw new RangeError(`unknown option: ${name}`);
    if (seen.has(name)) throw new RangeError(`duplicate option: ${name}`);
    seen.add(name);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new RangeError(`${name} requires a value`);
    if (name === "--families") {
      options.families = value.trim() === "all" ? "all" : value.split(",");
    } else {
      if (!/^\d+$/.test(value)) throw new RangeError(`${name} requires an unsigned decimal integer`);
      options[OPTIONS[name]] = Number(value);
    }
  }
  return validateExplorationOptions(options);
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(USAGE);
    return;
  }
  const options = parseExploreArgs(args);
  const result = explore(options);
  result.runtime.osRelease = release();
  const representedFamilies = new Set(result.discoveries.map((candidate) => candidate.family)).size;
  if (result.discoveries.length !== options.top || representedFamilies !== result.search.families.length) {
    throw new Error(`insufficient eligible unique candidates: retained=${result.discoveries.length}/${options.top} families=${representedFamilies}/${result.search.families.length}; increase --samples`);
  }
  // Canonical JSON preserves -0 and every finite IEEE-754 value exactly. It
  // also rejects NaN/Infinity anywhere, including selection/audit fields.
  const json = `${canonicalSerialize(result)}\n`;
  const markdown = discoveryMarkdown(result);
  await mkdir("data", { recursive: true });
  await writeFile("data/discoveries.json", json);
  await writeFile("data/exploration-report.md", markdown);
  console.log(`EXPLORE_PASS discoveries=${result.discoveries.length} families=${representedFamilies} candidates=${result.search.evaluatedCandidates}`);
  console.log("artifacts=data/discoveries.json,data/exploration-report.md");
  for (const [index, candidate] of result.discoveries.entries()) {
    console.log(`${index + 1}. ${candidate.family} ${candidate.class} score=${candidate.metrics.score.toFixed(2)} fingerprint=${candidate.fingerprint}`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`EXPLORE_FAIL ${error.message}\nUsage: ${USAGE}`);
    process.exitCode = 1;
  });
}
