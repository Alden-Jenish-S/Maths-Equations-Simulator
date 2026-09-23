import assert from "node:assert/strict";
import { MAX_SIMULATION_ITERATIONS, SYSTEM_LIST, simulateSystem } from "../src/systems.js";
import { CURVE_LIST, sampleCurve } from "../src/art-modes.js";

const references = [
  ["henon", { a: 1.4, b: 0.3 }, { steps: 1400, burnIn: 300, hardRadius: 30 }],
  ["lorenz", { sigma: 10, rho: 28, beta: 8 / 3 }, { steps: 1600, burnIn: 300, dt: 0.01, hardRadius: 120 }],
  ["duffing", { delta: 0.2, alpha: -1, beta: 1, gamma: 0.3, omega: 1 }, { steps: 1800, burnIn: 500, dt: 0.02, hardRadius: 80 }],
  ["ikeda", { u: 0.918 }, { steps: 1600, burnIn: 300, hardRadius: 160 }],
  ["clifford", { a: -1.4, b: 1.6, c: 1, d: 0.7 }, { steps: 1200, burnIn: 200, hardRadius: 10 }],
  ["dejong", { a: 1.641, b: 1.902, c: 0.316, d: 1.525 }, { steps: 1200, burnIn: 200, hardRadius: 10 }],
  ["aizawa", { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 }, { steps: 1600, burnIn: 300, dt: 0.01, hardRadius: 20 }],
  ["rossler", { a: 0.2, b: 0.2, c: 5.7 }, { steps: 1600, burnIn: 300, dt: 0.01, hardRadius: 160 }],
  ["thomas", { b: 0.208186 }, { steps: 1600, burnIn: 300, dt: 0.02, hardRadius: 20 }],
];

const odeReferences = references.filter(([id]) => ["lorenz", "duffing", "aizawa", "rossler", "thomas"].includes(id));

function close(actual, expected, tolerance = 1e-12) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected));
}

function endpointDistance(first, second) {
  assert.ok(first && second, "convergence trajectories need endpoints");
  assert.equal(first.length, second.length, "convergence states must have equal dimension");
  return Math.hypot(...first.map((value, index) => value - second[index]));
}

function finiteTrajectory(result, id) {
  assert.ok(result.points.every((point) => point.every(Number.isFinite)), `${id} has a non-finite display point`);
  assert.ok(result.rawPoints.every((point) => point.every(Number.isFinite)), `${id} has a non-finite raw point`);
  assert.equal(result.metadata.diverged, false, `${id} reference diverged`);
  assert.equal(result.points.length, result.metadata.steps, `${id} did not return its requested tail`);
  assert.equal(result.rawPoints.length, result.points.length, `${id} point projections are misaligned`);
}

function validateSchema() {
  assert.equal(SYSTEM_LIST.length, 9, "the numerical catalogue must contain nine systems");
  assert.deepEqual(SYSTEM_LIST.map((system) => system.id), references.map(([id]) => id));
  for (const system of SYSTEM_LIST) {
    assert.ok(system.equation.length > 20, `${system.id} equation missing`);
    assert.ok(Object.keys(system.parameters).length > 0, `${system.id} parameter schema missing`);
    for (const [name, schema] of Object.entries(system.parameters)) {
      assert.ok(Number.isFinite(schema.min), `${system.id}.${name} min is not finite`);
      assert.ok(Number.isFinite(schema.max), `${system.id}.${name} max is not finite`);
      assert.ok(schema.min <= schema.max, `${system.id}.${name} bounds are inverted`);
      assert.ok(Number.isFinite(schema.default), `${system.id}.${name} default is not finite`);
      assert.ok(schema.default >= schema.min && schema.default <= schema.max, `${system.id}.${name} default is out of bounds`);
    }
  }
}

function validateMapIdentities(results) {
  const henon = results.get("henon");
  const b = 0.3;
  for (let index = 1; index < henon.rawPoints.length; index += 1) {
    assert.ok(close(henon.rawPoints[index][1], b * henon.rawPoints[index - 1][0]), `Hénon y identity failed at ${index}`);
  }
  assert.ok(close(henon.metadata.jacobianDeterminant, -b), "Hénon Jacobian identity failed");

  const ikeda = results.get("ikeda");
  const u = 0.918;
  assert.ok(close(ikeda.metadata.jacobianDeterminant, u * u), "Ikeda area identity failed");
  assert.ok(Number.isFinite(ikeda.metadata.absorbingRadius), "Ikeda absorbing radius is not finite");
  for (const [x, y] of ikeda.rawPoints) {
    assert.ok(Math.hypot(x, y) <= ikeda.metadata.absorbingRadius + 1e-10, "Ikeda escaped its absorbing bound");
  }

  const clifford = results.get("clifford");
  for (const [x, y] of clifford.rawPoints) {
    assert.ok(Math.abs(x) <= 1 + 1 + 1e-12, "Clifford x bound failed");
    assert.ok(Math.abs(y) <= 1 + 0.7 + 1e-12, "Clifford y bound failed");
  }
  const dejong = results.get("dejong");
  for (const [x, y] of dejong.rawPoints) {
    assert.ok(Math.abs(x) <= 2 + 1e-12 && Math.abs(y) <= 2 + 1e-12, "De Jong trigonometric bound failed");
  }
}

function validateDivergenceMetadata(results) {
  assert.equal(results.get("lorenz").metadata.divergence, -(10 + 1 + 8 / 3));
  assert.equal(results.get("thomas").metadata.divergence, -3 * 0.208186);

  const aizawaDivergence = results.get("aizawa").metadata.divergence;
  assert.equal(aizawaDivergence.kind, "state-dependent");
  assert.match(aizawaDivergence.formula, /z/);
  assert.match(aizawaDivergence.formula, /x²/);

  const rosslerDivergence = results.get("rossler").metadata.divergence;
  assert.equal(rosslerDivergence.kind, "state-dependent");
  assert.match(rosslerDivergence.formula, /x/);
  assert.notEqual(rosslerDivergence.formula, "a − c");
}

function validateConvergence() {
  const physicalTime = 0.4;
  const evidence = [];
  for (const [id, params, config] of odeReferences) {
    const baseDt = config.dt;
    const trajectories = [baseDt, baseDt / 2, baseDt / 4].map((dt) => {
      const steps = Math.round(physicalTime / dt);
      const result = simulateSystem(id, params, {
        burnIn: 0,
        steps,
        dt,
        hardRadius: config.hardRadius,
      });
      finiteTrajectory(result, `${id} convergence dt=${dt}`);
      return result;
    });
    const coarseToHalf = endpointDistance(trajectories[0].rawPoints.at(-1), trajectories[1].rawPoints.at(-1));
    const halfToFine = endpointDistance(trajectories[1].rawPoints.at(-1), trajectories[2].rawPoints.at(-1));
    assert.ok(halfToFine > 0, `${id} convergence collapsed to machine equality`);
    const ratio = coarseToHalf / halfToFine;
    assert.ok(ratio > 4, `${id} refinement ratio ${ratio} is below the RK4 evidence threshold`);
    evidence.push(`${id}:${ratio.toFixed(2)}`);
  }
  return evidence.join(",");
}

function validateBadInputs() {
  assert.throws(() => simulateSystem("lorenz", {}, { steps: Infinity }), /steps/);
  assert.throws(() => simulateSystem("lorenz", {}, { burnIn: -1 }), /burnIn/);
  assert.throws(() => simulateSystem("lorenz", {}, { steps: 1.5 }), /steps/);
  assert.throws(() => simulateSystem("lorenz", {}, { dt: NaN }), /dt/);
  assert.throws(() => simulateSystem("lorenz", {}, { dt: -0.01 }), /dt/);
  assert.throws(() => simulateSystem("lorenz", {}, { hardRadius: Infinity }), /hardRadius/);
  assert.throws(() => simulateSystem("lorenz", { sigma: Infinity }), /sigma/);
  assert.throws(() => simulateSystem("lorenz", {}, { initial: [0, NaN, 0] }), /initial/);
  assert.throws(() => simulateSystem("lorenz", {}, { burnIn: MAX_SIMULATION_ITERATIONS, steps: 1 }), /at most/);
  assert.throws(() => simulateSystem("missing-system"), /Unknown dynamical-system/);

  const overflowingOde = simulateSystem("lorenz", {}, {
    burnIn: 0,
    steps: 2,
    dt: 1,
    hardRadius: Number.MAX_VALUE,
    initial: [Number.MAX_VALUE / 2, 0, 0],
  });
  assert.equal(overflowingOde.metadata.diverged, true, "RK4 overflow was not detected");
  assert.equal(overflowingOde.points.length, 0, "overflow returned a non-finite point");

  const divergent = simulateSystem("henon", { a: 1.6, b: 0.5 }, { steps: 500, burnIn: 100, hardRadius: 30 });
  assert.equal(divergent.metadata.diverged, true, "divergence path was not exercised");
  assert.ok(divergent.points.length < divergent.metadata.steps, "divergence was silently clipped into a full trajectory");
}

function validateCurves() {
  assert.equal(CURVE_LIST.length, 14, "the generalized curve catalogue must contain fourteen curves");
  for (const curve of CURVE_LIST) {
    const sample = sampleCurve(curve.id, curve.defaults, 96);
    assert.equal(sample.points.length, 96, `${curve.id} sample count mismatch`);
    assert.ok(sample.points.some((point) => point.every(Number.isFinite)), `${curve.id} has no finite samples`);
    assert.ok(sample.channels && Object.keys(sample.channels).length >= 2, `${curve.id} channel schema missing`);
  }
}

validateSchema();
const results = new Map();
for (const [id, params, config] of references) {
  const first = simulateSystem(id, params, config);
  const second = simulateSystem(id, params, config);
  finiteTrajectory(first, id);
  assert.deepEqual(first, second, `${id} full trajectory is not deterministic`);
  results.set(id, first);
}

validateMapIdentities(results);
validateDivergenceMetadata(results);
validateBadInputs();
validateCurves();
const convergence = validateConvergence();

console.log(`VALIDATION_PASS systems=${SYSTEM_LIST.length} finite_reference=${results.size} curves=${CURVE_LIST.length} convergence=${convergence}`);
