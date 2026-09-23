import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { analyzeTrajectory, spectralMetrics } from "../src/metrics.js";
import { simulateSystem } from "../src/systems.js";

const SCALE_SIZES = [8, 12, 16, 24, 32, 48];

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function circle(count = 1200, [cx, cy] = [0, 0], radius = 0.72) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

function noisySquare(count = 1200, seed = 9) {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () => [2 * random() - 1, 2 * random() - 1]);
}

function thinLine(count = 1200) {
  return Array.from({ length: count }, (_, i) => {
    const x = -0.92 + (1.84 * i) / (count - 1);
    return [x, 0.02 * Math.sin(i * 0.13)];
  });
}

function clippedDivergence(count = 1200) {
  return Array.from({ length: count }, (_, i) => {
    const raw = 0.3 + i * 0.12;
    return [Math.max(-1, Math.min(1, raw)), Math.max(-1, Math.min(1, raw * 0.7))];
  });
}

function richThenFixed() {
  const rich = simulateSystem("henon", { a: 1.4, b: 0.3 }, { burnIn: 400, steps: 500, hardRadius: 30 }).points;
  return rich.concat(Array.from({ length: 700 }, () => [0.2, 0.2]));
}

function withInvalidPoints(points, point, count = 1) {
  const result = points.slice();
  for (let index = 0; index < count; index += 1) result[index * Math.max(1, Math.floor(result.length / count))] = point;
  return result;
}

function naiveScore(points) {
  const cells = new Set(points
    .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map(([x, y]) => `${Math.floor((x + 1) * 16)}:${Math.floor((y + 1) * 16)}`));
  return Math.min(100, (cells.size / 256) * 60 + (points.length ? 40 : 0));
}

function assertFiniteTree(value, path = "metrics") {
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${path} is non-finite: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteTree(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) assertFiniteTree(entry, `${path}.${key}`);
  }
}

function assertRatio(value, label) {
  assert(Number.isFinite(value), `${label} is not finite`);
  assert(value >= -1e-12 && value <= 1 + 1e-12, `${label} outside [0,1]: ${value}`);
}

function assertMetricPolicy(metrics, fixture) {
  assertFiniteTree(metrics, `${fixture.id}.metrics`);
  const ratioKeys = [
    "finiteRatio", "validRatio", "hardEscapeRatio", "occupancy", "entropy", "periodicity", "symmetry",
    "spectrumStructure", "spectralEntropy", "top4Share", "highFrequencyShare", "radialBandCoverage",
    "stability", "scaleConsistency", "transientPenalty", "tailCollapse", "tailFixedCollapse", "collapsePenalty",
    "divergencePenalty", "fixedCollapse", "lineCollapse", "circleCollapse", "largestComponentRatio", "compactness",
    "orderCoherence", "growthRisk", "noiseRisk", "missingRatio", "structureScore",
  ];
  ratioKeys.forEach((key) => assertRatio(metrics[key], `${fixture.id}.${key}`));
  for (const key of ["occupancyByScale", "entropyByScale"]) {
    assert.deepEqual(metrics.scaleSizes, SCALE_SIZES, `${fixture.id}.${key} scale declaration`);
    assert.equal(metrics[key].length, SCALE_SIZES.length, `${fixture.id}.${key} length`);
    metrics[key].forEach((value, index) => assertRatio(value, `${fixture.id}.${key}[${index}]`));
  }
  for (const [key, value] of Object.entries(metrics.scoreComponents)) assertRatio(value, `${fixture.id}.scoreComponents.${key}`);
  assert.equal(metrics.score, Math.max(0, Math.min(100, metrics.score)), `${fixture.id}.score clamped`);
}

function expectClass(expected) {
  return (metrics, fixture) => assert.equal(metrics.classification, expected, `${fixture.id} classification`);
}

function expectZeroDivergent(metrics, fixture) {
  assert.equal(metrics.classification, "divergent", `${fixture.id} classification`);
  assert.equal(metrics.score, 0, `${fixture.id} score`);
  assert.equal(metrics.divergencePenalty, 1, `${fixture.id} divergence penalty`);
}

function independentSpectrum(counts, n) {
  const powers = [];
  for (let u = 0; u < n; u += 1) {
    for (let v = 0; v < n; v += 1) {
      if (u === 0 && v === 0) continue;
      let real = 0;
      let imaginary = 0;
      for (let x = 0; x < n; x += 1) {
        for (let y = 0; y < n; y += 1) {
          const angle = (2 * Math.PI * (u * x + v * y)) / n;
          const value = counts[y * n + x];
          real += value * Math.cos(angle);
          imaginary -= value * Math.sin(angle);
        }
      }
      powers.push({ power: real * real + imaginary * imaginary, radius: Math.hypot(u <= n / 2 ? u : n - u, v <= n / 2 ? v : n - v) });
    }
  }
  const totalPower = powers.reduce((sum, item) => sum + item.power, 0);
  powers.sort((a, b) => b.power - a.power);
  const probabilities = powers.map((item) => item.power / totalPower);
  const spectralEntropy = -probabilities.reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(probabilities.length);
  const top4Share = probabilities.slice(0, 4).reduce((sum, p) => sum + p, 0);
  const maxRadius = Math.hypot(n / 2, n / 2);
  const highFrequencyShare = powers.filter((item) => item.radius > maxRadius * 0.65).reduce((sum, item) => sum + item.power, 0) / totalPower;
  const bands = 6;
  const bandEnergy = Array.from({ length: bands }, () => 0);
  for (const item of powers) bandEnergy[Math.min(bands - 1, Math.floor((item.radius / maxRadius) * bands))] += item.power / totalPower;
  const radialBandCoverage = bandEnergy.filter((energy) => energy >= 0.035).length / bands;
  const band = (value, centre, width) => Math.exp(-0.5 * ((value - centre) / width) ** 2);
  return { spectralEntropy, top4Share, highFrequencyShare, radialBandCoverage, structure: top4Share * radialBandCoverage * band(highFrequencyShare, 0.18, 0.18) };
}

const structuredSimulation = simulateSystem("henon", { a: 1.4, b: 0.3 }, { burnIn: 500, steps: 2200, hardRadius: 30 });
const common = { coordinateScale: [1, 1], hardRadius: 10, maxPeriod: 48 };
const fixtures = [
  {
    id: "canonical-henon",
    points: structuredSimulation.points,
    options: { coordinateScale: [2.2, 2.2], hardRadius: 30, metadata: structuredSimulation.metadata },
    expectedClass: "structured",
    check: (metrics, fixture) => {
      assert.equal(metrics.classification, "structured", `${fixture.id} classification`);
      assert(metrics.score >= 20, `${fixture.id} score must remain meaningfully positive: ${metrics.score}`);
    },
  },
  { id: "fixed-point", points: Array.from({ length: 1200 }, () => [0.2, 0.2]), expectedClass: "trivial", check: expectClass("trivial") },
  {
    id: "translated-circle",
    points: circle(1200, [0.35, -0.22]),
    expectedClass: "trivial",
    check: (metrics, fixture) => {
      assert.equal(metrics.classification, "trivial", `${fixture.id} classification`);
      assert(metrics.circleCollapse > 0.78, `${fixture.id} must expose ring collapse`);
    },
  },
  {
    id: "noisy-square",
    points: noisySquare(),
    expectedClass: "bounded-low-complexity",
    check: (metrics, fixture) => {
      assert.notEqual(metrics.classification, "structured", `${fixture.id} must not be structured noise`);
      assert(metrics.noiseRisk > 0.25, `${fixture.id} noise risk`);
    },
  },
  { id: "thin-line", points: thinLine(), expectedClass: "trivial", check: expectClass("trivial") },
  {
    id: "clipped-divergence",
    points: clippedDivergence(),
    options: { clipApplied: true, metadata: { clipApplied: true, bounded: false } },
    expectedClass: "divergent",
    check: expectZeroDivergent,
  },
  {
    id: "one-percent-nan",
    points: withInvalidPoints(circle(), [Number.NaN, 0], 12),
    expectedClass: "divergent",
    check: (metrics, fixture) => {
      expectZeroDivergent(metrics, fixture);
      assert.equal(metrics.finiteRatio, 0.99, `${fixture.id} finite ratio`);
    },
  },
  {
    id: "nonfinite-final",
    points: circle().slice(0, -1).concat([[Infinity, 0]]),
    expectedClass: "divergent",
    check: expectZeroDivergent,
  },
  {
    id: "finite-overflow",
    points: Array.from({ length: 1200 }, () => [Number.MAX_VALUE, Number.MAX_VALUE]),
    options: { coordinateScale: [Number.MIN_VALUE, Number.MIN_VALUE], hardRadius: Number.MAX_VALUE },
    expectedClass: "divergent",
    check: (metrics, fixture) => {
      expectZeroDivergent(metrics, fixture);
      assert.equal(metrics.normalizationOverflow, true, `${fixture.id} normalization overflow`);
    },
  },
  {
    id: "short-missing",
    points: circle(1000),
    requestedCount: 1200,
    expectedClass: "transient",
    check: (metrics, fixture) => {
      assert.equal(metrics.classification, "transient", `${fixture.id} classification`);
      assert.equal(metrics.score, 0, `${fixture.id} score`);
      assert(metrics.finiteRatio < 1, `${fixture.id} missing ratio`);
    },
  },
  {
    id: "requested-count-underflow",
    points: circle(),
    requestedCount: 100,
    expectedClass: "trivial",
    check: (metrics, fixture) => {
      assert.equal(metrics.finiteRatio, 1, `${fixture.id} finite ratio capped`);
      assert(metrics.finiteRatio <= 1 && metrics.validRatio <= 1, `${fixture.id} ratios capped`);
    },
  },
  {
    id: "metadata-divergence",
    points: circle(),
    options: { metadata: { diverged: true, bounded: false, divergedAt: 17 } },
    expectedClass: "divergent",
    check: (metrics, fixture) => {
      expectZeroDivergent(metrics, fixture);
      assert.equal(metrics.metadataDivergence, true, `${fixture.id} metadata flag`);
    },
  },
  {
    id: "rich-then-fixed",
    points: richThenFixed(),
    expectedClass: "transient",
    check: (metrics, fixture) => {
      assert.equal(metrics.classification, "transient", `${fixture.id} classification`);
      assert.equal(metrics.score, 0, `${fixture.id} score`);
      assert(metrics.tailCollapse > 0.72, `${fixture.id} tail collapse`);
    },
  },
  {
    id: "invalid-scale-zero",
    points: circle(),
    options: { coordinateScale: [0, 1] },
    expectedClass: "divergent",
    check: (metrics, fixture) => {
      expectZeroDivergent(metrics, fixture);
      assert.equal(metrics.invalidReason, "coordinate-scale-positive-finite", `${fixture.id} controlled reason`);
    },
  },
  {
    id: "invalid-scale-nan",
    points: circle(),
    options: { coordinateScale: [Number.NaN, 1] },
    expectedClass: "divergent",
    check: (metrics, fixture) => {
      expectZeroDivergent(metrics, fixture);
      assert.equal(metrics.invalidReason, "coordinate-scale-positive-finite", `${fixture.id} controlled reason`);
    },
  },
  {
    id: "empty",
    points: [],
    expectedClass: "divergent",
    check: expectZeroDivergent,
  },
];

// Positive-score references keep hardening from degenerating into an
// all-zero policy. These cover every simulator family that currently feeds
// the explorer; the explicit metadata path is exercised for each one.
const familyReferences = [
  ["lorenz", { sigma: 10, rho: 28, beta: 8 / 3 }, { burnIn: 1800, steps: 9000, hardRadius: 120 }, [30, 30], "structured", 15],
  ["duffing", { delta: 0.2, alpha: -1, beta: 1, gamma: 0.3, omega: 1 }, { burnIn: 2500, steps: 18000, hardRadius: 80 }, [3.5, 3.5], "structured", 15],
  ["ikeda", { u: 0.9 }, { burnIn: 700, steps: 9000, hardRadius: 160 }, [8, 8], "structured", 15],
  ["clifford", { a: -1.4, b: 1.6, c: 1, d: 0.7 }, { burnIn: 800, steps: 9000, hardRadius: 10 }, [2.5, 2.5], "structured", 15],
  ["dejong", { a: 1.641, b: 1.902, c: 0.316, d: 1.525 }, { burnIn: 800, steps: 9000, hardRadius: 10 }, [2.5, 2.5], "structured", 15],
  ["aizawa", { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 }, { burnIn: 1800, steps: 9000, hardRadius: 20 }, [2, 2], "structured", 15],
  ["rossler", { a: 0.2, b: 0.2, c: 5.7 }, { burnIn: 2500, steps: 10000, hardRadius: 160 }, [15, 15], "structured", 15],
  ["thomas", { b: 0.208186 }, { burnIn: 2500, steps: 10000, hardRadius: 20 }, [5, 5], "structured", 15],
].map(([system, params, config, coordinateScale, expectedClass, minScore]) => {
  const simulation = simulateSystem(system, params, config);
  return {
    id: `family-${system}`,
    points: simulation.points,
    requestedCount: simulation.metadata.requestedCount,
    options: { coordinateScale, hardRadius: config.hardRadius, metadata: simulation.metadata, maxPeriod: 48 },
    expectedClass,
    minScore,
    check: (metrics, fixture) => {
      assert.equal(metrics.classification, fixture.expectedClass, `${fixture.id} classification`);
      assert(metrics.score >= fixture.minScore, `${fixture.id} positive score: ${metrics.score}`);
    },
  };
});
fixtures.push(...familyReferences);

function analyseFixture(fixture) {
  const options = {
    ...common,
    requestedCount: fixture.requestedCount ?? fixture.options?.metadata?.requestedCount ?? fixture.points.length,
    ...(fixture.options ?? {}),
  };
  const first = analyzeTrajectory(fixture.points, options);
  const second = analyzeTrajectory(fixture.points, options);
  assert.deepEqual(second, first, `${fixture.id} must be deterministic`);
  assertMetricPolicy(first, fixture);
  assert.equal(first.classification, fixture.expectedClass, `${fixture.id} expected policy`);
  fixture.check(first, fixture);
  return first;
}

const scored = fixtures.map((fixture) => ({
  id: fixture.id,
  expectedClass: fixture.expectedClass,
  naiveScore: naiveScore(fixture.points),
  metrics: analyseFixture(fixture),
})).map((entry) => ({
  ...entry,
  actualClass: entry.metrics.classification,
  score: entry.metrics.score,
  collapsePenalty: entry.metrics.collapsePenalty,
  divergencePenalty: entry.metrics.divergencePenalty,
  transientPenalty: entry.metrics.transientPenalty,
}));

const structured = scored.find((entry) => entry.id === "canonical-henon");
const translatedCircle = scored.find((entry) => entry.id === "translated-circle");
const noisy = scored.find((entry) => entry.id === "noisy-square");
assert(translatedCircle.score < structured.score, "translated circle must not outrank canonical Hénon");
assert(noisy.score < structured.score, "noise must not outrank canonical Hénon");

const spectrumGrid = new Float64Array(64);
for (let i = 0; i < spectrumGrid.length; i += 1) spectrumGrid[i] = ((i * 17 + 3) % 11) + (i % 9 === 0 ? 4 : 0);
const optimizedSpectrum = spectralMetrics(spectrumGrid, 8);
const referenceSpectrum = independentSpectrum(spectrumGrid, 8);
for (const key of Object.keys(referenceSpectrum)) {
  assert(Math.abs(optimizedSpectrum[key] - referenceSpectrum[key]) < 1e-10, `separable DFT mismatch for ${key}`);
}

const report = {
  schemaVersion: 2,
  methodology: "deterministic policy fixtures plus bounded multi-signal scorer",
  structuredReference: {
    family: "henon",
    parameters: { a: 1.4, b: 0.3 },
    score: structured.score,
    class: structured.actualClass,
  },
  scaleSizes: SCALE_SIZES,
  fixtures: scored,
  checks: {
    deterministic: true,
    allMetricsFinite: true,
    ratiosClamped: true,
    separableDftReference: true,
    translatedCircleBelowReference: true,
    noiseBelowReference: true,
  },
  improvements: [
    "Any malformed point, explicit clipping, hard escape, normalization overflow, or metadata divergence receives a zero score.",
    "Requested counts are clamped by the observed sample count so ratios cannot exceed one; missing requested samples are transient.",
    "Occupancy and entropy are emitted at 8, 12, 16, 24, 32, and 48 cells per side.",
    "Growth, block drift, and suffix variance expose expanding trajectories and rich-then-fixed tail collapse.",
    "Centroid-based radial diagnostics make translated circles collapse as rings rather than rewarding their position.",
    "The grid DFT is separable O(n^3), with an independent numeric reference in this holdout.",
  ],
};
await mkdir("data", { recursive: true });
await writeFile("data/adversarial-report.json", `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  "# Adversarial evaluation",
  "",
  `Reference Hénon score: ${structured.score.toFixed(2)} (${structured.actualClass})`,
  `Scale diagnostics: ${SCALE_SIZES.join(", ")} cells per side`,
  "",
  "| Fixture | Expected | Actual | Naive | Final | Key penalties |",
  "| --- | --- | --- | ---: | ---: | ---: |",
];
for (const entry of scored) {
  lines.push(`| ${entry.id} | ${entry.expectedClass} | ${entry.actualClass} | ${entry.naiveScore.toFixed(1)} | ${entry.score.toFixed(2)} | ${(entry.collapsePenalty + entry.divergencePenalty + entry.transientPenalty).toFixed(2)} |`);
}
lines.push(
  "",
  "Every fixture performs its own class/score policy assertion; aggregate pass counts are not used as a substitute.",
  "",
  "## Limitations",
  "",
  "These are deterministic heuristics, not proofs of chaos, fractal dimension, or Lyapunov exponents. A bounded structure outside its declared coordinate scale can score poorly, while a novel structure can resemble a protected collapse family. Metadata divergence is trusted as an explicit simulator contract signal; unlabeled domain-specific failure modes remain the simulator's responsibility.",
);
await writeFile("data/adversarial-report.md", `${lines.join("\n")}\n`);
console.log(`ADVERSARIAL_PASS metrics=complete fixtures=${scored.length} dft=separable`);
console.log(`reference_score=${structured.score.toFixed(2)} reference_class=${structured.actualClass}`);
for (const entry of scored) console.log(`fixture=${entry.id} expected=${entry.expectedClass} actual=${entry.actualClass} score=${entry.score.toFixed(2)}`);
