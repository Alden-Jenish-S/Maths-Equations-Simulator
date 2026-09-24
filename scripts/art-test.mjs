import assert from "node:assert/strict";
import {
  CURVE_LIST,
  CURVES,
  PENDULUM_DEFAULTS,
  SPIROGRAPH_DEFAULTS,
  createDoublePendulum,
  curveFrame,
  doublePendulumFrame,
  generateSpirograph,
  sampleCurve,
  spirographPoint,
  stepDoublePendulum,
} from "../src/art-modes.js";

const TAU = 2 * Math.PI;
const close = (actual, expected, tolerance, message) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}`);
};
const pointDistance = (left, right) => Math.hypot(...left.map((value, index) => value - right[index]));
const assertFinitePoint = (point, label) => assert.ok(point.every(Number.isFinite), `${label} is not finite`);

assert.equal(CURVE_LIST.length, 17, "the contract requires all 17 curves");
assert.equal(Object.keys(CURVES).length, 17, "curve lookup and curve list disagree");
for (const definition of CURVE_LIST) {
  assert.ok(definition.id && definition.name && definition.family && definition.equation && definition.description);
  assert.deepEqual(Object.keys(definition.defaults), Object.keys(definition.parameters), `${definition.id} defaults/schema mismatch`);
  assert.equal(definition.domain.length, 2);
  for (const schema of Object.values(definition.parameters)) {
    for (const key of ["label", "min", "max", "step", "default"]) assert.ok(Object.hasOwn(schema, key), `${definition.id}.${key} missing`);
    assert.ok(schema.min <= schema.default && schema.default <= schema.max, `${definition.id} default is outside schema`);
  }
}

const defaultSamples = new Map();
for (const definition of CURVE_LIST) {
  const first = sampleCurve(definition.id, {}, 257);
  const second = sampleCurve(definition.id, {}, 257);
  assert.deepEqual(first, second, `${definition.id} is not deterministic`);
  defaultSamples.set(definition.id, first);
  assert.equal(first.points.length, 257);
  assert.equal(first.metadata.id, definition.id);
  assert.ok(first.points.every((point) => point.every(Number.isFinite)), `${definition.id} has a non-finite point`);
  for (const values of Object.values(first.channels)) assert.equal(values.length, 257);
}

// The six circular channels are useful because their poles must be represented
// as gaps rather than as huge finite values.
const circleAtPole = curveFrame("circle", {}, Math.PI / 2);
assert.equal(circleAtPole.channels.tan, null);
assert.equal(circleAtPole.channels.sec, null);
assert.equal(circleAtPole.singular, true);
close(curveFrame("circle", {}, Math.PI / 4).channels.tan, 1, 1e-15, "circle tangent channel");
close(curveFrame("circle", {}, Math.PI / 4).curvature, 1, 1e-12, "unit circle curvature");
const circleChannels = defaultSamples.get("circle").channels;
assert.ok(circleChannels.tan.includes(null) && circleChannels.cot.includes(null), "circle sample did not preserve poles");

const hyperbolaFrame = curveFrame("hyperbola", {}, 0.73);
close(hyperbolaFrame.point[0] ** 2 - hyperbolaFrame.point[1] ** 2, 1, 2e-12, "hyperbola implicit identity");
const hyperbolaPole = curveFrame("hyperbola", {}, 0);
assert.equal(hyperbolaPole.channels.csch, null);
assert.equal(hyperbolaPole.channels.coth, null);
assert.equal(hyperbolaPole.singular, true);
const hyperbolaSamples = defaultSamples.get("hyperbola");
assert.ok(hyperbolaSamples.channels.csch.includes(null) && hyperbolaSamples.channels.coth.includes(null));

for (const exponent of [2 / 3, 1, 2, 4]) {
  const superellipse = sampleCurve("superellipse", { exponent }, 101);
  for (const [index, point] of superellipse.points.entries()) {
    const [x, y] = point;
    const residual = Math.abs(x / CURVES.superellipse.defaults.a) ** exponent
      + Math.abs(y / CURVES.superellipse.defaults.b) ** exponent - 1;
    close(residual, 0, 5e-12, `superellipse n=${exponent} identity at ${index}`);
  }
}
assert.equal(curveFrame("superellipse", { exponent: 2 / 3 }, 0).curvature, null, "astroid cusp should not invent curvature");
assert.equal(curveFrame("cardioid", {}, 0).speed, 0, "cardioid cusp should have zero speed");
assert.equal(curveFrame("cardioid", {}, 0).curvature, null, "cardioid cusp should have null curvature");

const clothoid = curveFrame("clothoid", { a: 1.25 }, 1.4);
close(clothoid.speed, 1, 2e-12, "clothoid unit speed");
close(clothoid.curvature, 1.25 * 1.4, 2e-10, "clothoid curvature");
const helix = curveFrame("helix", { radius: 2, pitch: 0.5 }, 0.9);
close(helix.curvature, 2 / (2 ** 2 + 0.5 ** 2), 1e-12, "helix curvature");
close(Math.hypot(...helix.tangent), 1, 1e-12, "helix tangent normalization");
assertFinitePoint(helix.normal, "helix normal");

const finiteDifferenceTangent = (id, params, t, h = 1e-6) => {
  const before = curveFrame(id, params, t - h).point, after = curveFrame(id, params, t + h).point;
  const derivative = after.map((value, index) => (value - before[index]) / (2 * h));
  const speed = Math.hypot(...derivative);
  return derivative.map((value) => value / speed);
};
const finiteDifferenceCurvature = (id, params, t, h = 1e-5) => {
  const before = curveFrame(id, params, t - h), after = curveFrame(id, params, t + h), center = curveFrame(id, params, t);
  return Math.hypot(...after.tangent.map((value, index) => (value - before.tangent[index]) / (2 * h))) / center.speed;
};
const assertVectorClose = (actual, expected, tolerance, label) => {
  assert.equal(actual.length, expected.length, `${label} dimension`);
  actual.forEach((value, index) => close(value, expected[index], tolerance, `${label}[${index}]`));
};

const lissajousParams = { A: 2, B: 1.25, a: 3, b: 2, delta: .4 }, lissajous = curveFrame("lissajous", lissajousParams, .37);
close(lissajous.point[0], 2 * Math.sin(3 * .37 + .4), 1e-14, "Lissajous x equation");
close(lissajous.point[1], 1.25 * Math.sin(2 * .37), 1e-14, "Lissajous y equation");
assertVectorClose(lissajous.tangent, finiteDifferenceTangent("lissajous", lissajousParams, .37), 2e-9, "Lissajous analytic tangent");
close(lissajous.curvature, finiteDifferenceCurvature("lissajous", lissajousParams, .37), 2e-7, "Lissajous analytic curvature");

const torusParams = { R: 3, r: .75, p: 2, q: 3 }, torus = curveFrame("torus-knot", torusParams, .73);
close((Math.hypot(torus.point[0], torus.point[1]) - 3) ** 2 + torus.point[2] ** 2, .75 ** 2, 2e-12, "torus-knot torus identity");
assertVectorClose(torus.tangent, finiteDifferenceTangent("torus-knot", torusParams, .73), 2e-9, "torus-knot analytic tangent");
close(torus.curvature, finiteDifferenceCurvature("torus-knot", torusParams, .73), 2e-7, "torus-knot analytic curvature");
close(pointDistance(curveFrame("torus-knot", torusParams, 0).point, curveFrame("torus-knot", torusParams, TAU).point), 0, 2e-14, "torus-knot closure");

const mappedParams = { cx: -.1, cy: .2, rho: 1.1, a: .8 }, mappedT = .73;
const mapped = curveFrame("joukowsky", mappedParams, mappedT), sx = mappedParams.cx + mappedParams.rho * Math.cos(mappedT), sy = mappedParams.cy + mappedParams.rho * Math.sin(mappedT), denominator = sx * sx + sy * sy;
close(mapped.point[0], sx * (1 + mappedParams.a ** 2 / denominator), 1e-13, "Joukowsky real mapping");
close(mapped.point[1], sy * (1 - mappedParams.a ** 2 / denominator), 1e-13, "Joukowsky imaginary mapping");
assertVectorClose(mapped.tangent, finiteDifferenceTangent("joukowsky", mappedParams, mappedT), 2e-9, "Joukowsky analytic tangent");
close(mapped.curvature, finiteDifferenceCurvature("joukowsky", mappedParams, mappedT), 2e-7, "Joukowsky analytic curvature");
assert.equal(curveFrame("joukowsky", {}, 0).speed, 0, "default Joukowsky cusp should have zero speed");

assert.deepEqual(spirographPoint({}, 0), spirographPoint(SPIROGRAPH_DEFAULTS, 0), "spirograph defaults differ");
const defaultSpiro = generateSpirograph({}, 1201);
assert.equal(defaultSpiro.metadata.closed, true);
close(pointDistance(defaultSpiro.points[0], defaultSpiro.points.at(-1)), 0, 2e-12, "default gear closure");
const rose = generateSpirograph({ R: 5, r: 2, d: 1.3, mode: "rose", phase: 0.37 }, 601);
assertFinitePoint(spirographPoint({ R: 5, r: 2, d: 1.3, mode: "rose" }, 0, 0.37), "rose point");
assert.ok(rose.points.some((point) => pointDistance(point, rose.points[0]) > 0.01), "rose should not be constant");
const multipenA = spirographPoint({ ...SPIROGRAPH_DEFAULTS }, 1, 0);
const multipenB = spirographPoint({ ...SPIROGRAPH_DEFAULTS }, 1, Math.PI / 3);
assert.ok(pointDistance(multipenA, multipenB) > 1e-6, "pen phase is ignored");

const initial = { theta1: 0.8, theta2: 1.4, omega1: 0.1, omega2: -0.2 };
const conservative = { ...PENDULUM_DEFAULTS, damping: 0 };
const state240 = createDoublePendulum(initial);
const state480 = createDoublePendulum(initial);
const startEnergy = doublePendulumFrame(state240, conservative).energy;
for (let i = 0; i < 240; i += 1) stepDoublePendulum(state240, conservative, 1 / 240);
for (let i = 0; i < 480; i += 1) stepDoublePendulum(state480, conservative, 1 / 480);
const frame240 = doublePendulumFrame(state240, conservative);
const frame480 = doublePendulumFrame(state480, conservative);
close(state240.t, 1, 1e-14, "coarse state time");
close(state480.t, 1, 1e-14, "refined state time");
assert.ok(frame240.bounded && !frame240.diverged);
assert.ok(pointDistance(frame240.point, frame480.point) < 2e-8, "RK4 refinement did not converge");
close(frame240.energy, startEnergy, 2e-8, "conservative double-pendulum energy");
assert.deepEqual(frame240.phaseSpace, [state240.theta1, state240.theta2]);
const damped = createDoublePendulum(initial);
const dampedStart = doublePendulumFrame(damped, { ...PENDULUM_DEFAULTS, damping: 0.25 }).energy;
for (let i = 0; i < 240; i += 1) stepDoublePendulum(damped, { ...PENDULUM_DEFAULTS, damping: 0.25 }, 1 / 240);
assert.ok(doublePendulumFrame(damped, { ...PENDULUM_DEFAULTS, damping: 0.25 }).energy < dampedStart, "damping did not dissipate energy");

assert.throws(() => sampleCurve("not-a-curve"), /Unknown curve/);
assert.throws(() => sampleCurve("circle", { radius: NaN }), /finite number/);
assert.throws(() => sampleCurve("circle", {}, 1), /\[2/);
assert.throws(() => curveFrame("lissajous", { a: 1.5 }), /integer/);
assert.throws(() => curveFrame("torus-knot", { R: .5, r: .75 }), /R > r/);
assert.throws(() => curveFrame("joukowsky", { cx: 1, rho: 1 }), /stay away/);
assert.throws(() => spirographPoint({ mode: "unknown" }), /Unknown spirograph/);
assert.throws(() => spirographPoint({ R: 2, r: 3 }), /R >= r/);
assert.throws(() => createDoublePendulum({ omega1: Infinity }), /finite number/);
assert.throws(() => stepDoublePendulum(createDoublePendulum(), {}, -1), /dt/);
const invalidState = createDoublePendulum({ omega1: 9999 });
const invalidResult = stepDoublePendulum(invalidState, {}, 0.1);
assert.equal(invalidResult.diverged, true);
assert.equal(invalidState.omega1, 9999);

console.log(`ART_TEST_PASS curves=${CURVE_LIST.length} physics=ok`);
