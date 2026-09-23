/**
 * Deterministic dynamical-system simulators.
 *
 * Every simulator returns the same shape so that exploration, metrics, and the
 * browser can share a single pipeline:
 *   { points: [[x, y], ...], rawPoints: [[...], ...], metadata }
 *
 * The first two coordinates are the default display projection. Spatial ODEs
 * keep z in rawPoints; Duffing retains its original [x, v] output.
 */

export const DEFAULT_SIMULATION_CONFIG = Object.freeze({
  burnIn: 400,
  steps: 3000,
  dt: 0.01,
  hardRadius: 100,
  initial: [0.1, 0.1, 0.1],
});

export const MAX_SIMULATION_ITERATIONS = 2_000_000;
export const MIN_ODE_DT = 1e-8;
export const MAX_ODE_DT = 1;

function finiteState(values, hardRadius) {
  return Array.isArray(values)
    && values.every(Number.isFinite)
    && values.every((value) => Math.abs(value) <= hardRadius);
}

function pushPoint(points, rawPoints, values) {
  const x = values[0];
  const y = values[1];
  points.push([x, y]);
  rawPoints.push(values.slice());
}

function rk4Step(state, dt, derivative) {
  const k1 = derivative(state);
  if (!k1.every(Number.isFinite)) return null;
  const k2 = derivative(state.map((value, i) => value + (dt * k1[i]) / 2));
  if (!k2.every(Number.isFinite)) return null;
  const k3 = derivative(state.map((value, i) => value + (dt * k2[i]) / 2));
  if (!k3.every(Number.isFinite)) return null;
  const k4 = derivative(state.map((value, i) => value + dt * k3[i]));
  if (!k4.every(Number.isFinite)) return null;
  return state.map((value, i) => value + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

function makeResult(points, rawPoints, metadata) {
  return {
    points,
    rawPoints,
    metadata: {
      finiteCount: points.length,
      requestedCount: metadata.requestedCount ?? points.length,
      ...metadata,
    },
  };
}

function normaliseParameters(id, params, schema, defaults) {
  if (params == null) params = {};
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError(`${id} parameters must be an object`);
  }

  const values = {};
  for (const name of Object.keys(schema)) {
    const value = Number(params[name] ?? defaults[name]);
    if (!Number.isFinite(value)) {
      throw new RangeError(`${id} parameter ${name} must be finite`);
    }
    values[name] = value;
  }
  // Preserve the original Ikeda parameter policy; reject non-finite input
  // before applying this legacy clamp. Other schema ranges are UI guidance.
  if (id === "ikeda") values.u = Math.max(0, Math.min(1.2, values.u));
  return values;
}

function finiteNumber(value, name, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(`${name} must be finite and in [${min}, ${max}]`);
  }
  return number;
}

function integerConfig(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return number;
}

function normaliseConfig(id, config, defaults, dimension, boundedDimensions, withDt) {
  if (config == null) config = {};
  if (typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError(`${id} configuration must be an object`);
  }

  const burnIn = integerConfig(config.burnIn ?? defaults.burnIn, `${id}.burnIn`, 0, MAX_SIMULATION_ITERATIONS);
  const steps = integerConfig(config.steps ?? defaults.steps, `${id}.steps`, 1, MAX_SIMULATION_ITERATIONS);
  if (burnIn + steps > MAX_SIMULATION_ITERATIONS) {
    throw new RangeError(`${id} burnIn + steps must be at most ${MAX_SIMULATION_ITERATIONS}`);
  }

  const hardRadius = finiteNumber(config.hardRadius ?? defaults.hardRadius, `${id}.hardRadius`, 0, Number.MAX_VALUE);
  const dt = withDt
    ? finiteNumber(config.dt ?? defaults.dt, `${id}.dt`, MIN_ODE_DT, MAX_ODE_DT)
    : undefined;
  if (!withDt && config.dt != null) {
    finiteNumber(config.dt, `${id}.dt`, Number.MIN_VALUE, Number.MAX_VALUE);
  }
  if (withDt && !Number.isFinite((burnIn + steps) * dt)) {
    throw new RangeError(`${id} total integration time must be finite`);
  }

  const initialValue = config.initial ?? defaults.initial;
  if (!Array.isArray(initialValue)) {
    throw new TypeError(`${id}.initial must be an array`);
  }
  // Missing coordinates use the family defaults; unused coordinates are ignored.
  const initial = Array.from({ length: dimension }, (_, index) => {
    const number = Number(initialValue[index] ?? defaults.initial[index]);
    if (!Number.isFinite(number)) {
      throw new RangeError(`${id}.initial[${index}] must be finite`);
    }
    if (index < boundedDimensions && Math.abs(number) > hardRadius) {
      throw new RangeError(`${id}.initial[${index}] exceeds hardRadius`);
    }
    return number;
  });
  if (boundedDimensions < dimension) {
    const t = initial[dimension - 1];
    if (!Number.isFinite(t + (burnIn + steps) * dt) || t + dt / 2 === t) {
      throw new RangeError(`${id} time must advance at RK4 half-steps and remain finite`);
    }
  }

  return { burnIn, steps, hardRadius, dt, initial };
}

function simulateMap(system, params, config, step, metadataFactory = () => ({})) {
  const values = normaliseParameters(system.id, params, system.parameters, system.defaults);
  const settings = normaliseConfig(system.id, config, system.defaultConfig, 2, 2, false);
  let state = settings.initial.slice();
  const points = [];
  const rawPoints = [];
  let divergedAt = null;
  const total = settings.burnIn + settings.steps;

  for (let i = 0; i < total; i += 1) {
    state = step(state, values);
    if (!finiteState(state, settings.hardRadius)) {
      divergedAt = i;
      break;
    }
    if (i >= settings.burnIn) pushPoint(points, rawPoints, state);
  }

  return makeResult(points, rawPoints, {
    family: system.id,
    requestedCount: settings.steps,
    burnIn: settings.burnIn,
    steps: settings.steps,
    integrator: "direct-map",
    diverged: divergedAt !== null,
    divergedAt,
    bounded: divergedAt === null,
    ...metadataFactory(values, settings),
  });
}

function simulateOde(system, params, config, derivative, projection = (state) => state, metadataFactory = () => ({}), boundedDimensions = 3) {
  const values = normaliseParameters(system.id, params, system.parameters, system.defaults);
  const settings = normaliseConfig(system.id, config, system.defaultConfig, 3, boundedDimensions, true);
  let state = settings.initial.slice();
  const points = [];
  const rawPoints = [];
  let divergedAt = null;
  const total = settings.burnIn + settings.steps;
  const vectorField = (state) => derivative(state, values);

  for (let i = 0; i < total; i += 1) {
    state = rk4Step(state, settings.dt, vectorField);
    if (state === null) {
      divergedAt = i;
      break;
    }
    const outputState = projection(state);
    if (!state.every(Number.isFinite) || !finiteState(outputState, settings.hardRadius)) {
      divergedAt = i;
      break;
    }
    if (i >= settings.burnIn) pushPoint(points, rawPoints, outputState);
  }

  return makeResult(points, rawPoints, {
    family: system.id,
    requestedCount: settings.steps,
    burnIn: settings.burnIn,
    steps: settings.steps,
    dt: settings.dt,
    integrator: "fixed-step-rk4",
    diverged: divergedAt !== null,
    divergedAt,
    bounded: divergedAt === null,
    ...metadataFactory(values, settings),
  });
}

export const SYSTEMS = {
  henon: {
    id: "henon",
    name: "Hénon map",
    shortName: "Hénon",
    kind: "map",
    equation: "x′ = 1 − a x² + y;  y′ = b x",
    description: "A dissipative quadratic map with period-doubling windows inside a strange attractor regime.",
    parameters: {
      a: { label: "a · quadratic fold", min: 0, max: 1.6, step: 0.001, default: 1.4 },
      b: { label: "b · area multiplier", min: -0.5, max: 0.5, step: 0.001, default: 0.3 },
    },
    defaults: { a: 1.4, b: 0.3 },
    defaultConfig: { burnIn: 500, steps: 7000, hardRadius: 30, initial: [0.1, 0.1] },
    simulate(params = {}, config = {}) {
      return simulateMap(
        SYSTEMS.henon,
        params,
        config,
        ([x, y], { a, b }) => [1 - a * x * x + y, b * x],
        ({ b }) => ({ jacobianDeterminant: -b }),
      );
    },
  },

  lorenz: {
    id: "lorenz",
    name: "Lorenz flow",
    shortName: "Lorenz",
    kind: "ode",
    equation: "ẋ = σ(y − x); ẏ = x(ρ − z) − y; ż = xy − βz",
    description: "A three-dimensional flow whose equilibria and butterfly attractor change with σ, ρ, and β.",
    parameters: {
      sigma: { label: "σ · Prandtl", min: 5, max: 20, step: 0.01, default: 10 },
      rho: { label: "ρ · Rayleigh", min: 0, max: 50, step: 0.01, default: 28 },
      beta: { label: "β · geometry", min: 1, max: 4, step: 0.001, default: 2.667 },
    },
    defaults: { sigma: 10, rho: 28, beta: 8 / 3 },
    defaultConfig: { burnIn: 1800, steps: 9000, dt: 0.01, hardRadius: 120, initial: [0.1, 0, 0] },
    simulate(params = {}, config = {}) {
      return simulateOde(
        SYSTEMS.lorenz,
        params,
        config,
        ([x, y, z], { sigma, rho, beta }) => [
          sigma * (y - x),
          x * (rho - z) - y,
          x * y - beta * z,
        ],
        undefined,
        ({ sigma, beta }) => ({ divergence: -(sigma + 1 + beta) }),
      );
    },
  },

  duffing: {
    id: "duffing",
    name: "Forced Duffing oscillator",
    shortName: "Duffing",
    kind: "ode",
    equation: "ẍ + δẋ + αx + βx³ = γ cos(ωt)",
    description: "A forced nonlinear oscillator with double-well motion, resonance, period windows, and chaos.",
    parameters: {
      delta: { label: "δ · damping", min: 0.02, max: 0.5, step: 0.001, default: 0.2 },
      alpha: { label: "α · linear stiffness", min: -1, max: 1, step: 0.001, default: -1 },
      beta: { label: "β · cubic stiffness", min: 0.1, max: 2, step: 0.001, default: 1 },
      gamma: { label: "γ · forcing", min: 0, max: 3, step: 0.001, default: 0.3 },
      omega: { label: "ω · forcing frequency", min: 0.5, max: 2.5, step: 0.001, default: 1 },
    },
    defaults: { delta: 0.2, alpha: -1, beta: 1, gamma: 0.3, omega: 1 },
    defaultConfig: { burnIn: 2500, steps: 18000, dt: 0.02, hardRadius: 80, initial: [0.1, 0, 0] },
    simulate(params = {}, config = {}) {
      return simulateOde(
        SYSTEMS.duffing,
        params,
        config,
        ([x, v, t], { delta, alpha, beta, gamma, omega }) => [
          v,
          -delta * v - alpha * x - beta * x * x * x + gamma * Math.cos(omega * t),
          1,
        ],
        (state) => [state[0], state[1]],
        ({ omega }) => ({ forcingPeriod: (2 * Math.PI) / omega }),
        2,
      );
    },
  },

  ikeda: {
    id: "ikeda",
    name: "Ikeda map",
    shortName: "Ikeda",
    kind: "map",
    equation: "t = 0.4 − 6/(1 + r²);  z′ = 1 + u z e^{it}",
    description: "A rotating dissipative optical map with nested folds and a compact strange attractor.",
    parameters: {
      u: { label: "u · dissipation", min: 0.45, max: 0.99, step: 0.001, default: 0.918 },
    },
    defaults: { u: 0.918 },
    defaultConfig: { burnIn: 700, steps: 9000, hardRadius: 160, initial: [0, 0] },
    simulate(params = {}, config = {}) {
      return simulateMap(
        SYSTEMS.ikeda,
        params,
        config,
        ([x, y], { u }) => {
          const theta = 0.4 - 6 / (1 + x * x + y * y);
          return [
            1 + u * (x * Math.cos(theta) - y * Math.sin(theta)),
            u * (x * Math.sin(theta) + y * Math.cos(theta)),
          ];
        },
        ({ u }) => ({
          jacobianDeterminant: u * u,
          absorbingRadius: u < 1 ? 1 / (1 - u) : Infinity,
        }),
      );
    },
  },

  clifford: {
    id: "clifford",
    name: "Clifford attractor",
    shortName: "Clifford",
    kind: "map",
    equation: "x′ = sin(a y) + c cos(a x);  y′ = sin(b x) + d cos(b y)",
    description: "A bounded trigonometric map whose four coefficients sculpt filigree, wings, and folded floral attractors.",
    parameters: {
      a: { label: "a · x phase", min: -2, max: 2, step: 0.001, default: -1.4 },
      b: { label: "b · y phase", min: -2, max: 2, step: 0.001, default: 1.6 },
      c: { label: "c · x weight", min: -2, max: 2, step: 0.001, default: 1 },
      d: { label: "d · y weight", min: -2, max: 2, step: 0.001, default: 0.7 },
    },
    defaults: { a: -1.4, b: 1.6, c: 1, d: 0.7 },
    defaultConfig: { burnIn: 800, steps: 9000, hardRadius: 10, initial: [0.1, 0.1] },
    simulate(params = {}, config = {}) {
      return simulateMap(
        SYSTEMS.clifford,
        params,
        config,
        ([x, y], { a, b, c, d }) => [
          Math.sin(a * y) + c * Math.cos(a * x),
          Math.sin(b * x) + d * Math.cos(b * y),
        ],
      );
    },
  },

  dejong: {
    id: "dejong",
    name: "De Jong attractor",
    shortName: "De Jong",
    kind: "map",
    equation: "x′ = sin(a y) − cos(b x);  y′ = sin(c x) − cos(d y)",
    description: "A compact four-parameter map with bounded nonlinear folding and an unusually rich family of lace-like traces.",
    parameters: {
      a: { label: "a · x phase", min: -3, max: 3, step: 0.001, default: 1.641 },
      b: { label: "b · fold phase", min: -3, max: 3, step: 0.001, default: 1.902 },
      c: { label: "c · y phase", min: -3, max: 3, step: 0.001, default: 0.316 },
      d: { label: "d · fold phase", min: -3, max: 3, step: 0.001, default: 1.525 },
    },
    defaults: { a: 1.641, b: 1.902, c: 0.316, d: 1.525 },
    defaultConfig: { burnIn: 800, steps: 9000, hardRadius: 10, initial: [0.1, 0.1] },
    simulate(params = {}, config = {}) {
      return simulateMap(
        SYSTEMS.dejong,
        params,
        config,
        ([x, y], { a, b, c, d }) => [
          Math.sin(a * y) - Math.cos(b * x),
          Math.sin(c * x) - Math.cos(d * y),
        ],
      );
    },
  },

  aizawa: {
    id: "aizawa",
    name: "Aizawa attractor",
    shortName: "Aizawa",
    kind: "ode",
    equation: "ẋ=(z−b)x−dy; ẏ=dx+(z−b)y; ż=c+az−z³/3−(x²+y²)(1+ez)+fzx³",
    description: "A three-dimensional flow with an equatorial torus, polar nozzle, and compact twisted orbit.",
    parameters: {
      a: { label: "a · vertical gain", min: 0.8, max: 1.1, step: 0.001, default: 0.95 },
      b: { label: "b · radial offset", min: 0.5, max: 0.9, step: 0.001, default: 0.7 },
      c: { label: "c · vertical drive", min: 0.4, max: 0.8, step: 0.001, default: 0.6 },
      d: { label: "d · rotation", min: 2.5, max: 4.5, step: 0.001, default: 3.5 },
      e: { label: "e · torus coupling", min: 0.1, max: 0.4, step: 0.001, default: 0.25 },
      f: { label: "f · nozzle coupling", min: 0.05, max: 0.15, step: 0.001, default: 0.1 },
    },
    defaults: { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 },
    defaultConfig: { burnIn: 1800, steps: 9000, dt: 0.01, hardRadius: 20, initial: [0.1, 0, 0] },
    simulate(params = {}, config = {}) {
      return simulateOde(
        SYSTEMS.aizawa,
        params,
        config,
        ([x, y, z], { a, b, c, d, e, f }) => [
          (z - b) * x - d * y,
          d * x + (z - b) * y,
          c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * (x * x * x),
        ],
        undefined,
        () => ({
          divergence: {
            kind: "state-dependent",
            formula: "a + 2(z − b) − z² − e(x² + y²) + f x³",
          },
        }),
      );
    },
  },

  rossler: {
    id: "rossler",
    name: "Rössler attractor",
    shortName: "Rössler",
    kind: "ode",
    equation: "ẋ=−y−z; ẏ=x+ay; ż=b+z(x−c)",
    description: "A classical fold-and-stretch flow with a thin spiral sheet and abrupt reinjection.",
    parameters: {
      a: { label: "a · planar growth", min: 0.1, max: 0.4, step: 0.001, default: 0.2 },
      b: { label: "b · vertical drive", min: 0.1, max: 0.4, step: 0.001, default: 0.2 },
      c: { label: "c · reinjection", min: 4, max: 14, step: 0.001, default: 5.7 },
    },
    defaults: { a: 0.2, b: 0.2, c: 5.7 },
    defaultConfig: { burnIn: 2500, steps: 10000, dt: 0.01, hardRadius: 160, initial: [0.1, 0, 0] },
    simulate(params = {}, config = {}) {
      return simulateOde(
        SYSTEMS.rossler,
        params,
        config,
        ([x, y, z], { a, b, c }) => [-y - z, x + a * y, b + z * (x - c)],
        undefined,
        () => ({
          divergence: {
            kind: "state-dependent",
            formula: "a + x − c",
          },
        }),
      );
    },
  },

  thomas: {
    id: "thomas",
    name: "Thomas cyclic attractor",
    shortName: "Thomas",
    kind: "ode",
    equation: "ẋ=sin(y)−bx; ẏ=sin(z)−by; ż=sin(x)−bz",
    description: "A cyclically symmetric dissipative flow whose small damping parameter opens a soft chaotic labyrinth.",
    parameters: { b: { label: "b · damping", min: 0.15, max: 0.35, step: 0.0001, default: 0.208186 } },
    defaults: { b: 0.208186 },
    defaultConfig: { burnIn: 2500, steps: 10000, dt: 0.02, hardRadius: 20, initial: [0.1, 0, 0] },
    simulate(params = {}, config = {}) {
      return simulateOde(
        SYSTEMS.thomas,
        params,
        config,
        ([x, y, z], { b }) => [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z],
        undefined,
        ({ b }, { initial }) => ({
          divergence: -3 * b,
          symmetryBreakingInitial: !(initial[0] === initial[1] && initial[1] === initial[2]),
        }),
      );
    },
  },
};

export const SYSTEM_LIST = Object.values(SYSTEMS);

export function getSystem(id) {
  if (typeof id !== "string" || !Object.hasOwn(SYSTEMS, id)) {
    throw new Error(`Unknown dynamical-system family: ${String(id)}`);
  }
  return SYSTEMS[id];
}

export function simulateSystem(id, params, config) {
  const system = getSystem(id);
  return system.simulate(params, config);
}
