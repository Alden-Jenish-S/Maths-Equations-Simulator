import assert from "node:assert/strict";
import { LIVE_SYSTEM_LIST, getLiveSystem, advanceLive, createLiveState, rebuildLiveWindow } from "../src/live.js";
import { CURVE_LIST, curveFrame, sampleCurve, createDoublePendulum, doublePendulumFrame, stepDoublePendulum } from "../src/art-modes.js";
import { HARMONIC_PRESET_LIST, presetHarmonics, evaluateHarmonics, buildEpicycleState, audioDescriptorForHarmonics, synthesizeAudio } from "../src/audio.js";

const STEPS = 2400;
const HISTORY = 1800;
const TAU = 2 * Math.PI;
const clone = (value) => structuredClone(value);
const close = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
const finitePoint = (point) => assert.ok(point.length >= 2 && point.every(Number.isFinite), "non-finite point");
const numericState = (state) => Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value === "number"));

function changedParams(source) {
  return Object.fromEntries(Object.entries(source.parameters).map(([key, schema]) => [key, Math.min(schema.max, source.defaults[key] + 2 * schema.step)]));
}

function pointAt(source, params, t) {
  const value = source.sample({ t }, params);
  return source.view === "xy" ? value : [t, value];
}

function checkWindow(source, state, params, times, count) {
  const before = clone(state);
  const rebuilt = rebuildLiveWindow(source.id, state, params, count);
  assert.deepEqual(state, before, `${source.id} rebuild mutated state`);
  if (source.sample) {
    const expectedTimes = times.slice(-Math.min(count, HISTORY));
    assert.deepEqual(rebuilt, expectedTimes.map((t) => pointAt(source, params, t)), `${source.id} rebuilt invented/misaligned samples`);
    assert.ok(expectedTimes.every((t) => t >= 0 && t <= state.t), `${source.id} future timestamp`);
    if (source.view === "time") {
      assert.deepEqual(rebuilt.map(([t]) => t), expectedTimes);
      assert.equal(rebuilt.at(-1)[0], state.t);
    }
  } else {
    assert.deepEqual(rebuilt, [source.currentPoint(state, params)], `${source.id} ODE history must not be reintegrated`);
    assert.equal(rebuilt[0][0], state.t);
  }
  rebuilt.forEach(finitePoint);
  return rebuilt;
}

// Chunk grouping changes scheduling only: every numerical call retains the
// same dt. Pause/read/rebuild operations must not advance either source clock.
function liveSequence(source, chunks, edited = false, resume = false) {
  let state = createLiveState(source.id);
  let params = { ...source.defaults };
  const times = [0], frames = [], states = [];
  const initial = checkWindow(source, state, params, times, HISTORY);
  assert.equal(initial.length, 1, `${source.id} must render exactly one t=0 frame`);
  assert.equal(state.t, 0);
  let step = 0, chunk = 0;
  while (step < STEPS) {
    const length = Math.min(chunks[chunk++ % chunks.length], STEPS - step);
    for (let i = 0; i < length; i += 1, step += 1) {
      if (edited && (step === 797 || step === 1601)) {
        params = step === 797 ? changedParams(source) : { ...source.defaults };
        for (const count of [1, 17, HISTORY, 1_000_000]) checkWindow(source, state, params, times, count);
        if (resume) {
          // A serializable snapshot, not an unobserved wall-clock delay.
          state = JSON.parse(JSON.stringify(state));
          checkWindow(source, state, params, times, HISTORY);
        }
      }
      const previousTime = state.t;
      const frame = advanceLive(source.id, state, params, source.dt);
      assert.equal(frame.diverged, false, `${source.id} reference diverged at ${step}`);
      assert.equal(state.t, previousTime + source.dt);
      finitePoint(frame.point);
      if (source.view === "time") assert.equal(frame.point[0], state.t);
      else assert.equal(frame.value, null);
      if (source.sample) assert.deepEqual(frame.point, pointAt(source, params, state.t));
      if (source.id === "vanderpol") {
        assert.equal(frame.value, state.position, "retain the raw oscillator value contract");
        assert.equal(frame.point[1], params.amplitude * frame.value);
      }
      times.push(state.t);
      frames.push(frame);
      states.push(numericState(state));
      assert.ok(state.history.length <= HISTORY);
      if (step === 2 || step === 37) checkWindow(source, state, params, times, HISTORY);
    }
  }
  for (const count of [1, 119, HISTORY, 1_000_000]) checkWindow(source, state, params, times, count);
  assert.deepEqual(state.history, times.slice(-HISTORY));
  return { initial, frames, states, state };
}

assert.deepEqual(LIVE_SYSTEM_LIST.map(({ id }) => id), ["fourier", "lissajous", "pendulum", "vanderpol", "ecg"]);
for (const source of LIVE_SYSTEM_LIST) {
  assert.equal(getLiveSystem(source.id), source);
  assert.deepEqual(Object.keys(source.defaults), Object.keys(source.parameters));
  for (const [key, schema] of Object.entries(source.parameters)) {
    assert.equal(schema.default, source.defaults[key], `${source.id}.${key} inconsistent default`);
    assert.ok(schema.min <= schema.default && schema.default <= schema.max);
  }
  const reference = liveSequence(source, [1]);
  if (source.view === "time") assert.equal(reference.initial[0][0], 0, `${source.id} initial frame must have t=0`);
  else assert.deepEqual(reference.initial[0], pointAt(source, source.defaults, 0), `${source.id} initial XY frame is not the t=0 sample`);
  const expectedInitial = { fourier: [0, 0], lissajous: [0, 1], pendulum: [0, 0.7], vanderpol: [0, 1] }[source.id];
  if (expectedInitial) assert.deepEqual(reference.initial, [expectedInitial], `${source.id} app reset frame is not at t=0`);
  assert.deepEqual(liveSequence(source, [7, 31, 2, 40, 1]), reference, `${source.id} complete default sequence changed with grouping`);
  const edited = liveSequence(source, [1], true);
  assert.deepEqual(liveSequence(source, [19, 3, 40, 11], true, true), edited, `${source.id} complete edited/resumed sequence changed`);
  assert.deepEqual(edited.frames.slice(0, 797), reference.frames.slice(0, 797));
  assert.notDeepEqual(edited.frames.slice(797, 1601), reference.frames.slice(797, 1601), `${source.id} parameter edit had no effect`);

  // Actual history, rather than t/defaultDt, defines a variable-dt window.
  const variableState = createLiveState(source.id), times = [0];
  for (let i = 0; i < 73; i += 1) {
    advanceLive(source.id, variableState, {}, [source.dt, source.dt / 2, source.dt / 3, 1e-9][i % 4]);
    times.push(variableState.t);
  }
  checkWindow(source, variableState, changedParams(source), times, HISTORY);
  const withoutHistory = { ...numericState(variableState) };
  checkWindow(source, withoutHistory, {}, [withoutHistory.t], HISTORY);

  const partialState = createLiveState(source.id), defaultState = createLiveState(source.id);
  assert.deepEqual(advanceLive(source.id, partialState), advanceLive(source.id, defaultState, source.defaults, source.dt));
  assert.deepEqual(source.step(source.createState(), {}), advanceLive(source.id, createLiveState(source.id), {}));

  // Sweep every min/max parameter corner over a complete short sequence.
  const entries = Object.entries(source.parameters);
  for (let mask = 0; mask < 2 ** entries.length; mask += 1) {
    const params = Object.fromEntries(entries.map(([key, schema], i) => [key, mask & (1 << i) ? schema.max : schema.min]));
    const state = createLiveState(source.id);
    for (let i = 0; i < 480; i += 1) {
      const frame = advanceLive(source.id, state, params);
      assert.equal(frame.diverged, false);
      finitePoint(frame.point);
      if (source.id === "fourier") assert.ok(Math.abs(frame.value) <= params.amplitude + 1e-12);
      if (source.id === "lissajous") assert.ok(frame.point.every((v) => Math.abs(v) <= params.amplitude));
      if (source.id === "ecg") assert.ok(Math.abs(frame.value) <= params.morphology * 1.9 + params.baseline + 1.5 * params.noise);
      if (source.id === "pendulum") assert.ok(Math.abs(state.theta) <= 100 && Math.abs(state.velocity) <= 100);
      if (source.id === "vanderpol") assert.ok(Math.abs(state.position) <= 50 && Math.abs(state.velocity) <= 100);
    }
  }
}

function rejectedWithoutMutation(source, state, action, pattern) {
  const before = clone(state);
  assert.throws(action, pattern, `${source.id} accepted invalid input`);
  assert.deepEqual(state, before, `${source.id} invalid input mutated state`);
}

for (const source of LIVE_SYSTEM_LIST) {
  const state = createLiveState(source.id);
  for (const badDt of [0, -1, NaN, Infinity, -Infinity, Number.MIN_VALUE, source.dt * 1.01, 1e100, null, "0.001", true, [], {}]) {
    rejectedWithoutMutation(source, state, () => advanceLive(source.id, state, {}, badDt), /dt/);
    rejectedWithoutMutation(source, state, () => source.step(state, {}, badDt), /dt/);
  }
  for (const params of [null, 0, "params", true, []]) {
    rejectedWithoutMutation(source, state, () => advanceLive(source.id, state, params), /parameters/);
    rejectedWithoutMutation(source, state, () => rebuildLiveWindow(source.id, state, params), /parameters/);
  }
  for (const [key, schema] of Object.entries(source.parameters)) {
    const invalidValues = [NaN, Infinity, -Infinity, null, "1", false, [], {}, schema.min - 1, schema.max + 1];
    if (key === "harmonics") invalidValues.push(2.5);
    for (const value of invalidValues) {
      const params = { [key]: value };
      for (const action of [
        () => advanceLive(source.id, state, params),
        () => source.step(state, params),
        () => rebuildLiveWindow(source.id, state, params, HISTORY),
        () => (source.sample ?? source.currentPoint)(state, params),
      ]) rejectedWithoutMutation(source, state, action, new RegExp(key));
    }
  }
  for (const count of [0, -1, 1.5, NaN, Infinity, -Infinity, null, "10", 1_000_001]) {
    rejectedWithoutMutation(source, state, () => rebuildLiveWindow(source.id, state, {}, count), /count/);
  }
  const invalidStates = [null, [], {}, { ...state, t: NaN }, { ...state, t: -1 }, { ...state, t: 1e6 + 1 }, { ...state, t: "0" }, { ...state, diverged: 1 },
    { ...state, history: [] }, { ...state, history: [0, 1] }, { ...state, history: [0, 0] }, { ...state, history: [NaN] }, { ...state, history: new Array(1) },
    { ...state, history: Array(HISTORY + 1).fill(0) }, { ...state, t: 1, history: [0] }];
  for (const field of source.id === "pendulum" ? ["theta", "velocity"] : source.id === "vanderpol" ? ["position", "velocity"] : []) {
    for (const value of [NaN, Infinity, -Infinity, 101, -101, "1", null]) invalidStates.push({ ...state, [field]: value });
  }
  for (const badState of invalidStates) {
    rejectedWithoutMutation(source, badState, () => advanceLive(source.id, badState, {}), /state/);
    rejectedWithoutMutation(source, badState, () => rebuildLiveWindow(source.id, badState, {}), /state/);
  }
  if (source.sample) {
    for (const t of [NaN, Infinity, -1, 1e6 + 1, "0"]) assert.throws(() => source.sample({ t }, {}), /state.t/);
  }

  const atLimit = { ...createLiveState(source.id), t: 1e6, history: [1e6] };
  const before = clone(atLimit);
  assert.throws(() => advanceLive(source.id, atLimit, {}), /clock guard/);
  assert.deepEqual(numericState(atLimit), numericState(before));
  assert.deepEqual(atLimit.history, before.history);
  assert.equal(atLimit.diverged, true);
  assert.throws(() => advanceLive(source.id, atLimit, {}), /frozen/);
  rebuildLiveWindow(source.id, atLimit, {}).forEach(finitePoint);
}

for (const id of ["unknown", "constructor", "toString", "__proto__", null, undefined, 1, {}, Symbol("fourier")]) {
  assert.throws(() => createLiveState(id), /Unknown live system/);
  assert.throws(() => advanceLive(id, {}), /Unknown live system/);
  assert.throws(() => rebuildLiveWindow(id, {}), /Unknown live system/);
}

// A failed RK4 stage cannot commit time, state, history, or a clipped sample.
for (const [id, initial, params] of [
  ["pendulum", { theta: 99.99, velocity: 100 }, { damping: 0 }],
  ["vanderpol", { position: 49, velocity: 100 }, { nonlinearity: 8 }],
]) {
  const state = { ...createLiveState(id), ...initial }, before = clone(state);
  assert.throws(() => advanceLive(id, state, params), /RK4 state guard/);
  assert.deepEqual(numericState(state), numericState(before));
  assert.deepEqual(state.history, before.history);
  assert.equal(state.diverged, true);
  assert.match(state.reason, /guard/);
  assert.throws(() => advanceLive(id, state, params), /frozen/);
}

// An independent analytic limit catches integrator/forcing wiring errors.
const linear = createLiveState("vanderpol"), linearParams = { nonlinearity: 0, drive: 0, amplitude: 1.5 };
for (let i = 0; i < 240; i += 1) {
  const frame = advanceLive("vanderpol", linear, linearParams);
  close(linear.position, Math.cos(linear.t), 3e-12, "linear oscillator x");
  close(linear.velocity, -Math.sin(linear.t), 3e-12, "linear oscillator v");
  close(frame.point[1], 1.5 * Math.cos(linear.t), 5e-12, "linear oscillator output scale");
}

const pendulumSource = getLiveSystem("pendulum");
for (const damping of [0, 0.2]) {
  const params = { ...pendulumSource.defaults, drive: 0, damping };
  const energy = (state) => 0.5 * params.length ** 2 * state.velocity ** 2 + params.gravity * params.length * (1 - Math.cos(state.theta));
  const state = createLiveState("pendulum"), initialEnergy = energy(state);
  for (let i = 0; i < 240; i += 1) {
    advanceLive("pendulum", state, params);
    if (damping === 0) close(energy(state), initialEnergy, 2e-9, "undriven pendulum energy");
  }
  if (damping > 0) assert.ok(energy(state) < initialEnergy, "live pendulum damping must dissipate energy");
}

// Every incremental geometry frame uses the batch's exact parameter grid.
// These aligned grids land on circular/hyperbolic poles; null channels remain
// exact gaps, never zero-filled values or interpolated singularities.
for (const curve of CURVE_LIST) {
  for (const count of [257, 961]) {
    const params = { ...curve.defaults };
    const batch = sampleCurve(curve.id, params, count);
    const stream = [], channels = {};
    for (let i = 0; i < count; i += 1) {
      const t = batch.metadata.parameters[i];
      const frame = curveFrame(curve.id, params, t);
      finitePoint(frame.point);
      stream.push(frame.point);
      for (const [key, value] of Object.entries(frame.channels)) {
        assert.ok(value === null || Number.isFinite(value), `${curve.id}.${key} invalid channel`);
        (channels[key] ??= []).push(value);
      }
      if (i === Math.floor(count / 2)) {
        const altered = { ...params };
        const [key, schema] = Object.entries(curve.parameters)[0];
        altered[key] = Math.min(schema.max, params[key] + schema.step);
        const updated = curveFrame(curve.id, altered, t);
        const editedBatch = sampleCurve(curve.id, altered, count);
        assert.deepEqual(updated.point, editedBatch.points[i], `${curve.id} midstream edited point misaligned`);
        assert.deepEqual(updated.channels, Object.fromEntries(Object.entries(editedBatch.channels).map(([name, values]) => [name, values[i]])), `${curve.id} midstream edited channels misaligned`);
        assert.deepEqual(curveFrame(curve.id, params, t), frame, `${curve.id} edit polluted original frame`);
      }
    }
    assert.deepEqual(stream, batch.points, `${curve.id} incremental point sequence mismatch`);
    assert.deepEqual(channels, batch.channels, `${curve.id} incremental channel sequence mismatch`);
  }
}

// Double-pendulum streaming groups repeated fixed steps, not one coarse step
// per render chunk. Frames and all numerical states must match at every step.
function pendulumSequence(chunks, resume = false) {
  let state = createDoublePendulum({ theta1: 0.8, theta2: 1.4, omega1: 0.1, omega2: -0.2 });
  let params = { damping: 0 };
  const result = [{ frame: doublePendulumFrame(state, params), state: clone(state) }];
  let step = 0, chunk = 0;
  while (step < STEPS) {
    const length = Math.min(chunks[chunk++ % chunks.length], STEPS - step);
    for (let i = 0; i < length; i += 1, step += 1) {
      if (step === 797) {
        params = { damping: 0.15, length2: 1.2, mass2: 0.8 };
        const before = clone(state);
        const frame = doublePendulumFrame(state, params);
        assert.deepEqual(state, before, "pendulum frame/edit advanced the clock");
        assert.equal(frame.bounded, true);
        if (resume) state = JSON.parse(JSON.stringify(state));
      }
      const previousTime = state.t;
      const frame = stepDoublePendulum(state, params, 1 / 240);
      assert.equal(frame.diverged, false);
      assert.equal(state.t, previousTime + 1 / 240);
      assert.deepEqual(frame, doublePendulumFrame(state, params));
      finitePoint(frame.point);
      result.push({ frame, state: clone(state) });
    }
  }
  return result;
}
assert.deepEqual(pendulumSequence([1]), pendulumSequence([23, 1, 40, 7], true), "pendulum grouped/resumed sequence mismatch");

// Edits retain the current visual phase/sample offset. Epicycle y, the scalar
// waveform, and Float32 audio samples evaluate the same edited equation.
for (const preset of HARMONIC_PRESET_LIST) {
  let terms = presetHarmonics(preset.id, 8);
  const options = { pitch: 137.5, volume: 0.12, sampleRate: 48000 };
  for (let edit = 0; edit < 4; edit += 1) {
    if (edit === 1) terms[0] = { amplitude: -0.6, frequency: 0.9, phase: 0.37 };
    if (edit === 2) terms = [...terms.slice(1), { amplitude: 0.2, frequency: -2.5, phase: -0.8 }];
    if (edit === 3) terms = [];
    const descriptor = audioDescriptorForHarmonics(terms, options);
    assert.equal(descriptor.droppedTerms, 0);
    const start = 797 + edit * 257, count = 257;
    const whole = synthesizeAudio(descriptor, count, start);
    const grouped = new Float32Array(count);
    let offset = 0;
    for (const size of [1, 79, 3, 174]) {
      grouped.set(synthesizeAudio(descriptor, size, start + offset), offset);
      offset += size;
    }
    assert.deepEqual(grouped, whole, `${preset.id} audio chunk offsets changed sample sequence`);
    for (let i = 0; i < count; i += 1) {
      const phase = TAU * options.pitch * ((start + i) / options.sampleRate);
      const before = clone(terms);
      const epicycle = buildEpicycleState(terms, phase), value = evaluateHarmonics(terms, phase);
      assert.deepEqual(terms, before);
      assert.equal(epicycle.endpoint[1], value, `${preset.id} edited epicycle/equation disagree`);
      assert.equal(whole[i], Math.fround(value * descriptor.normalization * options.volume), `${preset.id} edited audio equation mismatch`);
      assert.equal(epicycle.vectors.length, terms.length);
      for (let j = 0; j < terms.length; j += 1) {
        assert.deepEqual(epicycle.vectors[j].center, j === 0 ? [0, 0] : epicycle.vectors[j - 1].endpoint);
        assert.equal(epicycle.vectors[j].radius, Math.abs(terms[j].amplitude));
      }
    }
  }
}

// Await both existing suites (including asynchronous audio-controller tests).
// An import/assertion failure exits nonzero and cannot print the combined pass.
await import("./art-test.mjs");
await import("./audio-test.mjs");
console.log(`LIVE_TEST_PASS systems=${LIVE_SYSTEM_LIST.length} samples_per_system=${STEPS} determinism=ok resume=ok history=ok guards=ok curves=${CURVE_LIST.length} audio=ok epicycles=ok physics=ok`);
