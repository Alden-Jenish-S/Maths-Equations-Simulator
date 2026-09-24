import { SYSTEMS, SYSTEM_LIST } from "./systems.js";
import { CURVES, CURVE_LIST, sampleCurve, curveFrame, generateSpirograph, spirographPoint, createDoublePendulum, stepDoublePendulum, doublePendulumFrame } from "./art-modes.js";
import { HARMONIC_PRESET_LIST, presetHarmonics, buildEpicycleState, evaluateHarmonics, audioDescriptorForHarmonics, createAudioController } from "./audio.js";
import { LIVE_SYSTEM_LIST, getLiveSystem, createLiveState, advanceLive, rebuildLiveWindow } from "./live.js";
import { STUDIO_PALETTES, renderStudio, boundsOf, projectHelix, buildMotionBins } from "./studio-renderer.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fmt = (v, n = 2) => Number.isFinite(v) ? Math.abs(v) >= 1e5 ? v.toExponential(2) : v.toFixed(n) : "—";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const audio = createAudioController();
const canvas = $("trace-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const modeNames = { atlas: "Dynamical atlas", unwrap: "Parametric study", fourier: "Harmonic observatory", spirograph: "Rolling gear laboratory", pendulum: "Nonlinear dynamics", live: "Signal laboratory" };
const control = (label, min, max, step, value) => ({ label, min, max, step, default: value });
const state = {
  mode: "atlas", playing: !reducedMotion.matches, speed: 1, persistence: .7, glow: .55,
  palette: "Neon Cyberpunk", time: 0, showGrid: true, showAxes: true, vectors: true,
  dirty: true, raf: 0, lastFrame: null, lastTelemetry: -Infinity, frameCount: 0,
  drawMs: 0, budget: 14000, rendered: 0, width: 1, height: 1, dpr: 1,
  atlas: { familyId: "henon", discoveryId: "default", discoveries: [], params: {}, result: null, projection: "x-y", points: [], bounds: boundsOf([]), cursor: 0, version: 0, busy: false, queued: null },
  unwrap: { id: "circle", params: { ...CURVES.circle.defaults }, domain: [...CURVES.circle.domain], phase: 0, data: null, cache: new Map(), error: null, projection: "function", channelSet: "function", display: "scrolling-history", osculating: false, history: [], historyStep: 1 / 120, historyClock: 0, historyMax: 900, historyAccumulator: 0 },
  fourier: { preset: "square", count: 8, terms: presetHarmonics("square", 8), phase: 0, pitch: 110, volume: .12, revision: 0, muted: true, error: null, waveform: [], waveformKey: "" },
  spirograph: { params: { R: 5, r: 3, d: 2, pens: 3, mode: "hypotrochoid" }, phase: 0, trails: [], domain: [0, TAU * 3], bounds: boundsOf([]), error: null },
  pendulum: { params: { length1: 1, length2: 1, mass1: 1, mass2: 1, gravity: 9.81, damping: 0, theta1: 1.35, theta2: 1.7 }, model: null, frame: null, trail1: [], trail2: [], phase: [], accumulator: 0, dropped: 0, error: null },
  live: { id: "fourier", params: { ...getLiveSystem("fourier").defaults }, model: null, points: [], accumulator: 0, dropped: 0 },
};

function status(message, tone = "ready") { $("status-text").textContent = message; $("status-pill").className = `status-pill ${tone}`; }
function overlay(message = "") { $("canvas-overlay").textContent = message; $("canvas-overlay").classList.toggle("hidden", !message); }
function options(select, entries) { select.replaceChildren(...entries.map(([id, name]) => new Option(name, id))); }
function defaults(schemas, source = {}) { return Object.fromEntries(Object.entries(schemas).map(([key, schema]) => [key, Number(source[key] ?? schema.default)])); }
function invalidate() { state.dirty = true; schedule(); }
function parameters(containerId, schemas, values, onChange, prefix) {
  const container = $(containerId); container.replaceChildren();
  for (const [key, schema] of Object.entries(schemas)) {
    const row = document.createElement("div"); row.className = "parameter-row";
    const label = document.createElement("label"); label.className = "parameter-label";
    const text = document.createElement("span"); text.textContent = schema.label;
    const output = document.createElement("output"); output.className = "parameter-value";
    const input = document.createElement("input"); input.type = "range"; input.id = `${prefix}-parameter-${key}`;
    input.min = schema.min; input.max = schema.max; input.step = schema.step; input.value = values[key];
    label.htmlFor = input.id; output.htmlFor = input.id;
    const digits = schema.step < .01 ? 3 : schema.step === 1 ? 0 : 2;
    output.textContent = fmt(values[key], digits);
    label.append(text, output);
    const ends = document.createElement("div"); ends.className = "range-meta";
    const start = document.createElement("span"), end = document.createElement("span"); start.textContent = schema.min; end.textContent = schema.max; ends.append(start, end);
    row.append(label, input, ends); container.append(row);
    input.addEventListener("input", () => {
      values[key] = Number(input.value); output.textContent = fmt(values[key], digits);
      onChange(key); invalidate();
    });
  }
}

// Only one atlas request runs at once. Edits replace the queued job and invalidate
// previous replies immediately, including replies arriving during the debounce.
let worker, atlasTimer;
function selectedDiscovery() { return state.atlas.discoveries.find((d) => d.id === state.atlas.discoveryId); }
function loadFamily(resetSelection = true) {
  const a = state.atlas, system = SYSTEMS[a.familyId], candidates = a.discoveries.filter((d) => d.family === a.familyId);
  a.result = null; a.points = []; a.bounds = boundsOf([]); a.motion = null;
  options($("discovery-select"), [["default", "System reference parameters"], ...candidates.map((d, i) => [d.id, `Discovery ${i + 1} · ${d.class ?? "retained"}`])]);
  if (resetSelection) a.discoveryId = candidates[0]?.id ?? "default";
  $("discovery-select").value = a.discoveryId;
  a.params = defaults(system.parameters, selectedDiscovery()?.parameters ?? system.defaults);
  $("family-description").textContent = system.description;
  parameters("parameter-controls", system.parameters, a.params, requestAtlas, "atlas");
  const hasZ = ["lorenz", "aizawa", "rossler", "thomas"].includes(a.familyId);
  $("projection-select").disabled = !hasZ;
  if (!hasZ) { a.projection = "x-y"; $("projection-select").value = a.projection; }
  if (state.mode === "atlas") { sceneText(); invalidate(); }
}
// Stored discoveries are explicitly labelled as compact replays. Regenerate or
// any parameter edit requests a fresh 12,000-step worker run instead.
function selectAtlasSource() {
  const a = state.atlas, d = selectedDiscovery();
  if (!d?.rawPoints?.length) { requestAtlas(); return; }
  clearTimeout(atlasTimer); a.version += 1; a.queued = null; a.replay = true;
  a.result = { familyId: a.familyId, id: a.version, rawPoints: d.rawPoints, points: d.points ?? d.rawPoints, metadata: d.metadata ?? {}, config: d.config ?? {}, metrics: d.metrics ?? {} };
  projectAtlas(); overlay(); status("Stored discovery replay"); sceneText(); invalidate();
}
function requestAtlas() {
  const a = state.atlas; a.version += 1; a.replay = false; clearTimeout(atlasTimer); a.queued = null;
  a.result = null; a.points = []; a.motion = null; a.bounds = boundsOf([]);
  if (state.mode === "atlas") { sceneText(); invalidate(); }
  if (state.mode === "atlas") { overlay("Mapping a new trajectory in the simulation worker…"); status("Computing trajectory", "busy"); }
  atlasTimer = setTimeout(() => {
    const system = SYSTEMS[a.familyId], discovery = selectedDiscovery();
    a.queued = { id: a.version, familyId: a.familyId, params: { ...a.params }, config: { ...system.defaultConfig, ...discovery?.config, steps: 12000 } };
    dispatchAtlas();
  }, 110);
}
function dispatchAtlas() {
  const a = state.atlas;
  if (!worker) { if (state.mode === "atlas") overlay("The simulation worker is unavailable. Serve this project over HTTP and reload; the other instruments remain available."); return; }
  if (a.busy || !a.queued) return;
  a.busy = true; worker.postMessage(a.queued); a.queued = null;
}
function projectAtlas() {
  const a = state.atlas, indices = a.projection.split("-").map((axis) => ({ x: 0, y: 1, z: 2 })[axis]);
  if (a.result?.familyId !== a.familyId) { a.result = null; a.points = []; a.motion = null; a.bounds = boundsOf([]); return; }
  const raw = a.result?.rawPoints ?? [];
  a.points = raw.map((p) => Number.isFinite(p?.[indices[0]]) && Number.isFinite(p?.[indices[1]]) ? [p[indices[0]], p[indices[1]]] : null);
  // Cache against the raw source identity, so projection changes do not change
  // the full-dimensional adjacent-step measurement or recompute its bins.
  if (a.motion?.source !== raw) a.motion = { ...buildMotionBins(raw, SYSTEMS[a.familyId].kind === "ode" && !a.replay ? a.result.config.dt : null), source: raw };
  a.bounds = boundsOf(a.points); a.cursor = 0;
}

function startWorker() {
  try {
    worker = new Worker(new URL("./simulation-worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", ({ data }) => {
      const a = state.atlas; a.busy = false;
      if (data.id === a.version) {
        if (data.type === "error") { if (state.mode === "atlas") { status("Simulation error", "error"); overlay(data.message); } }
        else {
          if (data.familyId !== a.familyId || data.id !== a.version) { dispatchAtlas(); return; }
          a.result = data; projectAtlas();
          if (state.mode === "atlas") {
            const divergent = data.metadata.diverged || data.metrics.classification === "divergent";
            overlay(divergent ? "Divergence detected. The finite prefix is retained for inspection; it is not a scored discovery." : "");
            status(divergent ? "Divergence detected" : "Atlas ready", divergent ? "error" : "ready"); sceneText(); invalidate();
          }
        }
      }
      dispatchAtlas();
    });
    worker.addEventListener("error", () => {
      worker?.terminate(); worker = null; state.atlas.busy = false;
      if (state.mode === "atlas") { status("Worker unavailable", "error"); overlay("Simulation worker failed to load. Reload the HTTP-served page to reconnect it."); }
    });
  } catch { worker = null; }
}

function primaryChannels(id, is3D) {
  if (state.unwrap.channelSet === "moving-frame") return ["vx", "vy", "normalX", "normalY", "curvatureRadius", "speed"];
  if (id === "circle") return ["sin", "cos", "tan", "cot", "sec", "csc"];
  if (id === "hyperbola") return ["cosh", "sinh", "tanh", "sech", "csch", "coth"];
  if (is3D) return ["x", "y", "z", "tangentX", "tangentY", "curvature"];
  return ["x", "y", "tangentX", "tangentY", "speed", "curvature"];
}
function channelValues(sample, name) {
  if (sample.channels[name]) return sample.channels[name];
  if (name === "vx") return sample.channels.tangentX.map((v, i) => v === null ? null : v * sample.channels.speed[i]);
  if (name === "vy") return sample.channels.tangentY.map((v, i) => v === null ? null : v * sample.channels.speed[i]);
  if (name === "curvatureRadius") return sample.channels.curvature.map((v) => v > 1e-12 ? 1 / v : null);
  return Array(sample.points.length).fill(null);
}
function channelPoles(id, name, domain) {
  const result = [], [lo, hi] = domain;
  if (id === "circle" && ["tan", "sec", "cot", "csc"].includes(name)) {
    const offset = ["tan", "sec"].includes(name) ? Math.PI / 2 : 0;
    for (let k = Math.ceil((lo - offset) / Math.PI); offset + k * Math.PI <= hi; k += 1) result.push((offset + k * Math.PI - lo) / (hi - lo));
  } else if (id === "hyperbola" && ["csch", "coth"].includes(name) && lo <= 0 && hi >= 0) result.push(-lo / (hi - lo));
  else if (id === "clothoid" && name === "curvatureRadius" && lo <= 0 && hi >= 0) result.push(-lo / (hi - lo));
  return result;
}
function prepareCurve() {
  const u = state.unwrap, definition = CURVES[u.id], key = JSON.stringify([u.id, u.params, u.domain, u.channelSet]);
  try {
    if (!u.domain.every(Number.isFinite) || u.domain[1] <= u.domain[0] || Math.abs(u.domain[0]) > 100 || Math.abs(u.domain[1]) > 100 || u.domain[1] - u.domain[0] > 100) {
      throw new RangeError("Use a finite, increasing domain within −100…100, spanning at most 100 parameter units.");
    }
    let data = u.cache.get(key);
    if (!data) {
      const count = 961, isDefault = u.domain.every((v, i) => v === definition.domain[i]);
      let sample;
      if (isDefault) sample = sampleCurve(u.id, u.params, count);
      else {
        sample = { points: [], channels: {} };
        for (let i = 0; i < count; i += 1) {
          const frame = curveFrame(u.id, u.params, u.domain[0] + (u.domain[1] - u.domain[0]) * i / (count - 1));
          sample.points.push(frame.point);
          for (const [name, value] of Object.entries(frame.channels)) (sample.channels[name] ??= []).push(value);
        }
      }
      const is3D = sample.points[0].length === 3;
      // The geometry API supplies a left normal for plane curves and unsigned κ.
      // Orient it toward dT/dt so N/κ is the actual curvature-center vector.
      if (!is3D) for (let i = 0; i < count; i += 1) {
        const a = Math.max(0, i - 1), b = Math.min(count - 1, i + 1);
        const tx = sample.channels.tangentX[i], ty = sample.channels.tangentY[i];
        const dx = sample.channels.tangentX[b] - sample.channels.tangentX[a];
        const dy = sample.channels.tangentY[b] - sample.channels.tangentY[a];
        if (tx !== null && ty !== null && tx * dy - ty * dx < 0) {
          sample.channels.normalX[i] *= -1; sample.channels.normalY[i] *= -1;
        }
      }
      const points = sample.points.map(projectHelix);
      const channels = primaryChannels(u.id, is3D).map((name) => {
        const values = [...channelValues(sample, name)], poles = channelPoles(u.id, name, u.domain);
        for (const pole of poles) { const index = pole * (count - 1); values[Math.floor(index)] = null; values[Math.ceil(index)] = null; }
        const max = values.reduce((m, v) => Number.isFinite(v) ? Math.max(m, Math.abs(v)) : m, 0);
        const ratio = ["tan", "cot", "sec", "csc", "csch", "coth", "curvatureRadius"].includes(name);
        const range = Math.max(.01, ratio ? Math.min(6, max) : max * 1.08);
        return { name, range, clipped: max > range, poles, values: values.map((v, i) => Number.isFinite(v) ? [i / (count - 1), v] : null) };
      });
      data = { points, rawPoints: sample.points, channels, bounds: boundsOf(points), is3D, domain: [...u.domain] };
      if (u.cache.size >= 12) u.cache.delete(u.cache.keys().next().value);
      u.cache.set(key, data);
    }
    u.data = data; u.error = null; resetUnwrapHistory();
    if (state.mode === "unwrap") { overlay(); status("Curve ready"); sceneText(); }
  } catch (error) {
    u.error = error.message; u.data = null; u.frame = null; u.history = [];
    if (state.mode === "unwrap") { overlay(error.message); status("Invalid curve domain", "error"); }
  }
  invalidate();
}
function updateCurveFrame() {
  const u = state.unwrap;
  if (!u.data || u.error) return;
  const t = u.domain[0] + u.phase * (u.domain[1] - u.domain[0]);
  try {
    u.frame = curveFrame(u.id, u.params, t);
    const f = u.frame;
    if (f.point.length === 2 && f.speed > 1e-12 && f.curvature > 1e-12) {
      const h = 1e-5, before = curveFrame(u.id, u.params, Math.max(u.domain[0], t - h)), after = curveFrame(u.id, u.params, Math.min(u.domain[1], t + h));
      const turn = f.tangent[0] * (after.tangent[1] - before.tangent[1]) - f.tangent[1] * (after.tangent[0] - before.tangent[0]);
      if (turn < 0) f.normal = f.normal.map((v) => -v);
    }
    f.channels = { ...f.channels, vx: f.channels.tangentX === null ? null : f.tangent[0] * f.speed, vy: f.channels.tangentY === null ? null : f.tangent[1] * f.speed, curvatureRadius: f.curvature > 1e-12 ? 1 / f.curvature : null };
    if (f.speed > 1e-12) { f.channels.normalX = f.normal[0]; f.channels.normalY = f.normal[1]; }
  }
  catch (error) { u.error = error.message; u.data = null; if (state.mode === "unwrap") { overlay(error.message); setPlaying(false); } }
}
const UNWRAP_RATE = .055;
function resetUnwrapHistory() {
  const u = state.unwrap;
  u.history = []; u.historyClock = 0; u.historyAccumulator = 0; u.historyTick = 0;
  updateCurveFrame();
  if (u.data) appendUnwrapSample(false);
}
function appendUnwrapSample(loop) {
  const u = state.unwrap, previous = u.history.at(-1);
  if (!u.frame || !u.data) return;
  const gaps = [];
  for (const channel of u.data.channels) {
    if (loop || (previous && channel.poles.some((pole) => pole > previous.phase && pole <= u.phase + 1e-12))) gaps.push(channel.name);
  }
  // One shared timestamped record: every channel and the geometry correspond to
  // the same actual curveFrame evaluation. Gaps are channel-local at poles.
  u.history.push({ timestamp: u.historyClock, t: u.domain[0] + u.phase * (u.domain[1] - u.domain[0]), phase: u.phase, point: [...u.frame.point], channels: { ...u.frame.channels }, gaps, loop });
  if (u.history.length > u.historyMax) u.history.splice(0, u.history.length - u.historyMax);
}
function advanceUnwrap(delta) {
  const u = state.unwrap;
  if (!u.data || u.error) return;
  u.historyAccumulator += delta;
  let steps = 0;
  while (u.historyAccumulator + 1e-12 >= u.historyStep && steps < 20) {
    const phase = u.phase + u.historyStep * UNWRAP_RATE;
    u.phase = phase % 1; u.historyTick += 1; u.historyClock = u.historyTick * u.historyStep;
    updateCurveFrame(); appendUnwrapSample(phase >= 1);
    u.historyAccumulator = Math.max(0, u.historyAccumulator - u.historyStep); steps += 1;
  }
}

function unwrapScene() {
  const u = state.unwrap;
  if (!u.data) return null;
  let points = u.data.points, frame = u.frame, bounds = u.data.bounds;
  if (u.projection === "moving-frame" && frame) {
    const origin = frame.point, tangent = frame.tangent, normal = frame.normal;
    const map = (p) => [p.reduce((s, v, i) => s + (v - (origin[i] ?? 0)) * (tangent[i] ?? 0), 0), p.reduce((s, v, i) => s + (v - (origin[i] ?? 0)) * (normal[i] ?? 0), 0)];
    points = u.data.rawPoints.map(map);
    const extent = Math.max(u.data.bounds.width, u.data.bounds.height);
    bounds = boundsOf([[-extent, -extent], [extent, extent]]);
    frame = { ...frame, point: [0, 0], tangent: [1, 0], normal: [0, 1] };
  }
  const history = u.display === "scrolling-history", window = 1 + state.persistence * (u.historyMax * u.historyStep - 1);
  const axis = history ? [u.historyClock - window, u.historyClock] : [0, 1];
  const channels = u.data.channels.map((channel) => {
    if (!history) return channel;
    const values = [], poles = [];
    for (const record of u.history) {
      if (record.timestamp < axis[0]) continue;
      if (record.gaps.includes(channel.name)) { values.push(null); poles.push(record.timestamp); }
      const value = record.channels[channel.name];
      values.push(Number.isFinite(value) ? [record.timestamp, value] : null);
    }
    return { ...channel, values, poles };
  });
  return { ...u.data, points, bounds, channels, frame, phase: u.phase, axis, display: u.display, clock: u.historyClock, projection: u.projection, osculating: u.osculating, coordinates: u.frame?.point, trail: trailWindow(points, Math.floor(u.phase * (points.length - 1)), state.persistence) };
}
function curveControls() {
  const u = state.unwrap, definition = CURVES[u.id];
  $("curve-description").textContent = definition.description;
  $("domain-start").value = u.domain[0]; $("domain-end").value = u.domain[1];
  parameters("curve-parameter-controls", definition.parameters, u.params, prepareCurve, "curve");
}

function stopAudio(message = "Audio muted. Enable it again to listen.") {
  state.fourier.revision += 1; state.fourier.muted = true; audio.stop();
  $("audio-button").textContent = "Enable audio"; $("audio-button").setAttribute("aria-pressed", "false");
  $("audio-mute-toggle").checked = true; $("audio-status").textContent = message;
}
async function enableAudio() {
  const f = state.fourier, revision = ++f.revision;
  if (document.hidden || state.mode !== "fourier") return;
  if (!state.playing) setPlaying(true);
  try {
    // start() is called synchronously inside this click/change user gesture.
    await audio.start(f.terms, { pitch: f.pitch, volume: f.volume });
    if (revision !== f.revision || !state.playing || document.hidden || state.mode !== "fourier") return;
    f.muted = !audio.playing;
    $("audio-button").textContent = f.muted ? "Enable audio" : "Mute audio";
    $("audio-button").setAttribute("aria-pressed", String(!f.muted)); $("audio-mute-toggle").checked = f.muted;
    audioNotice(); invalidate();
  } catch (error) { stopAudio(error.message); }
}
function audioNotice() {
  const f = state.fourier, descriptor = audioDescriptorForHarmonics(f.terms, { pitch: f.pitch, volume: f.volume });
  $("audio-status").textContent = `${audio.playing ? "Playing" : "Muted"} · amplitude normalization ${fmt(descriptor.normalization, 3)}. ${descriptor.droppedTerms} terms above Nyquist at 48 kHz preview; actual device rate is used for playback.`;
}
function harmonicsChanged() {
  const f = state.fourier; f.waveformKey = "";
  if (!f.muted) { try { audio.update(f.terms, { pitch: f.pitch, volume: f.volume }); } catch (error) { stopAudio(error.message); } }
  audioNotice(); sceneText(); invalidate();
}
function harmonicEditor() {
  const container = $("harmonic-editor"), f = state.fourier; container.replaceChildren();
  f.terms.forEach((term, index) => {
    const row = document.createElement("div"); row.className = "harmonic-row";
    const n = document.createElement("span"); n.textContent = index + 1; row.append(n);
    for (const [field, title, min, max] of [["amplitude", "A", -16, 16], ["frequency", "f", -128, 128], ["phase", "δ", -TAU, TAU]]) {
      const label = document.createElement("label"); label.textContent = title;
      const input = document.createElement("input"); input.type = "number"; input.min = min; input.max = max; input.step = .01; input.value = term[field];
      input.setAttribute("aria-label", `Harmonic ${index + 1} ${field}`); label.append(input); row.append(label);
      input.addEventListener("input", () => {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value) || value < min || value > max) { input.setAttribute("aria-invalid", "true"); return; }
        input.removeAttribute("aria-invalid"); term[field] = value; f.preset = "custom"; $("harmonic-preset-select").value = "custom"; harmonicsChanged();
      });
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.setAttribute("aria-label", `Remove harmonic ${index + 1}`);
    remove.addEventListener("click", () => { f.terms.splice(index, 1); customCount(); harmonicEditor(); harmonicsChanged(); }); row.append(remove); container.append(row);
  });
  $("add-harmonic-button").disabled = f.terms.length >= 32;
}
function customCount() {
  const f = state.fourier; f.preset = "custom"; f.count = f.terms.length; $("harmonic-preset-select").value = "custom"; fourierControls();
}
function fourierControls() {
  const f = state.fourier;
  parameters("fourier-parameter-controls", { count: control("K · harmonic count / timbre", 0, 32, 1, 8) }, f, () => {
    if (f.preset === "custom") { f.terms = Array.from({ length: f.count }, (_, i) => f.terms[i] ?? { amplitude: .1, frequency: i + 1, phase: 0 }); }
    else f.terms = presetHarmonics(f.preset, f.count);
    harmonicEditor(); harmonicsChanged();
  }, "fourier");
  parameters("audio-parameter-controls", { pitch: control("Pitch · base frequency (Hz)", 40, 440, 1, 110), volume: control("Volume · normalized output", 0, .25, .01, .12) }, f, harmonicsChanged, "audio");
}

function prepareSpirograph() {
  const s = state.spirograph, p = s.params;
  try {
    const count = 2400, result = generateSpirograph(p, count);
    s.domain = result.metadata.domain; s.metadata = result.metadata;
    s.trails = Array.from({ length: p.pens }, (_, pen) => Array.from({ length: count }, (_, i) => spirographPoint(p, s.domain[1] * i / (count - 1), pen * TAU / p.pens)));
    const extent = p.mode === "rose" ? Math.max(.1, p.d) : p.mode === "epitrochoid" ? p.R + 2 * p.r + p.d : Math.max(p.R, p.R - p.r + p.d);
    s.bounds = boundsOf([[-extent, -extent], [extent, extent]]); s.error = null; s.phase = 0;
    if (state.mode === "spirograph") { overlay(); sceneText(); status("Rolling construction ready"); }
  } catch (error) {
    s.error = error.message; s.trails = [];
    if (state.mode === "spirograph") { overlay(error.message); status("Adjust the gear radii", "error"); }
  }
  invalidate();
}
function resetPendulum() {
  const p = state.pendulum; p.model = createDoublePendulum(p.params); p.frame = doublePendulumFrame(p.model, p.params);
  p.trail1 = [p.frame.geometry.bob1]; p.trail2 = [p.frame.geometry.bob2]; p.phase = [p.frame.phaseSpace]; p.accumulator = 0; p.dropped = 0; p.error = null;
  if (state.mode === "pendulum") { overlay(); sceneText(); } invalidate();
}
function resetLive() {
  const live = state.live; live.model = createLiveState(live.id); live.accumulator = 0; live.dropped = 0;
  live.points = rebuildLiveWindow(live.id, live.model, live.params, 1);
  if (state.mode === "live") { overlay(); status("Live source ready"); sceneText(); } invalidate();
}
function liveControls() {
  const l = state.live, source = getLiveSystem(l.id); $("live-description").textContent = source.description;
  parameters("live-parameter-controls", source.parameters, l.params, () => { l.points = rebuildLiveWindow(l.id, l.model, l.params, Math.max(1, l.points.length)); }, "live");
}

function trailWindow(points, currentIndex, fraction) {
  if (!points?.length) return [];
  const count = Math.max(8, Math.floor(points.length * clamp(fraction, .04, 1)));
  if (count >= points.length) return points;
  const end = Math.min(points.length, Math.max(1, currentIndex + 1));
  return points.slice(Math.max(0, end - count), end);
}

function makeScene() {
  if (state.mode === "atlas") {
    const a = state.atlas, system = SYSTEMS[a.familyId];
    const index = a.points.length ? Math.floor(state.time * 420) % a.points.length : 0;
    return { mode: "atlas", kind: system?.kind, points: a.points, bounds: a.bounds, motion: a.motion, projection: a.projection, trail: system?.kind === "ode" ? trailWindow(a.points, index, state.persistence * .1) : null, head: a.points[index], persistence: state.persistence };
  }
  if (state.mode === "unwrap") return { mode: "unwrap", data: unwrapScene() };
  if (state.mode === "fourier") {
    const f = state.fourier;
    const segment = Math.floor(f.phase / TAU), key = JSON.stringify([f.terms, segment]);
    if (f.waveformKey !== key) {
      const samples = 4097, start = (segment - 1) * TAU;
      f.waveform = Array.from({ length: samples }, (_, i) => { const phase = start + i / (samples - 1) * TAU * 3; return [phase, evaluateHarmonics(f.terms, phase)]; });
      f.waveformKey = key;
    }
    const epicycle = buildEpicycleState(f.terms, f.phase);
    const domain = [f.phase - TAU / 4, f.phase + TAU * 3 / 4], step = TAU * 3 / 4096;
    const from = Math.max(0, Math.floor((domain[0] - f.waveform[0][0]) / step));
    const to = Math.min(f.waveform.length, Math.ceil((domain[1] - f.waveform[0][0]) / step) + 1);
    return { mode: "fourier", data: { epicycle, waveform: f.waveform.slice(from, to), phase: f.phase, extent: Math.max(.2, f.terms.reduce((sum, term) => sum + Math.abs(term.amplitude), 0)), domain, persistence: state.persistence } };
  }
  if (state.mode === "spirograph") {
    const s = state.spirograph, p = s.params, currentT = s.phase;
    if (s.error) return { mode: "spirograph", data: null };
    if (p.mode === "rose") return { mode: "spirograph", data: { trails: s.trails.map((trail) => trailWindow(trail, Math.floor(currentT / s.domain[1] * trail.length), state.persistence)), bounds: s.bounds, pens: s.trails.map((trail, index) => spirographPoint(p, currentT, index * TAU / p.pens)) } };
    const inside = p.mode === "hypotrochoid", centerRadius = p.R + (inside ? -p.r : p.r), center = [centerRadius * Math.cos(currentT), centerRadius * Math.sin(currentT)];
    const pens = s.trails.map((_, index) => spirographPoint(p, currentT, index * TAU / p.pens));
    return { mode: "spirograph", data: { trails: s.trails.map((trail) => trailWindow(trail, Math.floor(currentT / s.domain[1] * trail.length), state.persistence)), bounds: s.bounds, gear: { R: p.R, r: p.r, center, contact: [p.R * Math.cos(currentT), p.R * Math.sin(currentT)], rotation: (inside ? -1 : 1) * centerRadius / p.r * currentT }, pens } };
  }
  if (state.mode === "pendulum") {
    const p = state.pendulum;
    return { mode: "pendulum", data: { geometry: p.frame?.geometry, params: p.params, phase: p.phase.slice(-Math.floor(200 + state.persistence * 2800)), trail1: p.trail1.slice(-Math.floor(80 + state.persistence * 1300)), trail2: p.trail2.slice(-Math.floor(80 + state.persistence * 1300)) } };
  }
  const l = state.live, source = getLiveSystem(l.id);
  return { mode: "live", points: l.points.slice(-Math.floor(100 + state.persistence * 1700)), view: source.view, bounds: boundsOf(l.points) };
}

function sceneText() {
  const mode = state.mode;
  $("trace-kind").textContent = modeNames[mode].toUpperCase();
  $("scene-index").textContent = String(Object.keys(modeNames).indexOf(mode) + 1).padStart(2, "0");
  $("metrics-heading").textContent = mode === "atlas" ? "Quantitative fingerprint" : mode === "fourier" ? "Spectral readings" : "Instrument readings";
  if (mode === "atlas") {
    const a = state.atlas, system = SYSTEMS[a.familyId], m = a.result?.metrics;
    $("trace-title").textContent = system?.name ?? "Atlas"; $("equation-text").textContent = system?.equation ?? "—"; $("scene-note").textContent = system?.description ?? "Deterministic dynamical system.";
    $("config-summary").textContent = a.replay ? `stored discovery replay · ${(a.result?.rawPoints?.length ?? 0).toLocaleString()} persisted points from ${a.result?.config?.steps ?? "unknown"} original steps` : a.result ? `${a.result.metadata?.integrator ?? "worker simulation"} · ${a.result.points.length.toLocaleString()} fresh finite points / ${a.result.config.steps.toLocaleString()} requested steps` : "awaiting a fresh 12,000-step worker simulation";
    if (a.motion) $("scene-note").textContent += ` Color: ${a.motion.label}${a.replay ? " between stored samples; original step spacing may differ" : ""}. Bloom uses layered Canvas2D passes, not a GPU shader.`;
    $("seed-summary").textContent = m ? `${m.classification} · finite ${fmt(m.finiteRatio, 3)}` : "awaiting worker";
  } else if (mode === "unwrap") {
    const u = state.unwrap, definition = CURVES[u.id], frame = u.frame;
    $("trace-title").textContent = definition.name; $("equation-text").textContent = definition.equation;
    $("scene-note").textContent = `${u.display === "scrolling-history" ? "Scrolling history uses synchronous fixed-step timestamps and deliberate gaps on loops or poles." : "Domain preview shows the complete sampled parameter domain."} Tangent T, normal N, velocity v = T·speed, curvature radius N/κ, and aligned channels use actual t.`;
    $("config-summary").textContent = `t ∈ [${fmt(u.domain[0])}, ${fmt(u.domain[1])}] · ${definition.family}`;
    $("seed-summary").textContent = `x ${fmt(frame?.point?.[0], 3)} · y ${fmt(frame?.point?.[1], 3)} · speed ${fmt(frame?.speed, 3)}`;
  } else if (mode === "fourier") {
    const f = state.fourier;
    $("trace-title").textContent = `${f.preset[0].toUpperCase()}${f.preset.slice(1)} spectrum`;
    $("equation-text").textContent = `y(φ) = ${f.terms.map((term) => `${fmt(term.amplitude, 2)}·sin(${fmt(term.frequency, 2)}φ${term.phase ? ` + ${fmt(term.phase, 2)}` : ""})`).join(" + ") || "0"}`;
    $("scene-note").textContent = "Epicycles follow the exact dimensionless phase sum. Audio evaluates the same equation at the selected pitch in Hz; visual speed and audio time are independent.";
    $("config-summary").textContent = `${f.terms.length} terms · ${fmt(f.pitch, 0)} Hz base pitch · ${Math.round(f.volume * 100)}% volume`;
    $("seed-summary").textContent = f.muted ? "audio muted" : "audio running · actual summed equations";
  } else if (mode === "spirograph") {
    const s = state.spirograph, p = s.params;
    $("trace-title").textContent = p.mode === "rose" ? "Polar rose oscillator" : `${p.mode === "epitrochoid" ? "Epitrochoid" : "Hypotrochoid"} / multi-pen`;
    $("equation-text").textContent = p.mode === "rose" ? "r(θ) = d cos((R/r)θ)" : p.mode === "epitrochoid" ? "x = (R+r)cos t − d cos((R+r)t/r)" : "x = (R−r)cos t + d cos((R−r)t/r)";
    $("scene-note").textContent = p.mode === "rose" ? "A polar oscillator with phase-offset pens. No rolling contact is implied." : "The highlighted contact and gear make the rolling construction visible. Pens receive independent angular offsets.";
    $("config-summary").textContent = `${p.pens} pens · R ${fmt(p.R)} · r ${fmt(p.r)} · d ${fmt(p.d)}`; $("seed-summary").textContent = `${s.metadata?.turns ?? "—"} gear turns · static geometry cache`;
  } else if (mode === "pendulum") {
    const p = state.pendulum, frame = p.frame;
    $("trace-title").textContent = "Double pendulum / sensitive orbit"; $("equation-text").textContent = "θ̈₁, θ̈₂ = coupled Lagrangian equations integrated by fixed-step RK4";
    $("scene-note").textContent = "The scene advances at a fixed numerical step. The phase portrait wraps display angles to ±π while numerical state remains unwrapped.";
    $("config-summary").textContent = `RK4 1/240 s · g ${fmt(p.params.gravity)} · damping ${fmt(p.params.damping, 3)}`; $("seed-summary").textContent = `E ${fmt(frame?.energy, 3)} · ${frame?.bounded ? "bounded" : "frozen divergence"}`;
  } else {
    const l = state.live, source = getLiveSystem(l.id);
    $("trace-title").textContent = source.name; $("equation-text").textContent = source.equation; $("scene-note").textContent = `${source.description} Visual source time is separate from any audio pitch/time interpretation.`;
    $("config-summary").textContent = `${fmt(source.dt, 4)} s fixed step · ${l.points.length.toLocaleString()} buffered`; $("seed-summary").textContent = state.playing ? "streaming" : "paused";
  }
  $("canvas-description").textContent = `${$("trace-title").textContent}. ${$("scene-note").textContent}`;
  canvas.setAttribute("aria-label", $("trace-title").textContent);
  telemetry();
}
function updateCoordinateReadout(point, suffix = "") {
  const values = point ?? [];
  $("coordinate-readout").textContent = `x ${fmt(values[0], 4)} · y ${fmt(values[1], 4)} · z ${fmt(values[2], 4)}${suffix ? ` · ${suffix}` : ""}`;
}

let telemetryTimer;
function telemetry() {
  const now = performance.now();
  if (now - state.lastTelemetry < 200) {
    if (!telemetryTimer) telemetryTimer = setTimeout(() => { telemetryTimer = null; telemetry(); }, 201 - (now - state.lastTelemetry));
    return;
  }
  if (document.hidden) return;
  state.lastTelemetry = now;
  const cards = [];
  $("class-badge").className = "class-badge";
  if (state.mode === "atlas") {
    const m = state.atlas.result?.metrics ?? {};
    cards.push(["score", fmt(m.score, 1), "multi-signal retention"], ["occupancy", fmt(m.occupancy, 3), "multi-scale area"], ["entropy", fmt(m.entropy, 3), "spatial Shannon"], ["periodicity", fmt(m.periodicity, 3), "best lag"], ["spectrum", fmt(m.spectrumStructure, 3), "frequency structure"], ["symmetry", fmt(m.symmetry, 3), "reflected similarity"], ["stability", fmt(m.stability, 3), "bounded-tail proxy"], ["finite ratio", fmt(m.finiteRatio, 3), "no clipping applied"]);
    $("class-badge").textContent = (m.classification ?? "computing").replaceAll("-", " "); $("class-badge").className = `class-badge ${m.classification === "divergent" ? "error" : ""}`;
  } else if (state.mode === "unwrap") {
    const u = state.unwrap, frame = u.frame ?? {}, t = u.domain[0] + u.phase * (u.domain[1] - u.domain[0]);
    if (document.activeElement !== $("phase-control")) $("phase-control").value = u.phase;
    $("phase-output").textContent = `${Math.round(u.phase * 100)}%`;
    updateCoordinateReadout(frame.point, `t ${fmt(t, 4)} · stream ${fmt(u.historyClock, 3)} s`);
    cards.push(["parameter t", fmt(t, 3), "actual curve parameter"], ["speed", fmt(frame.speed, 3), "‖dr/dt‖"], ["curvature", fmt(frame.curvature, 4), "local bend κ"], ["phase", `${Math.round(u.phase * 100)}%`, "domain position"], ["singular", frame.singular ? "yes" : "no", "null gaps preserved"], ["channels", u.data?.channels.length ?? 0, "aligned waveform projections"]); $("class-badge").textContent = "parametric";
  } else if (state.mode === "fourier") {
    if (!audio.playing && !state.fourier.muted) stopAudio("Audio stopped. Enable it again to listen.");
    const f = state.fourier, peak = f.waveform.reduce((m, p) => Math.max(m, Math.abs(p[1])), 0); cards.push(["harmonics", f.terms.length, "edited terms"], ["visual phase", fmt(f.phase, 2), "dimensionless rad"], ["peak", fmt(peak, 3), "summed amplitude"], ["pitch", `${fmt(f.pitch, 0)} Hz`, "audio base pitch"], ["volume", `${Math.round(f.volume * 100)}%`, "normalized output"], ["audio", f.muted ? "off" : "on", "gesture-controlled"]); $("class-badge").textContent = "equation";
  } else if (state.mode === "spirograph") {
    const s = state.spirograph, p = s.params; cards.push(["pens", p.pens, "independent phase trails"], ["R / r", fmt(p.R, 1) + " / " + fmt(p.r, 1), "gear ratio"], ["phase", fmt(s.phase, 2), "rolling parameter"], ["geometry", "cached", String(s.trails.length * (s.trails[0]?.length ?? 0)) + " points"]); $("class-badge").textContent = p.mode === "rose" ? "polar orbit" : "rolling orbit";
  } else if (state.mode === "pendulum") {
    const p = state.pendulum, f = p.frame ?? {};
    cards.push(
      ["energy", fmt(f.energy, 3), "relative conserved quantity"],
      ["θ₁ / θ₂", fmt(p.model?.theta1, 2) + " / " + fmt(p.model?.theta2, 2), "unwrapped state"],
      ["phase points", p.phase.length.toLocaleString(), "θ₁ × θ₂"],
      ["bounded", f.bounded ? "yes" : "no", "divergence freezes state"],
    );
    $("class-badge").textContent = f.diverged ? "diverged" : "RK4 dynamics"; $("class-badge").className = `class-badge ${f.diverged ? "error" : ""}`;
  } else {
    const l = state.live, source = getLiveSystem(l.id), frozen = l.model?.diverged;
    cards.push(["elapsed", `${fmt(l.model?.t ?? 0, 2)} s`, "source clock"], ["buffer", l.points.length.toLocaleString(), "max 1,800"], ["step", fmt(source.dt, 4), "fixed numerical step"], ["status", frozen ? "frozen" : state.playing ? "streaming" : "paused", "shared transport"]);
    $("class-badge").textContent = frozen ? "live source frozen" : "live signal"; $("class-badge").className = `class-badge ${frozen ? "error" : ""}`;
    const livePoint = l.points.at(-1); updateCoordinateReadout(source.view === "xy" ? livePoint : [livePoint?.[0], livePoint?.[1], livePoint?.[2]], `source ${source.view}`);
  }
  if (state.mode === "atlas") {
    const a = state.atlas, raw = a.result?.rawPoints ?? [], index = raw.length ? Math.floor(state.time * 420) % raw.length : 0;
    updateCoordinateReadout(raw[index], a.replay ? "stored sample replay" : "worker trajectory");
  } else if (state.mode === "fourier") updateCoordinateReadout(buildEpicycleState(state.fourier.terms, state.fourier.phase).endpoint, "vector sum");
  else if (state.mode === "pendulum") updateCoordinateReadout(state.pendulum.frame?.point, "second mass");
  else if (state.mode === "spirograph") updateCoordinateReadout(state.spirograph.error ? null : spirographPoint(state.spirograph.params, state.spirograph.phase), "primary pen");
  $("metrics-grid").innerHTML = cards.map(([name, value, note]) => `<div class="metric-card"><div class="metric-label">${name}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`).join("");
  $("time-readout").textContent = `t = ${state.time.toFixed(3)}`; $("render-status").textContent = `${state.rendered.toLocaleString()} draw ops · ${state.drawMs.toFixed(1)} ms · telemetry 5 Hz max`;
}

function resize() {
  const rect = canvas.getBoundingClientRect(), width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height)), dpr = Math.min(devicePixelRatio || 1, 1.75);
  if (width === state.width && height === state.height && dpr === state.dpr) return;
  state.width = width; state.height = height; state.dpr = dpr; canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); invalidate();
}
function draw() {
  const start = performance.now(); resize(); const result = renderStudio(ctx, makeScene(), state.width, state.height, { palette: state.palette, showGrid: state.showGrid, showAxes: state.showAxes, vectors: state.vectors, glow: state.glow, maxPoints: state.budget });
  state.drawMs = performance.now() - start; state.rendered = result.drawn; state.dirty = false;
  if (state.drawMs > 18) state.budget = Math.max(1200, Math.floor(state.budget * .82)); else if (state.drawMs < 7) state.budget = Math.min(60000, Math.floor(state.budget * 1.04));
}
function advance(dt) {
  const delta = Math.min(.05, Math.max(0, dt)) * state.speed; state.time += delta;
  if (state.mode === "atlas") return;
  if (state.mode === "unwrap") { advanceUnwrap(delta); return; }
  if (state.mode === "fourier") { state.fourier.phase += delta * .8; return; }
  if (state.mode === "spirograph") { state.spirograph.phase = (state.spirograph.phase + delta * .8) % Math.max(TAU, state.spirograph.domain[1]); return; }
  if (state.mode === "pendulum") {
    const p = state.pendulum; p.accumulator += delta; let steps = 0;
    while (p.accumulator >= 1 / 240 && steps < 40) {
      try { p.frame = stepDoublePendulum(p.model, p.params, 1 / 240); }
      catch (error) { p.error = error.message; p.model.diverged = true; p.frame = { ...p.frame, diverged: true, bounded: false }; }
      if (p.frame.diverged) { overlay(p.error ?? "Numerical guard reached. State frozen; reset or adjust parameters."); status("Pendulum frozen", "error"); setPlaying(false); break; }
      const wrapped = p.frame.phaseSpace.map((angle) => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI), previous = p.phase[p.phase.length - 1];
      if (previous && wrapped.some((angle, i) => Math.abs(angle - previous[i]) > Math.PI)) p.phase.push(null);
      p.phase.push(wrapped); p.trail1.push(p.frame.geometry.bob1); p.trail2.push(p.frame.geometry.bob2); p.accumulator -= 1 / 240; steps += 1;
    }
    if (p.accumulator >= 1 / 240) { p.accumulator = 0; p.dropped += 1; }
    if (p.phase.length > 5000) p.phase.splice(0, p.phase.length - 5000); if (p.trail1.length > 5000) { p.trail1.splice(0, p.trail1.length - 5000); p.trail2.splice(0, p.trail2.length - 5000); }
    return;
  }
  const l = state.live, source = getLiveSystem(l.id); l.accumulator += delta; let steps = 0;
  while (l.accumulator >= source.dt && steps < 40) {
    try {
      const next = advanceLive(l.id, l.model, l.params, source.dt);
      l.points.push(next.point); l.accumulator -= source.dt; steps += 1;
    } catch (error) {
      l.model.diverged = true; l.model.reason = error.message; l.accumulator = 0;
      overlay(`${error.message}. Reset or reselect the source to resume.`); status("Live source frozen", "error"); setPlaying(false); break;
    }
  }
  if (l.accumulator >= source.dt) { l.accumulator = 0; l.dropped += 1; } if (l.points.length > 1800) l.points.splice(0, l.points.length - 1800);
}
function schedule() { if (!state.raf && !document.hidden) state.raf = requestAnimationFrame(frame); }
function frame(now) {
  state.raf = 0; const dt = state.lastFrame === null ? 0 : (now - state.lastFrame) / 1000; state.lastFrame = now;
  if (state.playing && !document.hidden) advance(dt); if (state.dirty || state.playing) draw(); telemetry();
  if (state.playing && !document.hidden) schedule();
}
function setPlaying(playing) {
  state.playing = Boolean(playing) && !document.hidden; state.lastFrame = null;
  $("playback-button").textContent = state.playing ? "Ⅱ Pause" : "▶ Play"; $("playback-button").setAttribute("aria-pressed", String(state.playing));
  if (!state.playing && state.mode === "fourier") { stopAudio("Paused and muted. Enable audio to resume listening."); void audio.suspend().catch(() => {}); }
  sceneText(); invalidate();
}
async function exportPNG() {
  const scale = 2, output = document.createElement("canvas"); output.width = state.width * scale; output.height = state.height * scale; const outputContext = output.getContext("2d", { alpha: false }); outputContext.setTransform(scale, 0, 0, scale, 0, 0);
  renderStudio(outputContext, makeScene(), state.width, state.height, { palette: state.palette, showGrid: state.showGrid, showAxes: state.showAxes, vectors: state.vectors, glow: state.glow, maxPoints: 60000 });
  const blob = await new Promise((resolve) => output.toBlob(resolve, "image/png")); if (!blob) return; const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `trace-explorer-${state.mode}-${Date.now()}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); status("PNG exported");
}

function setMode(mode) {
  if (state.mode === "fourier" && mode !== "fourier") stopAudio("Audio muted on mode change.");
  state.mode = mode; state.time = 0; state.lastFrame = null;
  overlay(); status(`${modeNames[mode]} ready`);
  const controls = { atlas: "atlas-controls", unwrap: "unwrap-controls", fourier: "fourier-controls", spirograph: "spirograph-controls", pendulum: "pendulum-controls", live: "live-controls" };
  Object.entries(controls).forEach(([name, id]) => $(id).hidden = name !== mode);
  document.querySelectorAll(".mode-button[data-mode]").forEach((button) => { const active = button.dataset.mode === mode; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
  if (mode === "atlas") {
    dispatchAtlas();
    const a = state.atlas, diverged = a.result?.metadata.diverged || a.result?.metrics.classification === "divergent";
    overlay(a.busy || a.queued ? "Worker is computing the latest parameters…" : diverged ? "Divergence detected. Finite prefix only; adjust parameters or restore the reference." : a.result ? "" : "Waiting for trajectory…");
  }
  if (mode === "unwrap") { curveControls(); prepareCurve(); }
  if (mode === "fourier") { fourierControls(); harmonicEditor(); audioNotice(); }
  if (mode === "spirograph") prepareSpirograph();
  if (mode === "pendulum") resetPendulum();
  if (mode === "live") { liveControls(); resetLive(); }
  sceneText(); invalidate();
}

function setup() {
  options($("family-select"), SYSTEM_LIST.map((s) => [s.id, s.name])); $("family-select").value = state.atlas.familyId;
  options($("curve-select"), CURVE_LIST.map((curve) => [curve.id, curve.name])); $("curve-select").value = state.unwrap.id;
  options($("harmonic-preset-select"), [["custom", "Custom equation"], ...HARMONIC_PRESET_LIST.map((preset) => [preset.id, preset.name])]); $("harmonic-preset-select").value = state.fourier.preset;
  options($("live-system-select"), LIVE_SYSTEM_LIST.map((source) => [source.id, source.name])); $("live-system-select").value = state.live.id;
  options($("theme-select"), Object.keys(STUDIO_PALETTES).map((name) => [name, name])); $("theme-select").value = state.palette;
  const root = document.documentElement;
  function theme() { const c = STUDIO_PALETTES[state.palette], rgb = c.accent.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16)).join(", "); root.style.setProperty("--bg", c.background); root.style.setProperty("--panel", `${c.panel}db`); root.style.setProperty("--accent", c.accent); root.style.setProperty("--secondary", c.secondary); root.style.setProperty("--accent-rgb", rgb); }
  $("theme-select").addEventListener("change", () => { state.palette = $("theme-select").value; theme(); invalidate(); }); theme();
  $("family-select").addEventListener("change", () => { state.atlas.familyId = $("family-select").value; loadFamily(); selectAtlasSource(); });
  $("discovery-select").addEventListener("change", () => { state.atlas.discoveryId = $("discovery-select").value; loadFamily(false); selectAtlasSource(); });
  $("projection-select").addEventListener("change", () => { state.atlas.projection = $("projection-select").value; projectAtlas(); invalidate(); });
  $("regenerate-button").addEventListener("click", requestAtlas); $("reset-button").addEventListener("click", () => { loadFamily(false); selectAtlasSource(); });
  $("curve-select").addEventListener("change", () => { const u = state.unwrap; u.id = $("curve-select").value; u.params = { ...CURVES[u.id].defaults }; u.domain = [...CURVES[u.id].domain]; u.phase = 0; curveControls(); prepareCurve(); });
  $("domain-start").addEventListener("change", () => { state.unwrap.domain[0] = Number($("domain-start").value); prepareCurve(); }); $("domain-end").addEventListener("change", () => { state.unwrap.domain[1] = Number($("domain-end").value); prepareCurve(); });
  $("phase-control").addEventListener("input", () => { state.unwrap.phase = Number($("phase-control").value); $("phase-output").textContent = `${Math.round(state.unwrap.phase * 100)}%`; resetUnwrapHistory(); invalidate(); }); $("vectors-toggle").addEventListener("change", () => { state.vectors = $("vectors-toggle").checked; invalidate(); });
  $("unwrap-projection-select").addEventListener("change", () => { state.unwrap.projection = $("unwrap-projection-select").value; invalidate(); });
  $("channel-set-select").addEventListener("change", () => { state.unwrap.channelSet = $("channel-set-select").value; prepareCurve(); });
  $("waveform-display-select").addEventListener("change", () => { state.unwrap.display = $("waveform-display-select").value; resetUnwrapHistory(); sceneText(); invalidate(); });
  $("osculating-toggle").addEventListener("change", () => { state.unwrap.osculating = $("osculating-toggle").checked; invalidate(); });
  $("harmonic-preset-select").addEventListener("change", () => { const f = state.fourier; f.preset = $("harmonic-preset-select").value; if (f.preset !== "custom") f.terms = presetHarmonics(f.preset, f.count); harmonicEditor(); harmonicsChanged(); }); $("add-harmonic-button").addEventListener("click", () => { const f = state.fourier; if (f.terms.length >= 32) return; f.terms.push({ amplitude: .1, frequency: f.terms.length + 1, phase: 0 }); customCount(); harmonicEditor(); harmonicsChanged(); }); $("audio-button").addEventListener("click", () => { if (!state.fourier.muted) stopAudio(); else enableAudio(); }); $("audio-mute-toggle").addEventListener("change", (event) => { if (event.target.checked) stopAudio(); else if (state.mode === "fourier") enableAudio(); });
  $("audio-parameter-controls").addEventListener("input", () => { audioNotice(); });
  $("spirograph-select").addEventListener("change", () => { state.spirograph.params.mode = $("spirograph-select").value; prepareSpirograph(); }); $("pendulum-parameter-controls").replaceChildren();
  $("live-system-select").addEventListener("change", () => { state.live.id = $("live-system-select").value; state.live.params = { ...getLiveSystem(state.live.id).defaults }; liveControls(); resetLive(); });
  parameters("spirograph-parameter-controls", { R: control("R · fixed radius", 1, 9, .01, 5), r: control("r · rolling radius", .3, 8, .01, 3), d: control("d · pen offset", 0, 7, .01, 2), pens: control("P · pen count", 1, 5, 1, 3) }, state.spirograph.params, prepareSpirograph, "spiro");
  parameters("pendulum-parameter-controls", { length1: control("L₁ · upper length", .3, 2, .01, 1), length2: control("L₂ · lower length", .3, 2, .01, 1), mass1: control("m₁ · upper mass", .2, 3, .01, 1), mass2: control("m₂ · lower mass", .2, 3, .01, 1), gravity: control("g · gravity", 0, 20, .01, 9.81), damping: control("d · damping", 0, .5, .001, 0), theta1: control("θ₁ · initial angle", -Math.PI, Math.PI, .01, 1.35), theta2: control("θ₂ · initial angle", -Math.PI, Math.PI, .01, 1.7) }, state.pendulum.params, resetPendulum, "pendulum");
  $("grid-toggle").addEventListener("change", () => { state.showGrid = $("grid-toggle").checked; invalidate(); }); $("axes-toggle").addEventListener("change", () => { state.showAxes = $("axes-toggle").checked; invalidate(); }); $("persistence-control").addEventListener("input", () => { state.persistence = Number($("persistence-control").value); $("persistence-output").textContent = `${Math.round(state.persistence * 100)}%`; invalidate(); }); $("glow-control").addEventListener("input", () => { state.glow = Number($("glow-control").value); $("glow-output").textContent = `${Math.round(state.glow * 100)}%`; invalidate(); }); $("speed-control").addEventListener("input", () => { state.speed = Number($("speed-control").value); $("speed-output").textContent = `${state.speed.toFixed(2)}×`; });
  $("playback-button").addEventListener("click", () => setPlaying(!state.playing)); $("restart-button").addEventListener("click", () => { state.time = 0; if (state.mode === "atlas") requestAtlas(); if (state.mode === "unwrap") { state.unwrap.phase = 0; $("phase-control").value = 0; $("phase-output").textContent = "0%"; resetUnwrapHistory("manual reset"); updateCurveFrame(); } if (state.mode === "fourier") state.fourier.phase = 0; if (state.mode === "spirograph") state.spirograph.phase = 0; if (state.mode === "pendulum") resetPendulum(); if (state.mode === "live") resetLive(); invalidate(); }); $("snapshot-button").addEventListener("click", exportPNG);
  document.querySelectorAll(".mode-button[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  document.addEventListener("keydown", (event) => { if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest("input, select, textarea, button, summary, a, [contenteditable]")) return; if (event.code === "Space") { event.preventDefault(); setPlaying(!state.playing); } if (event.key.toLowerCase() === "r") $("restart-button").click(); if (event.key.toLowerCase() === "e") exportPNG(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      state.wasPlaying = state.playing; setPlaying(false); stopAudio("Audio muted while the tab is hidden.");
      void audio.suspend().catch(() => {}); cancelAnimationFrame(state.raf); state.raf = 0;
    } else { if (state.wasPlaying && !reducedMotion.matches) setPlaying(true); state.wasPlaying = false; invalidate(); }
  });
  reducedMotion.addEventListener("change", () => { if (reducedMotion.matches) setPlaying(false); });
  window.addEventListener("pagehide", () => { setPlaying(false); stopAudio(); void audio.suspend().catch(() => {}); });
  new ResizeObserver(() => { resize(); }).observe(canvas); window.addEventListener("resize", resize);
  loadFamily(); curveControls(); fourierControls(); harmonicEditor(); liveControls(); startWorker();
}

async function boot() {
  setup();
  try { const response = await fetch("data/discoveries.json", { cache: "no-store" }); if (response.ok) state.atlas.discoveries = (await response.json()).discoveries ?? []; } catch { state.atlas.discoveries = []; }
  loadFamily(); prepareCurve(); prepareSpirograph(); resetPendulum(); resetLive(); setMode("atlas"); selectAtlasSource(); setPlaying(!reducedMotion.matches); draw(); telemetry(); if (state.playing) schedule();
}

const ready = boot().catch((error) => { status("Studio initialization failed", "error"); overlay(error.message); console.error(error); throw error; });
export { renderStudio, buildMotionBins, makeScene, state, ready };
