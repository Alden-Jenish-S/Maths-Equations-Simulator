/**
 * Incremental, bounded generators for the Live/Streaming mode.
 *
 * Live systems keep a small state object and advance it by a deterministic
 * fixed dt. Inputs are validated at the numerical boundary: a bad value is
 * rejected, and an ODE that leaves its safety region is frozen and marked as
 * diverged. It is never clipped back into a plausible-looking trace.
 */

const TWO_PI = 2 * Math.PI;
const MAX_LIVE_TIME = 1e6;
const MAX_LIVE_HISTORY = 1800;
const MAX_LIVE_WINDOW_REQUEST = 1_000_000;
const MIN_LIVE_DT = 1e-9;
const MAX_OUTPUT_ABS = 1e6;

const STATE_LIMITS = Object.freeze({
  pendulum: Object.freeze({ theta: 100, velocity: 100 }),
  vanderpol: Object.freeze({ position: 50, velocity: 100 }),
});

function record(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function finiteNumber(value, name, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new RangeError(`${name} must be in [${min}, ${max}]`);
  }
  return value;
}

function boundedVector(values, limits) {
  return Array.isArray(values)
    && values.length === limits.length
    && values.every((value, index) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limits[index]);
}

function pointForTimeSeries(state, value) {
  return [state.t, value];
}

function validatePoint(point, name = "point") {
  if (!Array.isArray(point) || point.length < 2 || !point.every((value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_OUTPUT_ABS)) {
    throw new RangeError(`${name} must be a finite bounded point`);
  }
  return point;
}

function validateSampleState(state) {
  record(state, "state");
  finiteNumber(state.t, "state.t", 0, MAX_LIVE_TIME);
  return state;
}

function validateParameters(id, params = {}) {
  record(params, `${id} parameters`);
  const system = LIVE_SYSTEMS[id];
  const values = {};
  for (const [name, schema] of Object.entries(system.parameters)) {
    const value = params[name] === undefined ? schema.default : params[name];
    finiteNumber(value, `${id}.${name}`, schema.min, schema.max);
    if (name === "harmonics" && !Number.isInteger(value)) {
      throw new RangeError(`${id}.${name} must be an integer`);
    }
    values[name] = value;
  }
  return values;
}

function validateHistory(state) {
  if (state.history === undefined) return;
  if (!Array.isArray(state.history) || state.history.length < 1 || state.history.length > MAX_LIVE_HISTORY) {
    throw new RangeError(`state.history must contain 1…${MAX_LIVE_HISTORY} timestamps`);
  }
  let previous = -Infinity;
  for (const timestamp of state.history) {
    finiteNumber(timestamp, "state.history timestamp", 0, state.t);
    if (timestamp <= previous) throw new RangeError("state.history timestamps must be strictly increasing");
    previous = timestamp;
  }
  if (previous !== state.t) throw new RangeError("state.history must end at state.t");
}

function validateLiveState(id, state) {
  record(state, "state");
  finiteNumber(state.t, "state.t", 0, MAX_LIVE_TIME);
  if (state.diverged !== undefined && typeof state.diverged !== "boolean") {
    throw new TypeError("state.diverged must be boolean");
  }
  for (const [name, limit] of Object.entries(STATE_LIMITS[id] ?? {})) {
    finiteNumber(state[name], `state.${name}`, -limit, limit);
  }
  validateHistory(state);
  return state;
}

function rememberTime(state, timestamp) {
  if (state.history === undefined) state.history = [state.t];
  state.history.push(timestamp);
  if (state.history.length > MAX_LIVE_HISTORY) state.history.splice(0, state.history.length - MAX_LIVE_HISTORY);
  state.t = timestamp;
}

function failStep(state, reason) {
  state.diverged = true;
  state.reason = reason;
  throw new RangeError(reason);
}

function rk4Step(state, dt, derivative, limits) {
  const k1 = derivative(state);
  if (!k1.every(Number.isFinite)) return null;
  const stage = (values, derivativeValues, scale) => values.map((value, index) => value + scale * derivativeValues[index]);
  const k2State = stage(state, k1, dt / 2);
  if (!boundedVector(k2State, limits)) return null;
  const k2 = derivative(k2State);
  if (!k2.every(Number.isFinite)) return null;
  const k3State = stage(state, k2, dt / 2);
  if (!boundedVector(k3State, limits)) return null;
  const k3 = derivative(k3State);
  if (!k3.every(Number.isFinite)) return null;
  const k4State = stage(state, k3, dt);
  if (!boundedVector(k4State, limits)) return null;
  const k4 = derivative(k4State);
  if (!k4.every(Number.isFinite)) return null;
  const next = state.map((value, index) => value + (dt / 6) * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]));
  return boundedVector(next, limits) ? next : null;
}

function beginStep(id, state, params, dt) {
  const values = validateParameters(id, params);
  const stepDt = finiteNumber(dt, `${id}.dt`, MIN_LIVE_DT, LIVE_SYSTEMS[id].dt);
  validateLiveState(id, state);
  if (state.diverged) throw new RangeError(`Live state is frozen: ${state.reason ?? "guard previously exceeded"}; reset to resume`);
  const nextTime = state.t + stepDt;
  if (!Number.isFinite(nextTime) || nextTime > MAX_LIVE_TIME || state.t + stepDt / 2 <= state.t) {
    failStep(state, "Live clock guard exceeded");
  }
  return { values, stepDt, nextTime };
}

function commitSampleStep(system, state, params, nextTime) {
  const candidate = { t: nextTime };
  let point;
  try {
    point = system.view === "xy"
      ? system.sample(candidate, params)
      : pointForTimeSeries(candidate, system.sample(candidate, params));
    validatePoint(point);
  } catch (error) {
    failStep(state, error.message);
  }
  rememberTime(state, nextTime);
  return { point, value: system.view === "xy" ? null : point[1], diverged: false };
}

function stepSampled(id, state, params, dt) {
  const system = LIVE_SYSTEMS[id];
  const start = beginStep(id, state, params, dt === undefined ? system.dt : dt);
  return commitSampleStep(system, state, start.values, start.nextTime);
}

function stepOde(id, state, params, dt, fields, limits, derivative, output) {
  const system = LIVE_SYSTEMS[id];
  const start = beginStep(id, state, params, dt === undefined ? system.dt : dt);

  const previous = fields.map((field) => state[field]);
  const integrated = rk4Step([...previous, state.t], start.stepDt, (stage) => derivative(stage, start.values), [...limits, MAX_LIVE_TIME]);
  if (!integrated || integrated[fields.length] <= state.t || integrated[fields.length] > MAX_LIVE_TIME) {
    failStep(state, "RK4 state guard exceeded");
  }

  const candidate = { ...state, t: start.nextTime };
  fields.forEach((field, index) => { candidate[field] = integrated[index]; });
  let result;
  try {
    result = output(candidate, start.values);
    validatePoint(result.point);
    if (result.value !== null) finiteNumber(result.value, `${id} output`, -MAX_OUTPUT_ABS, MAX_OUTPUT_ABS);
  } catch (error) {
    failStep(state, error.message);
  }

  fields.forEach((field) => { state[field] = candidate[field]; });
  rememberTime(state, start.nextTime);
  return { ...result, diverged: false };
}

function liveDefaultsState() {
  return { t: 0, history: [0], diverged: false };
}

export const LIVE_SYSTEMS = {
  fourier: {
    id: "fourier",
    name: "Fourier composer",
    kind: "signal",
    view: "time",
    equation: "y(t) = Σ Aₙ sin(2π n f t + φₙ(t)),  Aₙ ∝ n⁻ᵖ",
    description: "A bounded additive Fourier series where harmonic count, spectral slope, modulation, and phase drift reshape the live signal.",
    parameters: {
      frequency: { label: "f · fundamental Hz", min: 0.1, max: 3, step: 0.01, default: 0.8 },
      harmonics: { label: "K · harmonic count", min: 1, max: 16, step: 1, default: 7 },
      slope: { label: "p · spectral slope", min: 0, max: 3, step: 0.01, default: 1.2 },
      modulation: { label: "m · phase modulation", min: 0, max: 1, step: 0.01, default: 0.25 },
      amplitude: { label: "A · output amplitude", min: 0.2, max: 2, step: 0.01, default: 1 },
    },
    defaults: { frequency: 0.8, harmonics: 7, slope: 1.2, modulation: 0.25, amplitude: 1 },
    dt: 1 / 120,
    createState: liveDefaultsState,
    sample(state, params) {
      validateSampleState(state);
      const { frequency, harmonics, slope, modulation, amplitude } = validateParameters("fourier", params);
      let value = 0;
      let normalizer = 0;
      for (let n = 1; n <= harmonics; n += 1) {
        const weight = 1 / Math.pow(n, slope);
        const phase = TWO_PI * n * frequency * state.t + modulation * Math.sin(TWO_PI * (0.11 + n * 0.007) * state.t);
        value += weight * Math.sin(phase);
        normalizer += weight;
      }
      return finiteNumber(amplitude * value / Math.max(1, normalizer), "fourier sample", -MAX_OUTPUT_ABS, MAX_OUTPUT_ABS);
    },
    step(state, params, dt) {
      return stepSampled("fourier", state, params, dt);
    },
  },

  lissajous: {
    id: "lissajous",
    name: "Sine / Lissajous chirp",
    kind: "parametric",
    view: "xy",
    equation: "x = Aₓ sin(2π(fₓt + ½cₓt²));  y = Aᵧ sin(2π(fᵧt + ½cᵧt²) + δ)",
    description: "Two bounded sine phases form closed, near-rational, or slowly precessing figures as their frequencies and chirps change.",
    parameters: {
      frequencyX: { label: "fₓ · horizontal Hz", min: 0.1, max: 4, step: 0.01, default: 1 },
      frequencyY: { label: "fᵧ · vertical Hz", min: 0.1, max: 4, step: 0.01, default: 1.618 },
      chirp: { label: "c · frequency drift", min: -0.25, max: 0.25, step: 0.001, default: 0.015 },
      phase: { label: "δ · phase offset", min: -3.14, max: 3.14, step: 0.01, default: Math.PI / 2 },
      amplitude: { label: "A · figure scale", min: 0.2, max: 1.5, step: 0.01, default: 1 },
    },
    defaults: { frequencyX: 1, frequencyY: 1.618, chirp: 0.015, phase: Math.PI / 2, amplitude: 1 },
    dt: 1 / 180,
    createState: liveDefaultsState,
    sample(state, params) {
      validateSampleState(state);
      const { frequencyX, frequencyY, chirp, phase, amplitude } = validateParameters("lissajous", params);
      const xPhase = TWO_PI * (frequencyX * state.t + 0.5 * chirp * state.t * state.t);
      const yPhase = TWO_PI * (frequencyY * state.t + 0.5 * chirp * 0.73 * state.t * state.t) + phase;
      return validatePoint([amplitude * Math.sin(xPhase), amplitude * Math.sin(yPhase)], "lissajous sample");
    },
    step(state, params, dt) {
      return stepSampled("lissajous", state, params, dt);
    },
  },

  pendulum: {
    id: "pendulum",
    name: "Driven pendulum",
    kind: "signal",
    view: "time",
    equation: "θ̈ = −(g/L) sin θ − d θ̇ + F sin(Ωt)",
    description: "A damped, periodically driven pendulum: small oscillations, nonlinear swings, and entrainment appear as parameters move.",
    parameters: {
      length: { label: "L · length", min: 0.5, max: 3, step: 0.01, default: 1 },
      gravity: { label: "g · gravity", min: 1, max: 15, step: 0.01, default: 9.81 },
      damping: { label: "d · damping", min: 0, max: 0.8, step: 0.001, default: 0.08 },
      drive: { label: "F · drive strength", min: 0, max: 3, step: 0.01, default: 0.8 },
      driveFrequency: { label: "Ω · drive Hz", min: 0.1, max: 4, step: 0.01, default: 1.4 },
    },
    defaults: { length: 1, gravity: 9.81, damping: 0.08, drive: 0.8, driveFrequency: 1.4 },
    dt: 1 / 240,
    createState: () => ({ ...liveDefaultsState(), theta: 0.7, velocity: 0 }),
    currentPoint(state, params) {
      validateLiveState("pendulum", state);
      validateParameters("pendulum", params);
      return pointForTimeSeries(state, state.theta);
    },
    step(state, params, dt) {
      return stepOde(
        "pendulum",
        state,
        params,
        dt,
        ["theta", "velocity"],
        [STATE_LIMITS.pendulum.theta, STATE_LIMITS.pendulum.velocity],
        ([theta, velocity, t], values) => [
          velocity,
          -(values.gravity / values.length) * Math.sin(theta) - values.damping * velocity + values.drive * Math.sin(TWO_PI * values.driveFrequency * t),
          1,
        ],
        (candidate) => ({ point: pointForTimeSeries(candidate, candidate.theta), value: candidate.theta }),
      );
    },
  },

  vanderpol: {
    id: "vanderpol",
    name: "Van der Pol oscillator",
    kind: "signal",
    view: "time",
    equation: "ẋ = v;  v̇ = μ(1 − x²)v − x + A sin(Ωt)",
    description: "A self-sustaining nonlinear oscillator that moves from smooth cycles toward sharp relaxation pulses as μ grows.",
    parameters: {
      nonlinearity: { label: "μ · nonlinearity", min: 0, max: 8, step: 0.01, default: 2 },
      drive: { label: "A · forcing", min: 0, max: 1.5, step: 0.01, default: 0.15 },
      driveFrequency: { label: "Ω · drive Hz", min: 0.1, max: 3, step: 0.01, default: 0.8 },
      amplitude: { label: "A₀ · output scale", min: 0.3, max: 2, step: 0.01, default: 1 },
    },
    defaults: { nonlinearity: 2, drive: 0.15, driveFrequency: 0.8, amplitude: 1 },
    dt: 1 / 240,
    createState: () => ({ ...liveDefaultsState(), position: 1, velocity: 0 }),
    currentPoint(state, params) {
      validateLiveState("vanderpol", state);
      const { amplitude } = validateParameters("vanderpol", params);
      return pointForTimeSeries(state, amplitude * state.position);
    },
    step(state, params, dt) {
      return stepOde(
        "vanderpol",
        state,
        params,
        dt,
        ["position", "velocity"],
        [STATE_LIMITS.vanderpol.position, STATE_LIMITS.vanderpol.velocity],
        ([position, velocity, t], values) => [
          velocity,
          values.nonlinearity * (1 - position * position) * velocity - position + values.drive * Math.sin(TWO_PI * values.driveFrequency * t),
          1,
        ],
        (candidate, values) => ({ point: pointForTimeSeries(candidate, values.amplitude * candidate.position), value: candidate.position }),
      );
    },
  },

  ecg: {
    id: "ecg",
    name: "Synthetic ECG-like wave",
    kind: "signal",
    view: "time",
    equation: "z(φ) = Σ aᵢ exp(−Δφᵢ² / 2bᵢ²) + baseline(t)",
    description: "A deterministic P/Q/R/S/T-inspired waveform for visual exploration only; it is not medical data or a diagnostic model.",
    parameters: {
      bpm: { label: "BPM · beat rate", min: 45, max: 150, step: 1, default: 72 },
      morphology: { label: "M · morphology scale", min: 0.5, max: 1.5, step: 0.01, default: 1 },
      hrv: { label: "H · phase variability", min: 0, max: 0.2, step: 0.001, default: 0.04 },
      baseline: { label: "B · baseline wander", min: 0, max: 0.3, step: 0.01, default: 0.04 },
      noise: { label: "N · deterministic texture", min: 0, max: 0.08, step: 0.001, default: 0.01 },
    },
    defaults: { bpm: 72, morphology: 1, hrv: 0.04, baseline: 0.04, noise: 0.01 },
    dt: 1 / 240,
    createState: liveDefaultsState,
    sample(state, params) {
      validateSampleState(state);
      const { bpm, morphology, hrv, baseline, noise } = validateParameters("ecg", params);
      const phase = ((state.t * bpm) / 60 + hrv * Math.sin(TWO_PI * 0.1 * state.t)) % 1;
      const components = [
        [0.18, 0.035, 0.20], // P
        [0.35, 0.012, -0.12], // Q
        [0.40, 0.010, 1.00], // R
        [0.44, 0.012, -0.26], // S
        [0.62, 0.060, 0.32], // T
      ];
      let value = 0;
      for (const [centre, width, componentAmplitude] of components) {
        const difference = phase - centre;
        const wrapped = difference - Math.round(difference);
        value += morphology * componentAmplitude * Math.exp(-(wrapped * wrapped) / (2 * width * width));
      }
      value += baseline * Math.sin(TWO_PI * 0.25 * state.t);
      value += noise * (Math.sin(TWO_PI * 7.1 * state.t) + 0.5 * Math.sin(TWO_PI * 13.7 * state.t));
      return finiteNumber(value, "ecg sample", -MAX_OUTPUT_ABS, MAX_OUTPUT_ABS);
    },
    step(state, params, dt) {
      return stepSampled("ecg", state, params, dt);
    },
  },
};

export const LIVE_SYSTEM_LIST = Object.values(LIVE_SYSTEMS);

export function getLiveSystem(id) {
  if (typeof id !== "string" || !Object.hasOwn(LIVE_SYSTEMS, id)) throw new Error(`Unknown live system: ${String(id)}`);
  return LIVE_SYSTEMS[id];
}

export function createLiveState(id) {
  return getLiveSystem(id).createState();
}

export function advanceLive(id, state, params, dt) {
  const system = getLiveSystem(id);
  return system.step(state, params, dt === undefined ? system.dt : dt);
}

function validateWindowCount(count) {
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > MAX_LIVE_WINDOW_REQUEST) {
    throw new RangeError(`count must be an integer in [1, ${MAX_LIVE_WINDOW_REQUEST}]`);
  }
  return count;
}

/**
 * Rebuild the visible window after a live parameter edit. Directly sampled
 * sources are reevaluated only at timestamps retained by the state history;
 * they never synthesize samples before t=0 or after the current source clock.
 * Stateful ODE sources retain their numerical state and expose one updated
 * point, then continue from that same state on the next step.
 */
export function rebuildLiveWindow(id, state, params, count = 1) {
  const system = getLiveSystem(id);
  const requested = validateWindowCount(count);
  const values = validateParameters(id, params);
  validateLiveState(id, state);
  if (typeof system.sample === "function") {
    const timestamps = state.history?.length ? state.history : [state.t];
    const actual = timestamps.slice(Math.max(0, timestamps.length - requested));
    return actual.map((t) => {
      const sampleState = { t };
      const value = system.sample(sampleState, values);
      return system.view === "xy" ? validatePoint(value) : validatePoint([t, value]);
    });
  }
  if (typeof system.currentPoint === "function") return [validatePoint(system.currentPoint(state, values))];
  return [];
}
