import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseExploreArgs } from "./explore.mjs";
import {
  candidateFingerprint, candidateIdentity, candidatePayload, discoveryMarkdown,
  evaluateCandidate, explore, normalizeFamilies, novelty, runtimeInformation,
} from "../src/explorer.js";
import { canonicalSerialize, fingerprintValue, sha256Hex, firstDifference } from "../src/fingerprint.js";
import { getSystem, SYSTEM_LIST } from "../src/systems.js";

// V8's optimizing tier can reassociate long floating-point RK4/metric loops;
// --no-opt is the narrowest available runtime control for this exact-bit
// regression harness. Production/browser runs still report libm/engine limits.
if (!process.execArgv.includes("--no-opt")) {
  const rerun = spawnSync(process.execPath, ["--no-opt", ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(rerun.status ?? 1);
}

const seed = 424242;
const samplesPerFamily = 6;
const top = 12;
const families = normalizeFamilies("all").map((system) => system.id);
const roundTrip = (value) => JSON.parse(canonicalSerialize(value));
const nodeSha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function assertExact(left, right, label) {
  const difference = firstDifference(left, right);
  if (difference) assert.fail(`${label}: ${difference}`);
}

function assertFiniteNumbers(value, path = "root") {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} contains a non-finite number`);
  else if (Array.isArray(value)) value.forEach((item, index) => assertFiniteNumbers(item, `${path}[${index}]`));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => assertFiniteNumbers(item, `${path}.${key}`));
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]));
  return value;
}

function assertCandidate(candidate) {
  assertFiniteNumbers(candidate);
  assert.equal(candidate.fingerprint, candidateFingerprint(candidatePayload(candidate)));
  assert.equal(candidate.id, `${candidate.family}-${fingerprintValue(candidateIdentity(candidate))}`);
  for (const key of ["parameters", "config", "metadata", "metrics"]) {
    assert.equal(candidate.fingerprints[key], fingerprintValue(candidate[key]), `${candidate.family}.${key} digest mismatch`);
  }
  assert.equal(candidate.fingerprints.candidate, candidate.fingerprint);
  if (candidate.rawPoints) assert.equal(candidate.fingerprints.rawPoints, fingerprintValue(candidate.rawPoints));
}

function replay(candidate) {
  // Only persisted params/config are supplied; original search provenance is
  // intentionally unavailable to this evaluator.
  const replayed = evaluateCandidate(getSystem(candidate.family), reverseKeys(candidate.parameters), reverseKeys(candidate.config));
  assert.equal(replayed.id, candidate.id, `${candidate.family} identity changed on replay`);
  assertExact(candidatePayload(replayed), candidatePayload(candidate), `${candidate.family} stored replay changed`);
  assert.equal(replayed.fingerprint, candidate.fingerprint, `${candidate.family} stored replay changed`);
  assert.deepEqual(replayed.metrics, candidate.metrics);
  assert.deepEqual(replayed.metadata, candidate.metadata);
  if (candidate.rawPoints) {
    assert.deepEqual(replayed.rawPoints, candidate.rawPoints, `${candidate.family} raw points were truncated or changed`);
    assert.deepEqual(replayed.points, candidate.points);
  }
  return replayed;
}

// Check padding boundaries, Unicode/UTF-8 replacement, and long multi-block
// messages against an independent SHA-256 implementation.
const vectors = ["", "abc", "The quick brown fox jumps over the lazy dog", "π / √2 · Hénon 🌀", "\ud800", "\udfff", "a".repeat(1_000_000),
  ...[55, 56, 63, 64, 65, 127, 128, 129].map((length) => "x".repeat(length))];
const browserHash = runInNewContext(`${readFileSync(new URL("../src/fingerprint.js", import.meta.url), "utf8").replace(/^export /gm, "")}\nsha256Hex;`);
for (const vector of vectors) {
  const expected = nodeSha256(vector);
  assert.equal(sha256Hex(vector), expected, `SHA-256 mismatch at length ${vector.length}`);
  assert.equal(browserHash(vector), expected, "SHA-256 needs a Node or browser crypto global");
}
const exactNumbers = [-0, 0, Number.MIN_VALUE, Number.MAX_VALUE, 8 / 3, 1 + Number.EPSILON, -1.2345678901234567];
roundTrip(exactNumbers).forEach((value, index) => assert.ok(Object.is(value, exactNumbers[index]), "canonical number did not round-trip exactly"));
assert.notEqual(fingerprintValue(1), fingerprintValue(1 + Number.EPSILON), "nearby doubles were rounded together");
assert.notEqual(fingerprintValue(-0), fingerprintValue(0), "signed zero was discarded");
const payload = { z: [8 / 3, { beta: 1, alpha: 2 }], a: { "10": 10, "2": 2, text: "ẋ=σ(y−x)" } };
assert.equal(canonicalSerialize(payload), canonicalSerialize(reverseKeys(payload)));
assert.equal(fingerprintValue(payload), fingerprintValue(reverseKeys(payload)));
for (const bad of [NaN, Infinity, -Infinity]) assert.throws(() => canonicalSerialize({ nested: [bad] }), /non-finite/);
for (const bad of [undefined, () => 0, Symbol("s"), 1n, new Date(), new Array(1)]) assert.throws(() => canonicalSerialize(bad), TypeError);
const cycle = {}; cycle.self = cycle;
assert.throws(() => canonicalSerialize(cycle), /cycle/);

// Parameter distance is dimensionless within a family; distinct families use
// a constant distance of 1 even when the vectors have different lengths.
const one = { family: "ikeda", parameterVector: [0.5], metrics: {} };
const six = { family: "aizawa", parameterVector: [0, 0, 0, 0, 0, 0], metrics: {} };
assert.equal(novelty(one, [six]), 0.2 / 0.35);
assert.equal(novelty(six, [one]), novelty(one, [six]));
assert.equal(novelty(one, [one]), 0);
assert.equal(novelty(one, []), 1);

const defaults = parseExploreArgs([]);
assert.equal(defaults.top, 12);
assert.equal(defaults.samplesPerFamily, 12);
assert.deepEqual(parseExploreArgs(["--families", "thomas, henon,henon", "--top", "2"]).families, ["henon", "thomas"]);
for (const args of [
  ["--samples", "0"], ["--samples", "101"], ["--samples", "6.5"], ["--samples", "Infinity"],
  ["--top", "0"], ["--top", "101"], ["--top", "8"], ["--samples", "1", "--top", "12"],
  ["--seed", "-1"], ["--seed", "4294967296"], ["--seed", "NaN"], ["--seed", ""],
  ["--seed"], ["--top", "--seed", "1"], ["--unknown", "1"], ["--seed", "1", "--seed", "2"],
  ["--families", ""], ["--families", "henon,"], ["--families", "missing"], ["--families", "all,henon"],
  ["--preview", "10001"],
]) assert.throws(() => parseExploreArgs(args), Error, `accepted invalid CLI arguments: ${args.join(" ")}`);
assert.equal(parseExploreArgs(["--seed", "4294967295"]).seed, 0xffffffff);
const invalidCli = spawnSync(process.execPath, [fileURLToPath(new URL("./explore.mjs", import.meta.url)), "--seed", "NaN"], { encoding: "utf8" });
assert.equal(invalidCli.status, 1);
assert.match(invalidCli.stderr, /EXPLORE_FAIL/);

const first = explore({ seed, samplesPerFamily, top, families });
// Locale must not participate, including in tie-breaking; family argument
// order and duplicate family names must not alter the candidate stream.
const originalLocaleCompare = String.prototype.localeCompare;
let second;
try {
  String.prototype.localeCompare = () => { throw new Error("locale-sensitive exploration ordering"); };
  second = explore({ seed, samplesPerFamily, top, families: [...families].reverse().concat(families[0]) });
} finally {
  String.prototype.localeCompare = originalLocaleCompare;
}
assertExact(first, second, "fixed-seed numerical fields changed");
assert.ok(JSON.stringify(first) === JSON.stringify(second), "fixed-seed in-memory JSON changed");
const firstJson = canonicalSerialize(first);
assert.ok(firstJson === canonicalSerialize(second), "fixed-seed artifact JSON changed");
assert.deepEqual(first.discoveries.map((candidate) => candidate.fingerprint), second.discoveries.map((candidate) => candidate.fingerprint), "ordered fingerprints changed");
assert.deepEqual(first.candidateAudit.map((candidate) => candidate.fingerprint), second.candidateAudit.map((candidate) => candidate.fingerprint));
assert.equal(first.discoveries.length, top);
assert.deepEqual([...new Set(first.discoveries.map((candidate) => candidate.family))].sort(), families);
assert.equal(first.candidateAudit.length, samplesPerFamily * families.length, "sample budget/audit is incomplete");
assert.equal(first.candidateSummary.length, first.candidateAudit.length, "compatibility summary is incomplete");
assertFiniteNumbers(first);
const stored = JSON.parse(firstJson);
assert.deepEqual(stored, first, "canonical artifact lost numeric information");
for (const candidate of stored.candidateAudit) {
  assertCandidate(candidate);
  assert.equal(Object.hasOwn(candidate, "rawPoints"), false, "rejected audit duplicates raw arrays");
  assert.equal(Object.hasOwn(candidate, "points"), false, "audit duplicates display arrays");
  if (candidate.selection) Object.values(candidate.selection).forEach((value) => assert.ok(Number.isFinite(value), "selection audit contains a non-finite number"));
}
assert.equal(stored.candidateAudit.filter((c) => c.retained).length, top);
assert.equal(stored.candidateAudit.filter((c) => !c.eligible).length, stored.search.ineligibleCandidates);
assert.equal(stored.candidateAudit.filter((c) => !c.retained).length, stored.search.rejectedCandidates);
for (const candidate of stored.discoveries) {
  assertCandidate(candidate);
  assert.equal(candidate.rawPoints.length, candidate.metadata.finiteCount);
  assert.equal(candidate.rawPoints.length, candidate.config.steps);
  assert.ok(candidate.rawPoints.length > 2400, "retained trajectory was decimated");
  assert.equal(Object.hasOwn(candidate, "preview"), false);
  for (const value of Object.values(candidate.score)) assert.ok(Number.isFinite(value), "selection persisted a NaN/null score");
  replay(candidate);
}
for (const family of families) {
  const reference = stored.candidateAudit.find((c) => c.family === family && c.provenance.stage === 0 && c.provenance.searchIndex === 0);
  assert.deepEqual(reference.parameters, getSystem(family).defaults, `${family} reference precision changed`);
  replay(reference);
}
// Also round-trip all nine complete simulator defaults, independent of the
// shorter search observation policy (not just the winning sampled candidates).
for (const system of SYSTEM_LIST) {
  const original = evaluateCandidate(system, system.defaults, { ...system.defaultConfig, seed });
  replay(roundTrip(original));
}

// Finite API parameters outside the UI box are supported. Missing analytical
// bounds/periods must not introduce Infinity into otherwise replayable records.
for (const [family, parameters, field] of [
  ["ikeda", { u: 1 }, "absorbingRadius"],
  ["ikeda", { u: 1.2 }, "absorbingRadius"],
  ["duffing", { omega: 0 }, "forcingPeriod"],
  ["duffing", { omega: Number.MIN_VALUE }, "forcingPeriod"],
]) {
  const candidate = evaluateCandidate(getSystem(family), parameters, { burnIn: 0, steps: 512 });
  assert.equal(candidate.metadata[field], null);
  assertCandidate(candidate); replay(roundTrip(candidate));
}
const negativeFrequency = evaluateCandidate(getSystem("duffing"), { omega: -2 }, { burnIn: 0, steps: 512 });
assert.equal(negativeFrequency.metadata.forcingPeriod, Math.PI);

const lorenz = stored.candidateAudit.find((candidate) => candidate.family === "lorenz");
for (const changes of [{ dt: lorenz.config.dt / 2 }, { seed: seed + 1 }, { coordinateScale: [31, 30] }, { maxPeriod: 47 }]) {
  const changed = evaluateCandidate(getSystem("lorenz"), lorenz.parameters, { ...lorenz.config, ...changes });
  assert.notEqual(changed.fingerprint, lorenz.fingerprint, `config ${JSON.stringify(changes)} did not change fingerprint`);
  assert.notEqual(changed.id, lorenz.id, "configuration was absent from identity");
}
const moved = evaluateCandidate(getSystem("lorenz"), lorenz.parameters, lorenz.config, 1, 99);
assert.equal(moved.fingerprint, lorenz.fingerprint, "search provenance leaked into numerical fingerprint");
assert.equal(moved.id, lorenz.id, "search provenance leaked into identity");
assert.notEqual(fingerprintValue(candidateIdentity({ ...lorenz, algorithmVersion: "changed" })), fingerprintValue(candidateIdentity(lorenz)));
for (const key of ["parameters", "config", "metadata", "metrics"]) {
  assert.notEqual(candidateFingerprint({ ...candidatePayload(lorenz), [key]: { ...lorenz[key], changed: 1 } }), lorenz.fingerprint, `${key} absent from fingerprint`);
}
assert.equal(candidateFingerprint(reverseKeys(candidatePayload(lorenz))), lorenz.fingerprint);
assert.throws(() => evaluateCandidate(getSystem("lorenz"), { ...lorenz.parameters, beta: NaN }, lorenz.config), /finite/);
assert.throws(() => evaluateCandidate(getSystem("lorenz"), lorenz.parameters, { ...lorenz.config, dt: Infinity }), /finite/);

const preview = explore({ seed, samplesPerFamily: 1, top: 1, families: ["henon"], previewPoints: 1 });
assert.equal(preview.discoveries[0].preview.rawPoints.length, 1);
assert.equal(preview.discoveries[0].rawPoints.length, preview.discoveries[0].config.steps);
const report = discoveryMarkdown(stored);
for (const system of SYSTEM_LIST) assert.ok(report.includes(system.equation), `report omits ${system.id} equation`);
assert.match(report, /Rejected attempts: 42/);
assert.match(report, /libm\/engine variation/);
assert.match(report, /neither|Neither/);
console.log(`REPRO_PASS sha256_vectors=${vectors.length} fixed_json=identical ordered_fingerprints=${top} defaults_replayed=${SYSTEM_LIST.length} families=${families.length} candidates=${first.candidateAudit.length} artifact_sha256=${nodeSha256(firstJson)}`);
console.log(`runtime=${canonicalSerialize(runtimeInformation())}`);
