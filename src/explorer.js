import { getSystem, SYSTEM_LIST, simulateSystem } from "./systems.js";
import { analyzeTrajectory, featureDistance } from "./metrics.js";
import { canonicalSerialize, fingerprintValue, firstDifference } from "./fingerprint.js";

export const ANALYSIS_SCALES = Object.freeze({
  henon: [2.2, 2.2],
  lorenz: [30, 30],
  duffing: [3.5, 3.5],
  ikeda: [8, 8],
  clifford: [3, 3],
  dejong: [2.2, 2.2],
  aizawa: [2.2, 2.2],
  rossler: [20, 20],
  thomas: [5, 5],
});

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19];
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const EXPLORATION_ALGORITHM_VERSION = "atlas-2026-09-repro-v3";

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hash32(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function candidateFingerprint(payload) {
  return fingerprintValue(payload);
}

export function halton(index, base) {
  let result = 0;
  let fraction = 1 / base;
  let current = index;
  while (current > 0) {
    result += fraction * (current % base);
    current = Math.floor(current / base);
    fraction /= base;
  }
  return result;
}

export function canonicalParameterObject(system, params) {
  if (params != null && (typeof params !== "object" || Array.isArray(params))) throw new TypeError("parameters must be an object");
  return Object.fromEntries(Object.keys(system.parameters).sort().map((key) => {
    const value = Number(params?.[key] ?? system.defaults[key]);
    if (!Number.isFinite(value)) throw new RangeError(`${system.id}.${key} must be finite before simulation`);
    // Match the simulator's documented legacy Ikeda clamp before hashing.
    return [key, system.id === "ikeda" && key === "u" ? clamp(value, 0, 1.2) : value];
  }));
}

export function canonicalParameters(system, params) {
  return canonicalSerialize(canonicalParameterObject(system, params));
}

export function normalizedParameters(system, params) {
  const canonical = canonicalParameterObject(system, params);
  return Object.keys(system.parameters).sort().map((key) => {
    const schema = system.parameters[key];
    return clamp((canonical[key] - schema.min) / (schema.max - schema.min), 0, 1);
  });
}

function parameterFromUnit(schema, unit) {
  const raw = schema.min + unit * (schema.max - schema.min);
  const precision = schema.step < 0.01 ? 4 : 3;
  const rounded = Number(raw.toFixed(precision));
  return clamp(rounded, schema.min, schema.max);
}

function sampleParameters(system, seed, index, stage = 0, anchor = null) {
  const keys = Object.keys(system.parameters).sort();
  const params = {};
  for (let dimension = 0; dimension < keys.length; dimension += 1) {
    const key = keys[dimension];
    const schema = system.parameters[key];
    const offset = hash32(`${seed}:${system.id}:${stage}:${index}:${key}`) % 1000;
    let unit = halton(1 + index + offset, PRIMES[dimension]);
    if (anchor) {
      const localUnit = halton(1 + index + offset, PRIMES[dimension]);
      const anchorUnit = (Number(anchor[key]) - schema.min) / (schema.max - schema.min);
      const radius = 0.16;
      unit = clamp(anchorUnit + (localUnit - 0.5) * radius, 0, 1);
    }
    params[key] = parameterFromUnit(schema, unit);
  }
  return params;
}

export function familyConfig(system, seed = 424242) {
  const base = { ...system.defaultConfig };
  const policies = {
    duffing: { steps: 7000, burnInCap: 1300 },
    lorenz: { steps: 4500, burnInCap: 900 },
    aizawa: { steps: 5200, burnInCap: 1200 },
    rossler: { steps: 5200, burnInCap: 1400 },
    thomas: { steps: 5200, burnInCap: 1400 },
  };
  const policy = policies[system.id] ?? { steps: 4200, burnInCap: 900 };
  return {
    ...base,
    steps: policy.steps,
    burnIn: Math.min(base.burnIn, policy.burnInCap),
    seed,
  };
}

function compactPoints(points, maxPoints = 2400) {
  if (points.length <= maxPoints) return points;
  if (maxPoints === 1) return points.slice(0, 1);
  const compacted = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.min(points.length - 1, Math.floor((i * (points.length - 1)) / (maxPoints - 1)));
    compacted.push(points[index]);
  }
  return compacted;
}

function canonicalConfig(system, config, seed) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new TypeError("config must be an object");
  const defaults = system.defaultConfig;
  const dimension = system.kind === "map" ? 2 : 3;
  const initial = config.initial ?? defaults.initial;
  if (!Array.isArray(initial)) throw new TypeError("initial must be an array");
  const coordinateScale = config.coordinateScale ?? ANALYSIS_SCALES[system.id];
  if (!Array.isArray(coordinateScale) || coordinateScale.length !== 2 || !coordinateScale.every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError("coordinateScale must have two positive finite values");
  }
  const integrator = system.kind === "map" ? "direct-map" : "fixed-step-rk4";
  if (config.integrator !== undefined && config.integrator !== integrator) throw new RangeError(`unsupported integrator: ${config.integrator}`);
  const result = {
    seed: validatedInteger(seed, "seed", 0, 0xffffffff),
    burnIn: Number(config.burnIn ?? defaults.burnIn),
    steps: Number(config.steps ?? defaults.steps),
    hardRadius: Number(config.hardRadius ?? defaults.hardRadius),
    initial: Array.from({ length: dimension }, (_, i) => Number(initial[i] ?? defaults.initial[i])),
    integrator,
    coordinateScale: [...coordinateScale],
    maxPeriod: validatedInteger(config.maxPeriod ?? 48, "maxPeriod", 2, 128),
    ...(system.kind === "ode" || config.dt !== undefined ? { dt: Number(config.dt ?? defaults.dt) } : {}),
  };
  canonicalSerialize(result); // Reject non-finite input before integration.
  return result;
}

export function candidatePayload(candidate) {
  return {
    schemaVersion: candidate.schemaVersion,
    algorithmVersion: candidate.algorithmVersion,
    family: candidate.family,
    equation: candidate.equation,
    parameters: candidate.parameters,
    config: candidate.config,
    metadata: candidate.metadata,
    metrics: candidate.metrics,
    trajectoryFingerprint: candidate.fingerprints.rawPoints,
  };
}

export function candidateIdentity(candidate) {
  return {
    schemaVersion: candidate.schemaVersion,
    algorithmVersion: candidate.algorithmVersion,
    family: candidate.family,
    equation: candidate.equation,
    parameters: candidate.parameters,
    config: candidate.config,
  };
}

export function evaluateCandidate(system, params = {}, config = {}, stage = 0, index = 0, seed = config.seed ?? 424242) {
  validatedInteger(stage, "stage", 0, 1);
  validatedInteger(index, "searchIndex", 0, 100);
  const canonicalParams = canonicalParameterObject(system, params);
  const simulationConfig = canonicalConfig(system, config, seed);
  const simulation = simulateSystem(system.id, canonicalParams, simulationConfig);
  const metrics = analyzeTrajectory(simulation.points, {
    requestedCount: simulation.metadata.requestedCount,
    coordinateScale: simulationConfig.coordinateScale,
    hardRadius: simulationConfig.hardRadius,
    maxPeriod: simulationConfig.maxPeriod,
    metadata: simulation.metadata,
  });
  const persistedParameters = canonicalParams;
  const persistedConfig = simulationConfig;
  const provenance = { algorithmVersion: EXPLORATION_ALGORITHM_VERSION, seed, stage, searchIndex: index };
  const fingerprints = {
    parameters: fingerprintValue(persistedParameters),
    config: fingerprintValue(persistedConfig),
    metadata: fingerprintValue(simulation.metadata),
    metrics: fingerprintValue(metrics),
    rawPoints: fingerprintValue(simulation.rawPoints),
  };
  const identity = {
    schemaVersion: 3,
    algorithmVersion: EXPLORATION_ALGORITHM_VERSION,
    family: system.id,
    equation: system.equation,
    parameters: persistedParameters,
    config: persistedConfig,
  };
  const candidate = {
    ...identity,
    metadata: simulation.metadata,
    metrics,
    fingerprints,
  };
  const fingerprint = candidateFingerprint(candidatePayload(candidate));
  const id = `${system.id}-${fingerprintValue(candidateIdentity(candidate))}`;
  return {
    ...candidate,
    id,
    familyName: system.name,
    parameterVector: normalizedParameters(system, persistedParameters),
    provenance,
    fingerprint,
    fingerprints: { ...fingerprints, candidate: fingerprint },
    score: metrics.score,
    class: metrics.classification,
    points: simulation.points,
    rawPoints: simulation.rawPoints,
  };
}

function totalOrder(a, b) {
  return b.metrics.score - a.metrics.score || lexicalCompare(a.family, b.family) || lexicalCompare(a.id, b.id)
    || a.provenance.stage - b.provenance.stage || a.provenance.searchIndex - b.provenance.searchIndex;
}

function familyDistance(candidate, other) {
  if (candidate.family !== other.family) return 1;
  const left = candidate.parameterVector;
  const right = other.parameterVector;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0
    || !left.every(Number.isFinite) || !right.every(Number.isFinite)) {
    throw new RangeError("same-family parameter vectors must have equal nonzero length and finite values");
  }
  return Math.sqrt(left.reduce((sum, value, index) => {
    const delta = value - right[index];
    return sum + delta * delta;
  }, 0) / left.length);
}

export function novelty(candidate, selected) {
  if (!selected.length) return 1;
  const distances = selected.map((other) => {
    const feature = featureDistance(candidate.metrics, other.metrics);
    return 0.8 * feature + 0.2 * familyDistance(candidate, other);
  });
  return clamp(Math.min(...distances) / 0.35);
}

export function retainDiverse(candidates, limit, familyIds) {
  const eligible = candidates
    .filter((candidate) => candidate.metrics.score > 0 && candidate.class !== "divergent")
    .sort(totalOrder);
  const selected = [];
  const remaining = new Set(eligible.map((candidate) => candidate.id));

  const addCandidate = (candidate) => {
    const candidateNovelty = novelty(candidate, selected);
    selected.push({
      ...candidate,
      score: {
        baseScore: candidate.metrics.score,
        novelty: candidateNovelty,
        finalSelectionScore: 0.8 * (candidate.metrics.score / 100) + 0.2 * candidateNovelty,
      },
    });
    remaining.delete(candidate.id);
  };

  // Reserve one strong candidate per family before filling the remaining slots.
  // This prevents a single family from crowding out the atlas coverage goal.
  for (const family of [...new Set(familyIds)].sort(lexicalCompare)) {
    const familyCandidate = eligible.find((candidate) => candidate.family === family && remaining.has(candidate.id));
    if (familyCandidate && selected.length < limit) addCandidate(familyCandidate);
  }

  while (selected.length < limit && remaining.size) {
    const ranked = eligible
      .filter((candidate) => remaining.has(candidate.id))
      .map((candidate) => {
        const candidateNovelty = novelty(candidate, selected);
        return { candidate, candidateNovelty, value: 0.8 * (candidate.metrics.score / 100) + 0.2 * candidateNovelty };
      })
      .sort((a, b) => b.value - a.value || totalOrder(a.candidate, b.candidate));
    const next = ranked[0];
    if (!next) break;
    selected.push({
      ...next.candidate,
      score: {
        baseScore: next.candidate.metrics.score,
        novelty: next.candidateNovelty,
        finalSelectionScore: next.value,
      },
    });
    remaining.delete(next.candidate.id);
  }

  return selected.sort((a, b) => b.metrics.score - a.metrics.score || lexicalCompare(a.id, b.id)).slice(0, limit);
}

function validatedInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  return value;
}

export function normalizeFamilies(families = "all") {
  const requested = families === "all" ? SYSTEM_LIST.map((system) => system.id) : families;
  if (!Array.isArray(requested) || requested.length === 0) throw new RangeError("families must contain at least one system");
  if (requested.some((id) => typeof id !== "string" || !id.trim())) throw new RangeError("families must contain valid nonempty family ids");
  const ids = [...new Set(requested.map((id) => id.trim()))].sort(lexicalCompare);
  if (!ids.length) throw new RangeError("families must contain at least one system");
  return ids.map((id) => getSystem(id));
}

export function validateExplorationOptions({ seed = 424242, samplesPerFamily = 12, top = 12, families = "all", previewPoints = 0 } = {}) {
  validatedInteger(seed, "seed", 0, 0xffffffff);
  validatedInteger(samplesPerFamily, "samplesPerFamily", 1, 100);
  validatedInteger(top, "top", 1, 100);
  validatedInteger(previewPoints, "previewPoints", 0, 10000);
  const chosen = normalizeFamilies(families);
  if (top < chosen.length) throw new RangeError(`top must be at least ${chosen.length} for family coverage`);
  if (top > samplesPerFamily * chosen.length) throw new RangeError("top cannot exceed the candidate budget");
  return { seed, samplesPerFamily, top, families: chosen.map((system) => system.id), previewPoints };
}

export function runtimeInformation() {
  if (typeof process !== "undefined" && process.versions?.node) {
    return { runtime: "Node.js", version: process.version, engine: "V8", engineVersion: process.versions.v8, platform: process.platform, architecture: process.arch };
  }
  return { runtime: "browser", userAgent: typeof navigator === "undefined" ? "unavailable" : navigator.userAgent };
}

export function explore(options = {}) {
  const { seed, samplesPerFamily, top, families, previewPoints } = validateExplorationOptions(options);
  const chosen = normalizeFamilies(families);
  const allCandidates = [];
  // Audit records are kept for every attempt; trajectories are released after
  // scoring. Only retained candidates are re-simulated for full persistence.
  const auditCandidate = (...args) => {
    const { points, rawPoints, ...record } = evaluateCandidate(...args);
    allCandidates.push(record);
    return record;
  };
  for (const system of chosen) {
    const coarseCount = Math.min(samplesPerFamily, Math.max(1, Math.floor(samplesPerFamily * 0.7)));
    const coarse = [];
    for (let index = 0; index < coarseCount; index += 1) {
      const params = index === 0 ? { ...system.defaults } : sampleParameters(system, seed, index, 0);
      const candidate = auditCandidate(system, params, familyConfig(system, seed), 0, index, seed);
      coarse.push(candidate);
    }
    const elites = coarse.sort(totalOrder).slice(0, Math.min(3, coarse.length));
    for (let index = 0; index < samplesPerFamily - coarseCount; index += 1) {
      const elite = elites[index % elites.length];
      const params = sampleParameters(system, seed, index, 1, elite.parameters);
      const candidate = auditCandidate(system, params, familyConfig(system, seed), 1, index, seed);
      candidate.provenance.anchorId = elite.id;
    }
  }
  const discoveries = retainDiverse(allCandidates, top, chosen.map((system) => system.id)).map((candidate) => {
    const replay = evaluateCandidate(getSystem(candidate.family), candidate.parameters, candidate.config);
    if (replay.fingerprint !== candidate.fingerprint) {
      throw new Error(`retained replay mismatch: ${candidate.id}; ${firstDifference(candidatePayload(candidate), candidatePayload(replay))}`);
    }
    return {
      ...candidate,
      points: replay.points,
      rawPoints: replay.rawPoints,
      ...(previewPoints ? { preview: { method: "uniform-index", points: compactPoints(replay.points, previewPoints), rawPoints: compactPoints(replay.rawPoints, previewPoints) } } : {}),
    };
  });
  const familyStats = chosen.map((system) => {
    const candidates = allCandidates.filter((candidate) => candidate.family === system.id);
    const first = candidates[0];
    const eligible = candidates.filter((candidate) => candidate.metrics.score > 0 && candidate.class !== "divergent").length;
    const config = first?.config ?? {};
    return {
      family: system.id,
      familyName: system.name,
      equation: system.equation,
      evaluated: candidates.length,
      eligible,
      ineligible: candidates.length - eligible,
      retained: discoveries.filter((candidate) => candidate.family === system.id).length,
      rejected: candidates.length - discoveries.filter((candidate) => candidate.family === system.id).length,
      burnIn: config.burnIn,
      steps: config.steps,
      sampleDuration: config.dt === undefined ? config.steps : config.steps * config.dt,
      burnInDuration: config.dt === undefined ? config.burnIn : config.burnIn * config.dt,
      durationUnit: system.kind === "map" ? "iterations" : "model-time units",
      hardRadius: config.hardRadius,
      initial: config.initial,
      integrator: config.integrator,
      coordinateScale: [...ANALYSIS_SCALES[system.id]],
      ...(config.dt === undefined ? {} : { dt: config.dt }),
    };
  });
  return {
    schemaVersion: 3,
    algorithmVersion: EXPLORATION_ALGORITHM_VERSION,
    generatedAt: `deterministic-seed-${seed}`,
    seed,
    runtime: runtimeInformation(),
    search: {
      families: chosen.map((system) => system.id),
      requestedSamplesPerFamily: samplesPerFamily,
      evaluatedCandidates: allCandidates.length,
      retainedCandidates: discoveries.length,
      rejectedCandidates: allCandidates.length - discoveries.length,
      ineligibleCandidates: familyStats.reduce((sum, family) => sum + family.ineligible, 0),
      eligibleUnselectedCandidates: familyStats.reduce((sum, family) => sum + family.eligible - family.retained, 0),
      top,
      algorithm: "Halton coverage + deterministic elite-local refinement + diversity retention",
      provenance: { seed, algorithmVersion: EXPLORATION_ALGORITHM_VERSION, previewPoints },
      familyStats,
    },
    discoveries,
    // Compatibility summary for consumers that only need ranking metadata;
    // full configs/metrics/metadata live in candidateAudit below.
    candidateSummary: allCandidates.map((candidate) => ({
      id: candidate.id,
      family: candidate.family,
      score: candidate.metrics.score,
      class: candidate.class,
      parameters: candidate.parameters,
      fingerprint: candidate.fingerprint,
    })),
    candidateAudit: allCandidates.map((candidate) => {
      const eligible = candidate.metrics.score > 0 && candidate.class !== "divergent";
      const selection = discoveries.find((item) => item.id === candidate.id && item.provenance === candidate.provenance)?.score ?? null;
      const retained = selection !== null;
      return {
        ...candidate,
        eligible,
        retained,
        selection,
        rejectionReason: retained ? null : eligible ? "diversity-budget-or-duplicate" : candidate.metrics.invalidReason ?? candidate.class,
      };
    }),
  };
}

export function discoveryMarkdown(result) {
  const lines = [
    "# Exploration report",
    "",
    "- Seed: `" + result.seed + "`",
    `- Families: ${result.search.families.join(", ")}`,
    `- Evaluated candidates: ${result.search.evaluatedCandidates}`,
    `- Retained discoveries: ${result.discoveries.length}`,
    `- Rejected attempts: ${result.search.rejectedCandidates} (${result.search.ineligibleCandidates} ineligible; ${result.search.eligibleUnselectedCandidates} eligible but not selected or duplicate)`,
    `- Requested candidates per family: ${result.search.requestedSamplesPerFamily} (including each reference parameter set)`,
    `- Algorithm: ${result.algorithmVersion}`,
    `- Runtime/platform: \`${canonicalSerialize(result.runtime)}\``,
    `- Search: ${result.search.algorithm}`,
    "",
    "## Equations and observation windows",
    "",
    "Primes in map equations denote the next iteration; dots denote derivatives in model-time units. ODE observations are uniformly sampled phase trajectories, not Poincaré sections. Durations below are requested; a diverging attempt can terminate early, as recorded in its metadata.",
    "",
    "| Family | Equation | Integrator | Burn-in steps / duration | Retained steps / duration | dt | Analysis scale (x, y) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...result.search.familyStats.map((family) => `| ${family.familyName} | ${family.equation} | ${family.integrator} | ${family.burnIn} / ${family.burnInDuration} ${family.durationUnit} | ${family.steps} / ${family.sampleDuration} ${family.durationUnit} | ${family.dt ?? "not applicable"} | ${family.coordinateScale.join(", ")} |`),
    "",
    "## Candidate accounting",
    "",
    "| Family | Evaluated | Ineligible | Eligible unselected / duplicate | Retained | Total rejected |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...result.search.familyStats.map((family) => `| ${family.family} | ${family.evaluated} | ${family.ineligible} | ${family.eligible - family.retained} | ${family.retained} | ${family.rejected} |`),
    "",
    "## Retained structures",
    "",
    "| Rank | Family | Class | Score | Parameters |",
    "| ---: | --- | --- | ---: | --- |",
  ];
  result.discoveries.forEach((candidate, index) => {
    lines.push(`| ${index + 1} | ${candidate.familyName} | ${candidate.class} | ${candidate.metrics.score.toFixed(2)} | ${Object.entries(candidate.parameters).map(([key, value]) => `${key}=${value}`).join(", ")} |`);
  });
  lines.push("", "## Reproduction", "", "```sh", `node scripts/explore.mjs --families ${result.search.families.join(",")} --samples ${result.search.requestedSamplesPerFamily} --top ${result.search.top} --seed ${result.seed} --preview ${result.search.provenance.previewPoints}`, "node scripts/repro-test.mjs", "```", "",
    "`data/discoveries.json` contains the complete candidateAudit (all attempted parameters, resolved configs, metrics, metadata, provenance, component SHA-256 digests and rejection reasons). Every retained discovery has full post-burn-in points and rawPoints; previews, if requested, are separate. Rejected trajectories are released after hashing and can be regenerated from their audit records.",
    "",
    "Replay a stored record with evaluateCandidate(getSystem(record.family), record.parameters, record.config); search stage/index are not part of numerical identity. Seed, algorithm version, equations, parameters, config, metadata, metrics, and a full raw-trajectory digest determine the candidate fingerprint. Key insertion order has no effect; no number is rounded during canonical serialization.",
    "",
    "## Interpretation and limitations", "",
    "This is an exploratory heuristic ranking of finite, projected trajectories. Family reservations can retain low-complexity or transient candidates with positive scores; the table reports their actual classes. Rejection can mean either invalid dynamics or a limited diversity budget. Neither a high score nor a bounded finite observation proves chaos, an attractor, asymptotic boundedness, or convergence of the integrator. No Lyapunov exponent or independent uncertainty estimate is computed here.",
    "",
    "Analysis uses the unclipped x-y projection with fixed family scales, multiple occupancy grids, and maxPeriod=48. Spatial ODE rawPoints retain z; Duffing rawPoints contain x and velocity, with forcing time reconstructed from the persisted initial state and dt. Short burn-in, finite durations, projection, chosen scales, and parameter-box/score tuning can bias this ranking. Longer observations, step refinement, alternate projections and independent parameter/initial-state searches are needed to test robustness.",
    "",
    "Exact SHA-256 agreement is a regression/replay check on the same source version, JS runtime/engine and platform. SHA-256 itself is portable and checked against Node crypto. Transcendental Math functions (libm/engine variation), floating-point sensitivity and long chaotic trajectories can differ across browsers, CPU architectures or runtime versions; matching seeds do not guarantee cross-platform bit identity. Runtime details are stored separately from numerical fingerprints. The JSON uses deterministic key ordering and contains no wall-clock timestamp or measured run time.");
  return `${lines.join("\n")}\n`;
}
