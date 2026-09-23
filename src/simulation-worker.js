import { SYSTEMS, simulateSystem } from "./systems.js";
import { analyzeTrajectory } from "./metrics.js";
import { ANALYSIS_SCALES } from "./explorer.js";

/** Pure worker entry, also callable in Node by the verification driver. */
export function simulateAtlasRequest({ id, familyId, params = {}, config = {} }) {
  const system = SYSTEMS[familyId];
  if (!system) throw new Error(`Unknown system: ${familyId}`);
  const boundedConfig = {
    ...system.defaultConfig,
    ...config,
    steps: Math.max(256, Math.min(30000, Math.floor(Number(config.steps) || 9000))),
    burnIn: Math.max(0, Math.min(12000, Math.floor(Number(config.burnIn ?? system.defaultConfig.burnIn) || 0))),
  };
  const result = simulateSystem(familyId, params, boundedConfig);
  const metrics = analyzeTrajectory(result.points, {
    requestedCount: result.metadata.requestedCount,
    coordinateScale: ANALYSIS_SCALES[familyId] ?? system.coordinateScale ?? ({ clifford: [4, 4], dejong: [2.2, 2.2], aizawa: [2, 2], rossler: [15, 15], thomas: [5, 5] }[familyId]) ?? [4, 4],
    hardRadius: boundedConfig.hardRadius,
    maxPeriod: 48,
    metadata: result.metadata,
  });
  return { id, familyId, ...result, metrics, config: boundedConfig };
}

// Importable without a browser. Never start a simulation at module evaluation.
if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof document === "undefined") {
  self.addEventListener("message", ({ data }) => {
    try { self.postMessage({ type: "result", ...simulateAtlasRequest(data) }); }
    catch (error) { self.postMessage({ type: "error", id: data?.id, message: error.message }); }
  });
}
