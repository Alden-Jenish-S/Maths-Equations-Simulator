/** DOM-free geometry and mechanics. Parameter conventions are in docs/GEOMETRY.md. */
const TAU = 2 * Math.PI;
const POLE_EPSILON = 1e-12;
const MAX_SAMPLES = 100000;

const parameter = (label, min, max, step, value) => Object.freeze({ label, min, max, step, default: value });
const scale = (label, value = 1) => parameter(label, 0.05, 10, 0.01, value);

function curve(id, name, family, equation, description, parameters, domain, closed) {
  return Object.freeze({
    id, name, family, equation, description,
    defaults: Object.freeze(Object.fromEntries(Object.entries(parameters).map(([key, schema]) => [key, schema.default]))),
    parameters: Object.freeze(parameters), domain: Object.freeze(domain), closed,
  });
}

export const CURVE_LIST = Object.freeze([
  curve("circle", "Circle", "Conics", "x = r cos t; y = r sin t", "A circle with six dimensionless circular-function channels.",
    { radius: scale("r · radius") }, [0, TAU], true),
  curve("ellipse", "Ellipse", "Conics", "x = a cos t; y = b sin t", "An ellipse parameterized by eccentric angle, not arc length.",
    { a: scale("a · horizontal semiaxis", 1.5), b: scale("b · vertical semiaxis") }, [0, TAU], true),
  curve("hyperbola", "Hyperbola", "Conics", "x = a cosh t; y = b sinh t", "The right branch of x²/a² − y²/b² = 1, with six hyperbolic channels.",
    { a: scale("a · horizontal scale"), b: scale("b · vertical scale") }, [-2, 2], false),
  curve("parabola", "Parabola", "Conics", "x = t; y = a t²", "A finite window of a parabola, including its regular vertex.",
    { a: parameter("a · quadratic coefficient", -2, 2, 0.01, 0.5) }, [-2, 2], false),
  curve("involute", "Circle involute", "Roulette", "x = r(cos t + t sin t); y = r(sin t − t cos t)", "The endpoint of a taut string unwinding from a circle; t = 0 is singular.",
    { radius: scale("r · base circle radius") }, [0, 2 * TAU], false),
  curve("superellipse", "Lamé superellipse", "Implicit", "|x/a|ⁿ + |y/b|ⁿ = 1", "Includes the astroid (n = 2/3), diamond (1), ellipse (2), and rounded rectangle (4).",
    { a: scale("a · horizontal semiaxis", 1.5), b: scale("b · vertical semiaxis"), exponent: parameter("n · Lamé exponent", 2 / 3, 4, 0.01, 2) }, [0, TAU], true),
  curve("lemniscate", "Bernoulli lemniscate", "Implicit", "x = a cos t/(1 + sin² t); y = a sin t cos t/(1 + sin² t)", "A continuous traversal of both lobes, including the regular crossing at the origin.",
    { a: scale("a · lobe extent", 1.5) }, [0, TAU], true),
  curve("cardioid", "Cardioid", "Roulette", "ρ = a(1 − cos t); (x,y) = ρ(cos t,sin t)", "A one-cusped epicycloid in polar form.",
    { a: scale("a · scale") }, [0, TAU], true),
  curve("deltoid", "Deltoid", "Roulette", "x = a(2 cos t + cos 2t); y = a(2 sin t − sin 2t)", "A three-cusped hypocycloid with fixed-to-rolling radius ratio 3:1.",
    { a: scale("a · rolling radius", 0.6) }, [0, TAU], true),
  curve("nephroid", "Nephroid", "Roulette", "x = a(3 cos t − cos 3t); y = a(3 sin t − sin 3t)", "A two-cusped epicycloid with fixed-to-rolling radius ratio 2:1.",
    { a: scale("a · rolling radius", 0.5) }, [0, TAU], true),
  curve("archimedean", "Archimedean spiral", "Spirals", "ρ = a + bt; (x,y) = ρ(cos t,sin t)", "Radius increases linearly with angle over a finite three-turn window.",
    { a: parameter("a · initial radius", 0, 3, 0.01, 0), b: parameter("b · radial growth", 0.01, 1, 0.01, 0.15) }, [0, 3 * TAU], false),
  curve("logarithmic", "Logarithmic spiral", "Spirals", "ρ = a exp(bt); (x,y) = ρ(cos t,sin t)", "An equiangular spiral; b = 0 reduces to a circle.",
    { a: scale("a · initial radius", 0.2), b: parameter("b · exponential growth", -0.3, 0.3, 0.01, 0.12) }, [0, 3 * TAU], false),
  curve("clothoid", "Euler clothoid", "Spirals", "x = ∫₀ᵗ cos(au²/2) du; y = ∫₀ᵗ sin(au²/2) du", "Unit-speed Euler spiral with signed curvature rate a and cached numerical position integrals.",
    { a: parameter("a · curvature rate", -2, 2, 0.01, 1) }, [-6, 6], false),
  curve("helix", "Circular helix", "Space curves", "x = r cos t; y = r sin t; z = pt", "A three-dimensional helix; pitch is vertical distance per radian.",
    { radius: scale("r · radius"), pitch: parameter("p · rise per radian", -1, 1, 0.01, 0.15) }, [0, 2 * TAU], false),
]);

export const CURVES = Object.freeze(Object.fromEntries(CURVE_LIST.map((entry) => [entry.id, entry])));

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function number(value, label, min = -Infinity, max = Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  if (value < min || value > max) throw new RangeError(`${label} must be in [${min}, ${max}]`);
  return value;
}

function sampleCount(count) {
  number(count, "count", 2, MAX_SAMPLES);
  if (!Number.isInteger(count)) throw new RangeError("count must be an integer");
  return count;
}

function curveParameters(id, params) {
  if (!Object.hasOwn(CURVES, id)) throw new RangeError(`Unknown curve: ${id}`);
  record(params, "params");
  const definition = CURVES[id];
  const resolved = {};
  for (const [key, schema] of Object.entries(definition.parameters)) {
    resolved[key] = number(params[key] === undefined ? schema.default : params[key], key, schema.min, schema.max);
  }
  return resolved;
}

// Exact axis values avoid fractional powers of trig roundoff at cusps.
function trig(t) {
  const c = Math.cos(t), s = Math.sin(t);
  return [Math.abs(c) < 1e-14 ? 0 : c, Math.abs(s) < 1e-14 ? 0 : s];
}

function polarJet(t, radius, first, second) {
  const [c, s] = trig(t);
  return {
    point: [radius * c, radius * s],
    first: [first * c - radius * s, first * s + radius * c],
    second: [(second - radius) * c - 2 * first * s, (second - radius) * s + 2 * first * c],
  };
}

function quotientJet(n, d) {
  const value = n[0] / d[0];
  const first = (n[1] - value * d[1]) / d[0];
  return [value, first, (n[2] - value * d[2] - 2 * first * d[1]) / d[0]];
}

// Eight-point Gauss–Legendre quadrature on short cells. Only the residual cell
// is integrated on a cache hit; at most eight parameter tables are retained.
const GL_NODES = [0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
const GL_WEIGHTS = [0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
const CLOTHOID_CELL = 1 / 32;
const clothoidCache = new Map();

function integrateClothoid(a, lo, hi) {
  const half = (hi - lo) / 2, middle = (hi + lo) / 2;
  let x = 0, y = 0;
  for (let i = 0; i < GL_NODES.length; i += 1) {
    for (const sign of [-1, 1]) {
      const u = middle + sign * half * GL_NODES[i];
      const angle = a * u * u / 2;
      x += GL_WEIGHTS[i] * Math.cos(angle);
      y += GL_WEIGHTS[i] * Math.sin(angle);
    }
  }
  return [half * x, half * y];
}

function clothoidPoint(a, t) {
  number(t, "clothoid t", -32, 32);
  if (a === 0) return [t, 0];
  let table = clothoidCache.get(a);
  if (!table) {
    if (clothoidCache.size === 8) clothoidCache.delete(clothoidCache.keys().next().value);
    table = [[0, 0]];
  }
  clothoidCache.delete(a);
  clothoidCache.set(a, table);
  const u = Math.abs(t), index = Math.floor(u / CLOTHOID_CELL);
  while (table.length <= index) {
    const i = table.length;
    const piece = integrateClothoid(a, (i - 1) * CLOTHOID_CELL, i * CLOTHOID_CELL);
    table.push([table[i - 1][0] + piece[0], table[i - 1][1] + piece[1]]);
  }
  const residual = integrateClothoid(a, index * CLOTHOID_CELL, u);
  const sign = t < 0 ? -1 : 1;
  return [sign * (table[index][0] + residual[0]), sign * (table[index][1] + residual[1])];
}

function superellipseJet(p, t) {
  const [c, s] = trig(t), n = p.exponent;
  if (n < 2) {
    const q = 2 / n;
    const power = (u) => Math.sign(u) * Math.abs(u) ** q;
    const point = [p.a * power(c), p.b * power(s)];
    // Axis cusps/corners or a singular angular parameter: no fabricated frame.
    if (c === 0 || s === 0) return { point, first: [0, 0], second: [0, 0], singular: true };
    const derivative = (u) => q * Math.abs(u) ** (q - 1);
    const second = (u) => q * (q - 1) * Math.sign(u) * Math.abs(u) ** (q - 2);
    return {
      point,
      first: [-p.a * derivative(c) * s, p.b * derivative(s) * c],
      second: [p.a * (second(c) * s * s - derivative(c) * c), p.b * (second(s) * c * c - derivative(s) * s)],
    };
  }
  // Scaled polar angle gives finite speed at the flat axes for n > 2. For
  // n = 2 it agrees exactly with the usual eccentric-angle ellipse.
  const sum = Math.abs(c) ** n + Math.abs(s) ** n;
  const sum1 = n * (-Math.sign(c) * Math.abs(c) ** (n - 1) * s + Math.sign(s) * Math.abs(s) ** (n - 1) * c);
  const sum2 = n * ((n - 1) * (Math.abs(c) ** (n - 2) * s * s + Math.abs(s) ** (n - 2) * c * c) - sum);
  const radius = sum ** (-1 / n);
  const first = -radius * sum1 / (n * sum);
  const second = radius * ((1 / n + 1 / (n * n)) * (sum1 / sum) ** 2 - sum2 / (n * sum));
  const jet = polarJet(t, radius, first, second);
  for (const key of ["point", "first", "second"]) jet[key] = [p.a * jet[key][0], p.b * jet[key][1]];
  return jet;
}

function curveJet(id, p, t) {
  const [c, s] = trig(t);
  switch (id) {
    case "circle": return { point: [p.radius * c, p.radius * s], first: [-p.radius * s, p.radius * c], second: [-p.radius * c, -p.radius * s] };
    case "ellipse": return { point: [p.a * c, p.b * s], first: [-p.a * s, p.b * c], second: [-p.a * c, -p.b * s] };
    case "hyperbola": {
      const ch = Math.cosh(t), sh = Math.sinh(t);
      return { point: [p.a * ch, p.b * sh], first: [p.a * sh, p.b * ch], second: [p.a * ch, p.b * sh] };
    }
    case "parabola": return { point: [t, p.a * t * t], first: [1, 2 * p.a * t], second: [0, 2 * p.a] };
    case "involute": return { point: [p.radius * (c + t * s), p.radius * (s - t * c)], first: [p.radius * t * c, p.radius * t * s], second: [p.radius * (c - t * s), p.radius * (s + t * c)] };
    case "superellipse": return superellipseJet(p, t);
    case "lemniscate": {
      const denominator = [1 + s * s, 2 * s * c, 2 * (c * c - s * s)];
      const x = quotientJet([p.a * c, -p.a * s, -p.a * c], denominator);
      const y = quotientJet([p.a * s * c, p.a * (c * c - s * s), -4 * p.a * s * c], denominator);
      return { point: [x[0], y[0]], first: [x[1], y[1]], second: [x[2], y[2]] };
    }
    case "cardioid": return polarJet(t, p.a * (1 - c), p.a * s, p.a * c);
    case "deltoid": return {
      point: [p.a * (2 * c + Math.cos(2 * t)), p.a * (2 * s - Math.sin(2 * t))],
      first: [-2 * p.a * (s + Math.sin(2 * t)), 2 * p.a * (c - Math.cos(2 * t))],
      second: [-2 * p.a * (c + 2 * Math.cos(2 * t)), 2 * p.a * (-s + 2 * Math.sin(2 * t))],
    };
    case "nephroid": return {
      point: [p.a * (3 * c - Math.cos(3 * t)), p.a * (3 * s - Math.sin(3 * t))],
      first: [3 * p.a * (-s + Math.sin(3 * t)), 3 * p.a * (c - Math.cos(3 * t))],
      second: [3 * p.a * (-c + 3 * Math.cos(3 * t)), 3 * p.a * (-s + 3 * Math.sin(3 * t))],
    };
    case "archimedean": return polarJet(t, p.a + p.b * t, p.b, 0);
    case "logarithmic": {
      const radius = p.a * Math.exp(p.b * t);
      return polarJet(t, radius, p.b * radius, p.b * p.b * radius);
    }
    case "clothoid": {
      const angle = p.a * t * t / 2;
      return { point: clothoidPoint(p.a, t), first: [Math.cos(angle), Math.sin(angle)], second: [-p.a * t * Math.sin(angle), p.a * t * Math.cos(angle)] };
    }
    case "helix": return { point: [p.radius * c, p.radius * s, p.pitch * t], first: [-p.radius * s, p.radius * c, p.pitch], second: [-p.radius * c, -p.radius * s, 0] };
    default: throw new RangeError(`Unknown curve: ${id}`);
  }
}

const divide = (numerator, denominator) => Math.abs(denominator) <= POLE_EPSILON ? null : numerator / denominator;

function frameForCurve(id, p, t) {
  number(t, "t", -1e6, 1e6);
  const jet = curveJet(id, p, t);
  if (![...jet.point, ...jet.first, ...jet.second].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e100)) {
    throw new RangeError("Curve evaluation exceeds the finite numerical range");
  }
  let speed = Math.hypot(...jet.first);
  const degenerate = Boolean(jet.singular) || speed <= 1e-12;
  let tangent, normal, curvature;
  if (degenerate) {
    speed = 0;
    tangent = jet.point.map(() => 0);
    normal = jet.point.map(() => 0);
    curvature = null;
  } else {
    tangent = jet.first.map((v) => v / speed);
    if (jet.point.length === 3) {
      const projection = jet.second.reduce((sum, v, i) => sum + v * tangent[i], 0);
      const perpendicular = jet.second.map((v, i) => v - projection * tangent[i]);
      const magnitude = Math.hypot(...perpendicular);
      normal = magnitude > 1e-12 ? perpendicular.map((v) => v / magnitude) : [0, 0, 0];
      curvature = magnitude / speed / speed;
    } else {
      normal = [-tangent[1], tangent[0]];
      // Normalize first to avoid cubing very large speeds.
      curvature = Math.abs(tangent[0] * (jet.second[1] / speed) - tangent[1] * (jet.second[0] / speed)) / speed;
    }
  }
  const channels = { x: jet.point[0], y: jet.point[1], tangentX: degenerate ? null : tangent[0], tangentY: degenerate ? null : tangent[1], normalX: degenerate ? null : normal[0], normalY: degenerate ? null : normal[1], speed, curvature };
  if (jet.point.length === 3) Object.assign(channels, { z: jet.point[2], tangentZ: tangent[2], normalZ: normal[2] });
  if (id === "circle") {
    const [c, s] = trig(t);
    Object.assign(channels, { sin: s, cos: c, tan: divide(s, c), cot: divide(c, s), sec: divide(1, c), csc: divide(1, s) });
  } else if (id === "hyperbola") {
    const ch = Math.cosh(t), sh = Math.sinh(t);
    Object.assign(channels, { cosh: ch, sinh: sh, tanh: Math.tanh(t), sech: 1 / ch, csch: divide(1, sh), coth: divide(ch, sh) });
  }
  return { point: jet.point, tangent, normal, curvature, speed, channels, singular: degenerate || Object.values(channels).some((v) => v === null) };
}

export function curveFrame(id, params = {}, t = 0) {
  return frameForCurve(id, curveParameters(id, params), t);
}

function interiorPole(lo, hi, offset, period) {
  const k = Math.floor((lo - offset) / period) + 1;
  const pole = offset + k * period;
  return pole > lo + POLE_EPSILON && pole < hi - POLE_EPSILON;
}

export function sampleCurve(id, params = {}, count = 720) {
  const p = curveParameters(id, params);
  sampleCount(count);
  const definition = CURVES[id], domain = [...definition.domain];
  const points = [], channels = {}, parameters = [];
  for (let i = 0; i < count; i += 1) {
    const t = domain[0] + (domain[1] - domain[0]) * i / (count - 1);
    const frame = frameForCurve(id, p, t);
    parameters.push(t);
    points.push(frame.point);
    for (const [key, value] of Object.entries(frame.channels)) (channels[key] ??= []).push(value);
  }
  // A uniform grid need not land on a pole. Remove both bracketing values so
  // a renderer that breaks at null cannot draw an asymptote-spanning segment.
  for (let i = 1; i < count; i += 1) {
    const lo = parameters[i - 1], hi = parameters[i];
    let gaps = [];
    if (id === "circle") {
      if (interiorPole(lo, hi, Math.PI / 2, Math.PI)) gaps.push("tan", "sec");
      if (interiorPole(lo, hi, 0, Math.PI)) gaps.push("cot", "csc");
    } else if (id === "hyperbola" && lo < 0 && hi > 0) gaps = ["csch", "coth"];
    for (const key of gaps) channels[key][i - 1] = channels[key][i] = null;
  }
  return { points, channels, metadata: { id, count, params: { ...p }, domain, parameters, closed: definition.closed } };
}

export const SPIROGRAPH_DEFAULTS = Object.freeze({ R: 5, r: 3, d: 2, mode: "hypotrochoid" });

function spirographParameters(params) {
  record(params, "params");
  const p = { ...SPIROGRAPH_DEFAULTS };
  for (const key of ["R", "r", "d"]) p[key] = number(params[key] === undefined ? p[key] : params[key], key, key === "d" ? 0 : 1e-4, 1e4);
  p.mode = params.mode === undefined ? p.mode : params.mode;
  if (!["hypotrochoid", "epitrochoid", "rose"].includes(p.mode)) throw new RangeError(`Unknown spirograph mode: ${p.mode}`);
  if (p.mode === "hypotrochoid" && p.R < p.r) throw new RangeError("A hypotrochoid requires R >= r");
  if (p.R / p.r > 1e4) throw new RangeError("R/r must not exceed 10000");
  return p;
}

function spiroPoint(p, t, phase) {
  if (p.mode === "rose") {
    const radius = p.d * Math.cos(p.R / p.r * t + phase);
    return [radius * Math.cos(t), radius * Math.sin(t)];
  }
  const inside = p.mode === "hypotrochoid";
  const centerRadius = p.R + (inside ? -p.r : p.r);
  const angle = centerRadius / p.r * t + phase;
  return [centerRadius * Math.cos(t) + (inside ? 1 : -1) * p.d * Math.cos(angle), centerRadius * Math.sin(t) - p.d * Math.sin(angle)];
}

export function spirographPoint(params = {}, t = 0, phase = 0) {
  return spiroPoint(spirographParameters(params), number(t, "t", -1e6, 1e6), number(phase, "phase", -1e6, 1e6));
}

function gearTurns(p) {
  if (p.d === 0 || (p.mode === "hypotrochoid" && p.R === p.r)) return 1;
  const ratio = p.R / p.r;
  for (let q = 1; q <= 512; q += 1) {
    if (Math.abs(ratio * q - Math.round(ratio * q)) <= 1e-10) return q;
  }
  return null;
}

export function generateSpirograph(params = {}, count = 2400) {
  const p = spirographParameters(params);
  sampleCount(count);
  const phase = number(params.phase === undefined ? 0 : params.phase, "phase", -1e6, 1e6);
  const turns = gearTurns(p), end = TAU * (turns ?? 10);
  const points = Array.from({ length: count }, (_, i) => spiroPoint(p, end * i / (count - 1), phase));
  return { points, metadata: { params: { ...p, phase }, count, domain: [0, end], closed: turns !== null, turns: turns ?? 10, period: turns === null ? null : end } };
}

export const PENDULUM_DEFAULTS = Object.freeze({ length1: 1, length2: 1, mass1: 1, mass2: 1, gravity: 9.81, damping: 0 });
const PENDULUM_RANGES = { length1: [0.01, 100], length2: [0.01, 100], mass1: [0.001, 1000], mass2: [0.001, 1000], gravity: [0, 100], damping: [0, 100] };
const INITIAL_PENDULUM = { t: 0, theta1: Math.PI / 2, theta2: Math.PI / 2 + 0.1, omega1: 0, omega2: 0 };
const STATE_LIMITS = { t: 1e9, theta1: 1e6, theta2: 1e6, omega1: 1e4, omega2: 1e4 };

function pendulumParameters(params) {
  record(params, "params");
  return Object.fromEntries(Object.entries(PENDULUM_DEFAULTS).map(([key, value]) => [key, number(params[key] === undefined ? value : params[key], key, ...PENDULUM_RANGES[key])]));
}

function validateState(state) {
  record(state, "state");
  for (const [key, limit] of Object.entries(STATE_LIMITS)) number(state[key], key, -limit, limit);
  if (typeof state.diverged !== "boolean" && state.diverged !== undefined) throw new TypeError("state.diverged must be boolean");
}

export function createDoublePendulum(initial = {}) {
  record(initial, "initial");
  const state = { ...INITIAL_PENDULUM, diverged: false };
  for (const key of Object.keys(INITIAL_PENDULUM)) if (initial[key] !== undefined) state[key] = initial[key];
  validateState(state);
  return state;
}

function pendulumFrame(state, p) {
  const { theta1: a, theta2: b, omega1: u, omega2: v } = state;
  const { length1: l1, length2: l2, mass1: m1, mass2: m2, gravity: g } = p;
  const bob1 = [l1 * Math.sin(a), -l1 * Math.cos(a)];
  const bob2 = [bob1[0] + l2 * Math.sin(b), bob1[1] - l2 * Math.cos(b)];
  const kinetic = 0.5 * (m1 + m2) * l1 * l1 * u * u + 0.5 * m2 * l2 * l2 * v * v + m2 * l1 * l2 * u * v * Math.cos(a - b);
  const potential = -(m1 + m2) * g * l1 * Math.cos(a) - m2 * g * l2 * Math.cos(b);
  return { point: bob2, geometry: { origin: [0, 0], bob1, bob2 }, phaseSpace: [a, b], energy: kinetic + potential, bounded: !state.diverged, diverged: Boolean(state.diverged) };
}

export function doublePendulumFrame(state, params = {}) {
  validateState(state);
  return pendulumFrame(state, pendulumParameters(params));
}

function pendulumDerivative(y, p) {
  const [a, b, u, v] = y;
  const { length1: l1, length2: l2, mass1: m1, mass2: m2, gravity: g, damping } = p;
  const sin = Math.sin(a - b), cos = Math.cos(a - b);
  const m11 = (m1 + m2) * l1 * l1, m12 = m2 * l1 * l2 * cos, m22 = m2 * l2 * l2;
  const f1 = -m2 * l1 * l2 * sin * v * v - (m1 + m2) * g * l1 * Math.sin(a) - damping * u;
  const f2 = m2 * l1 * l2 * sin * u * u - m2 * g * l2 * Math.sin(b) - damping * v;
  // Algebraic determinant avoids cancellation when the rods are aligned.
  const determinant = m2 * l1 * l1 * l2 * l2 * (m1 + m2 * sin * sin);
  return [u, v, (m22 * f1 - m12 * f2) / determinant, (m11 * f2 - m12 * f1) / determinant];
}

function boundedVector(y) {
  return y.every((v, i) => Number.isFinite(v) && Math.abs(v) <= (i < 2 ? 1e6 : 1e4));
}

function rk4Pendulum(y, p, dt) {
  const k1 = pendulumDerivative(y, p);
  const stage = (k, h) => y.map((v, i) => v + h * k[i]);
  const y2 = stage(k1, dt / 2);
  if (!boundedVector(y2)) return null;
  const k2 = pendulumDerivative(y2, p), y3 = stage(k2, dt / 2);
  if (!boundedVector(y3)) return null;
  const k3 = pendulumDerivative(y3, p), y4 = stage(k3, dt);
  if (!boundedVector(y4)) return null;
  const k4 = pendulumDerivative(y4, p);
  const next = y.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  return boundedVector(next) ? next : null;
}

function stableStep(y, p) {
  const { length1: l1, length2: l2, mass1: m1, mass2: m2 } = p;
  // det(M)/trace(M) is a lower bound on the smaller mass-matrix eigenvalue.
  // Use its global (aligned-rod) minimum for the viscous damping timescale.
  const inertia = m1 * m2 * l1 * l1 * l2 * l2 / ((m1 + m2) * l1 * l1 + m2 * l2 * l2);
  return Math.min(1 / 120, 0.1 / (1 + Math.max(Math.abs(y[2]), Math.abs(y[3]))),
    p.gravity === 0 ? Infinity : 0.1 / Math.sqrt(p.gravity * (m1 + m2) / (m1 * Math.min(l1, l2))),
    p.damping === 0 ? Infinity : 0.1 * inertia / p.damping);
}

export function stepDoublePendulum(state, params = {}, dt = 1 / 240) {
  validateState(state);
  const p = pendulumParameters(params);
  number(dt, "dt", 0, 1e6);
  if (state.diverged || dt === 0) return pendulumFrame(state, p);
  let next = [state.theta1, state.theta2, state.omega1, state.omega2];
  let remaining = dt, steps = 0, failure = null;
  if (Math.abs(state.t + dt) > STATE_LIMITS.t || state.t + dt === state.t) failure = "Time guard exceeded";
  while (!failure && remaining > 0) {
    const maximum = stableStep(next, p);
    if (steps >= 512 || remaining / maximum > 512 - steps + 1e-9) {
      failure = "RK4 substep budget exceeded";
      break;
    }
    const h = Math.min(remaining, maximum);
    const candidate = rk4Pendulum(next, p, h);
    if (!candidate) {
      failure = "RK4 state guard exceeded";
      break;
    }
    next = candidate;
    remaining -= h;
    if (remaining <= dt * 1e-14) remaining = 0;
    steps += 1;
  }
  if (failure) {
    // Transactional failure: preserve all numerical fields, including time.
    state.diverged = true;
    state.reason = failure;
  } else {
    [state.theta1, state.theta2, state.omega1, state.omega2] = next;
    state.t += dt;
  }
  return pendulumFrame(state, p);
}
