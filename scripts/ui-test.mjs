/**
 * Runtime integration harness for the owned frontend. No dependencies, browser,
 * eval/CDP, generated artifacts, or changes to the driver's composite suite.
 * Executes the actual app, geometry, renderer, worker entry and audio controller
 * against deterministic DOM/Canvas/WebAudio hosts. Run: node scripts/ui-test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CURVE_LIST, curveFrame } from "../src/art-modes.js";
import { SYSTEM_LIST, SYSTEMS } from "../src/systems.js";
import { HARMONIC_PRESET_LIST, evaluateHarmonics } from "../src/audio.js";
import { LIVE_SYSTEM_LIST } from "../src/live.js";
import { renderStudio, curvatureGeometry, STUDIO_PALETTES } from "../src/studio-renderer.js";
import { simulateAtlasRequest } from "../src/simulation-worker.js";

const near = (a, b, label, tolerance = 1e-8) => assert(Math.abs(a - b) <= tolerance, `${label}: ${a} ≠ ${b}`);
let now = 0, nextId = 0;
const timers = new Map(), frames = new Map();
globalThis.setTimeout = (callback, delay = 0) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; };
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.requestAnimationFrame = (callback) => { const id = ++nextId; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => now } });
const microtasks = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
async function elapse(ms, draw = false) {
  now += ms;
  let spins = 0;
  while ([...timers.values()].some((timer) => timer.at <= now)) {
    assert(spins++ < 100, "unbounded timer loop");
    for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.callback();
    await microtasks();
  }
  if (draw) { const batch = [...frames.values()]; frames.clear(); for (const callback of batch) callback(now); }
  await microtasks();
}
async function tick(count = 1, step = 1000 / 60) { for (let i = 0; i < count; i += 1) await elapse(step, true); }

class Events {
  listeners = new Map();
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  async emit(name, extra = {}) {
    for (const callback of [...(this.listeners.get(name) ?? [])]) await callback({ target: this, preventDefault() {}, ...extra });
    await microtasks();
  }
}
const elements = new Map(), allElements = [], contexts = [], downloads = [], blobs = [], mutations = [];
const methodNames = ["save", "restore", "clearRect", "fillRect", "beginPath", "moveTo", "lineTo", "stroke", "fill", "arc", "rect", "clip", "setLineDash", "fillText", "strokeRect", "setTransform"];
function canvasContext() {
  const context = { colors: new Set(), texts: [], paths: [], operations: 0, stack: [], currentPath: [] };
  for (const name of methodNames) context[name] = (...args) => {
    context.operations += 1;
    for (const value of args) if (typeof value === "number") assert(Number.isFinite(value), `${name} received nonfinite coordinate`);
    if (name === "arc") assert(args[2] >= 0, "negative arc radius");
    if (name === "beginPath") context.currentPath = [];
    if (name === "moveTo" || name === "lineTo") context.currentPath.push([name, ...args]);
    if (name === "stroke" || name === "fill") {
      context.colors.add(name === "stroke" ? context.strokeStyle : context.fillStyle);
      if (context.capture) context.paths.push({ color: context.strokeStyle, path: [...context.currentPath] });
    }
    if (name === "fillText") context.texts.push(args[0]);
    if (context.texts.length > 200) context.texts.splice(0, context.texts.length - 200);
    if (name === "save") context.stack.push([context.globalAlpha, context.fillStyle, context.strokeStyle]);
    if (name === "restore") {
      assert(context.stack.length, "unbalanced canvas restore");
      [context.globalAlpha, context.fillStyle, context.strokeStyle] = context.stack.pop();
    }
  };
  Object.defineProperty(context, "shadowBlur", { set() { assert.fail("per-particle shadowBlur introduced"); } });
  contexts.push(context); return context;
}
class Element extends Events {
  constructor(tagName = "div") {
    super(); this.tagName = tagName.toUpperCase(); this.children = []; this.parentElement = null; this.attrs = {}; this.dataset = {};
    this.style = { setProperty() {} }; this.value = ""; this.checked = false; this.disabled = false; this.hidden = false;
    this.classList = { toggle() {} }; this.widthWrites = 0; this.heightWrites = 0;
    allElements.push(this);
  }
  set id(id) { this._id = id; if (id) elements.set(id, this); }
  get id() { return this._id; }
  set textContent(value) { this.text = String(value); if (this.id) mutations.push({ id: this.id, at: now, value: this.text }); }
  get textContent() { return this.text ?? ""; }
  set innerHTML(value) { this.html = value; if (this.id) mutations.push({ id: this.id, at: now }); }
  get innerHTML() { return this.html ?? ""; }
  get valueAsNumber() { return this.value === "" ? NaN : Number(this.value); }
  set width(value) { this._width = value; this.widthWrites += 1; }
  get width() { return this._width ?? 300; }
  set height(value) { this._height = value; this.heightWrites += 1; }
  get height() { return this._height ?? 150; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); if (node instanceof Element) node.parentElement = this; } }
  replaceChildren(...nodes) {
    const remove = (node) => { if (elements.get(node.id) === node) elements.delete(node.id); node.children?.forEach(remove); };
    this.children.forEach(remove); this.children = []; this.append(...nodes);
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  getAttribute(key) { return this.attrs[key]; }
  getBoundingClientRect() { return { width: 960, height: 570 }; }
  getContext(kind) { assert.equal(kind, "2d"); return this.context ??= canvasContext(); }
  toBlob(callback, type) {
    assert.equal(type, "image/png"); blobs.push({ canvas: this, callback });
    setTimeout(() => callback(new Blob(["mock PNG"], { type })), 1);
  }
  closest(selector) { return selector.split(",").map((s) => s.trim().toUpperCase()).includes(this.tagName) ? this : null; }
  async click() { if (this.tagName === "A") downloads.push({ href: this.href, download: this.download }); else await this.emit("click"); }
}
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const modeButtons = [];
for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
  const [, tag, attrs] = match;
  const id = attrs.match(/\bid="([^"]+)"/)?.[1], mode = attrs.match(/\bdata-mode="([^"]+)"/)?.[1];
  if (!id && !mode) continue;
  const element = new Element(tag);
  if (id) { assert(!elements.has(id), `duplicate HTML ID ${id}`); element.id = id; }
  if (mode) { element.dataset.mode = mode; modeButtons.push(element); }
  element.checked = /\bchecked\b/.test(attrs); element.hidden = /\bhidden\b/.test(attrs);
  element.value = attrs.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
}
const doc = new Events();
Object.assign(doc, {
  hidden: false, activeElement: null, documentElement: new Element("html"),
  getElementById: (id) => elements.get(id) ?? null,
  createElement: (tag) => new Element(tag),
  querySelectorAll: (selector) => { assert.equal(selector, ".mode-button[data-mode]"); return modeButtons; },
});
globalThis.document = doc;
globalThis.window = new Events();
globalThis.Option = class extends Element { constructor(text, value) { super("option"); this.textContent = text; this.value = value; } };
const preference = new Events(); preference.matches = true;
globalThis.matchMedia = () => preference;
globalThis.devicePixelRatio = 2;
globalThis.ResizeObserver = class { observe() {} };
const $ = (id) => { assert(elements.has(id), `missing HTML/dynamic control ${id}`); return elements.get(id); };
async function input(id, value, event = "input") { $(id).value = String(value); await $(id).emit(event); }
async function check(id, value) { $(id).checked = value; await $(id).emit("change"); }
async function mode(name) { await modeButtons.find((button) => button.dataset.mode === name).click(); }
const jobs = [];
let worker;
globalThis.Worker = class extends Events {
  constructor(url, options) { super(); assert(url.href.endsWith("/src/simulation-worker.js")); assert.equal(options.type, "module"); worker = this; }
  postMessage(message) { jobs.push(structuredClone(message)); }
  terminate() {}
};
// Exercise the real audio controller with a fake host, rather than replacing the
// controller: verify descriptors, stop/mute messages, and emergency output gain.
const audioMessages = [], audioContexts = [], gains = [];
globalThis.AudioContext = class extends Events {
  constructor() {
    super(); this.state = "suspended"; this.currentTime = 0; this.sampleRate = 48000; this.destination = {};
    this.audioWorklet = { addModule: async (url) => assert(url.endsWith("/audio-worklet.js")) }; audioContexts.push(this);
  }
  createGain() {
    const gain = { value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; } };
    gains.push(gain); return { gain, connect() {}, disconnect() {} };
  }
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
  async close() { this.state = "closed"; }
};
globalThis.AudioWorkletNode = class extends Events {
  constructor() { super(); this.port = { postMessage: (message) => audioMessages.push(structuredClone(message)), close() {} }; }
  connect() {} disconnect() {}
};
globalThis.isSecureContext = true;
const revoked = [];
URL.createObjectURL = () => "blob:mock-png";
URL.revokeObjectURL = (url) => revoked.push(url);
const stored = {
  id: "henon-stored", family: "henon", parameters: { ...SYSTEMS.henon.defaults },
  config: { ...SYSTEMS.henon.defaultConfig, steps: 7000 }, metadata: { integrator: "direct-map", finiteRatio: 1 },
  metrics: { classification: "structured", finiteRatio: 1, score: 40 },
  rawPoints: [[0, 0], [.1, .2], [.2, .8], [1.2, .3], [.4, -.5]],
};
globalThis.fetch = async (url) => { assert.equal(url, "data/discoveries.json"); return { ok: true, json: async () => ({ discoveries: [stored] }) }; };

const { state, makeScene, ready, buildMotionBins } = await import("../src/app.js");
await ready; await tick();
assert(!state.playing, "reduced motion must start paused");
assert.equal(modeButtons.length, 6); assert.equal(CURVE_LIST.length, 14); assert.equal(HARMONIC_PRESET_LIST.length, 6);
assert(state.atlas.replay); assert.equal(jobs.length, 0, "stored Hénon should not be relabelled as a fresh worker run");
assert.match($("config-summary").textContent, /stored discovery replay.*5 persisted.*7000 original/);
assert.match(state.atlas.motion.label, /step displacement/);
const bins = buildMotionBins([[0, 0, 0], [3, 4, 12], [3, 4, 14]], .5);
near(bins.values[1], 26, "full-dimensional speed"); near(bins.values[2], 4, "adjacent speed");
assert(new Set(bins.bins).size > 1);
const probe = canvasContext();
function render(width = 960, budget = 14000) {
  probe.texts = []; const result = renderStudio(probe, makeScene(), width, width < 580 ? 620 : 570, { maxPoints: budget, glow: .7 });
  assert(result.drawn <= budget); assert.equal(probe.stack.length, 0); return result;
}
render(); assert([...probe.colors].filter((color) => color?.startsWith("rgb(")).length > 1, "atlas is still one uniform color");

// Real worker integration, parameter isolation, queued replacement, and family race.
await $("regenerate-button").click(); await elapse(120);
assert.equal(jobs.length, 1); const stale = jobs.shift(); assert.equal(stale.config.steps, 12000);
await input("atlas-parameter-a", 1.32);
await worker.emit("message", { data: { type: "result", id: stale.id, familyId: "henon", rawPoints: [[99, 99]] } });
assert.equal(state.atlas.result, null, "stale parameter result accepted");
await elapse(120); const pendingHenon = jobs.shift(); assert.equal(pendingHenon.params.a, 1.32);
await input("family-select", "lorenz", "change"); await input("projection-select", "x-z", "change");
assert.equal(makeScene().points.length, 0, "wrong-dimensional previous family remains visible");
await elapse(120); await worker.emit("message", { data: { type: "result", id: pendingHenon.id, familyId: "henon", rawPoints: [[99, 99]] } });
assert.equal(state.atlas.result, null); const currentJob = jobs.shift(); assert.equal(currentJob.familyId, "lorenz");
const currentResult = simulateAtlasRequest(currentJob);
await worker.emit("message", { data: { type: "result", ...currentResult } });
assert.equal(state.atlas.result.id, currentJob.id); assert.equal(makeScene().points.length, 12000);
assert.deepEqual(makeScene().points[0], [currentResult.rawPoints[0][0], currentResult.rawPoints[0][2]]);
assert.match($("config-summary").textContent, /fresh finite points.*12,000 requested/);
const cachedMotion = state.atlas.motion; await input("projection-select", "y-z", "change"); assert.equal(state.atlas.motion, cachedMotion);
assert.match(cachedMotion.label, /speed/); render(360, 1200); render();
for (const system of SYSTEM_LIST) {
  await input("family-select", system.id, "change");
  assert.equal($("family-select").value, system.id); assert.equal(state.atlas.familyId, system.id);
  if (system.id !== "henon") assert.equal(makeScene().points.length, 0);
}
await input("family-select", "henon", "change"); await elapse(120); assert(state.atlas.replay);

// All modes, every curve in both channel sets, desktop and narrow canvas.
for (const button of modeButtons) { await button.click(); render(); render(360, 1200); }
await mode("unwrap");
for (const curve of CURVE_LIST) {
  await input("curve-select", curve.id, "change");
  assert(!state.unwrap.error, `${curve.id}: ${state.unwrap.error}`);
  for (const channels of ["function", "moving-frame"]) {
    await input("channel-set-select", channels, "change");
    assert.equal(makeScene().data.channels.length, 6);
    await input("phase-control", .413);
    const f = curveFrame(curve.id, state.unwrap.params, state.unwrap.domain[0] + .413 * (state.unwrap.domain[1] - state.unwrap.domain[0]));
    near(state.unwrap.frame.channels.vx, f.tangent[0] * f.speed, `${curve.id} vx`);
    near(state.unwrap.frame.channels.vy, f.tangent[1] * f.speed, `${curve.id} vy`);
    if (f.curvature > 1e-12) near(state.unwrap.frame.channels.curvatureRadius, 1 / f.curvature, `${curve.id} radius`);
    await input("waveform-display-select", "domain-preview", "change"); render(); render(360, 1200);
  }
  const firstKey = Object.keys(curve.parameters)[0], schema = curve.parameters[firstKey];
  const old = state.unwrap.params[firstKey], next = old + schema.step <= schema.max ? old + schema.step : old - schema.step;
  await input(`curve-parameter-${firstKey}`, next);
  assert.equal(state.unwrap.params[firstKey], next); assert.equal(state.unwrap.history.length, 1);
}
await input("curve-select", "circle", "change");
await input("channel-set-select", "function", "change");
assert.deepEqual(state.unwrap.data.channels.map((c) => c.name), ["sin", "cos", "tan", "cot", "sec", "csc"]);
assert(state.unwrap.data.channels.find((c) => c.name === "tan").values.some((v) => v === null));
await input("channel-set-select", "moving-frame", "change");
assert.deepEqual(state.unwrap.data.channels.map((c) => c.name), ["vx", "vy", "normalX", "normalY", "curvatureRadius", "speed"]);
await input("curve-parameter-radius", 2); await input("phase-control", .137);
let cg = curvatureGeometry(state.unwrap.frame); near(cg.radius, 2, "circle radius is 1/κ, not κ"); near(Math.hypot(...cg.vector), 2, "N/κ vector"); near(Math.hypot(...cg.center), 0, "circle osculating center");
await check("osculating-toggle", true); render(); assert(probe.texts.some((text) => text.includes("R=1/κ")));
await input("unwrap-projection-select", "moving-frame", "change");
assert.deepEqual(makeScene().data.frame.point, [0, 0]); render(360);
await input("unwrap-projection-select", "function", "change");
await input("curve-select", "parabola", "change"); await input("curve-parameter-a", -.5); await input("phase-control", .5);
assert(curvatureGeometry(state.unwrap.frame).center[1] < 0, "normal must face the concave side for negative curvature orientation");
await input("curve-parameter-a", 0); assert.equal(curvatureGeometry(state.unwrap.frame), null); render();

// Genuine, synchronous history: same samples under two frame cadences, regular
// timestamps, moving x-axis, pole/loop breaks, bounded records, pause stability.
await input("curve-select", "circle", "change"); await input("channel-set-select", "function", "change");
await input("waveform-display-select", "scrolling-history", "change");
await input("phase-control", .249); await $("playback-button").click(); await tick(1);
await tick(6); const firstHistory = structuredClone(state.unwrap.history);
assert(firstHistory.some((r) => r.gaps.includes("tan") && r.gaps.includes("sec")), "missed between-sample circular pole");
for (let i = 1; i < firstHistory.length; i += 1) near(firstHistory[i].timestamp - firstHistory[i - 1].timestamp, 1 / 120, "fixed timestamp delta");
for (const record of firstHistory) {
  const f = curveFrame("circle", state.unwrap.params, record.t);
  near(record.channels.sin, f.channels.sin, "history value comes from same parameter");
  assert.deepEqual(record.point, f.point);
}
const historyScene = makeScene().data, tan = historyScene.channels.find((c) => c.name === "tan");
assert(tan.values.some((v) => v === null));
assert(historyScene.channels.every((c) => c.values.filter(Boolean).at(-1)?.[0] === state.unwrap.historyClock));
const gapsContext = canvasContext(); gapsContext.capture = true;
renderStudio(gapsContext, { mode: "unwrap", data: {
  points: [], channels: [{ name: "gap probe", values: [[0, 0], [.2, 1], null, [.8, -1], [1, 0]], range: 2 }],
  domain: [0, 1], axis: [0, 1], display: "domain-preview", phase: .5,
} }, 960, 570, { glow: 0 });
assert(gapsContext.paths.some(({ path }) => path.length === 4 && path[0][0] === "moveTo" && path[1][0] === "lineTo" && path[2][0] === "moveTo" && path[3][0] === "lineTo"), "renderer connected across null gap");
const beforeAxis = [...historyScene.axis]; await tick(6); assert(makeScene().data.axis[0] > beforeAxis[0]);
await $("playback-button").click(); const frozen = structuredClone(state.unwrap.history); await tick(6); assert.deepEqual(state.unwrap.history, frozen);
await input("phase-control", .249); await $("playback-button").click(); await tick(1, 50); await tick(2, 50);
assert.equal(state.unwrap.history.length, firstHistory.length);
state.unwrap.history.forEach((record, i) => { near(record.t, firstHistory[i].t, "frame-independent parameter"); near(record.timestamp, firstHistory[i].timestamp, "frame-independent timestamp"); });
await input("phase-control", .999); await tick(3, 50);
assert(state.unwrap.history.some((r) => r.loop && r.gaps.length === 6), "domain loop must break all six channels");
await tick(180, 50); assert(state.unwrap.history.length <= state.unwrap.historyMax); assert(state.unwrap.history[0].timestamp > 0);
await input("curve-parameter-radius", 1.5); assert.equal(state.unwrap.history.length, 1); assert.equal(state.unwrap.historyClock, 0);
await input("domain-end", 3, "change"); assert.equal(state.unwrap.history.length, 1); assert.equal(state.unwrap.data.domain[1], 3);
await input("domain-end", -1, "change"); assert(state.unwrap.error); assert.equal(state.unwrap.history.length, 0); render();
await input("curve-select", "hyperbola", "change"); await input("phase-control", .499); await tick(4, 50);
assert(state.unwrap.history.some((r) => r.gaps.includes("csch") && r.gaps.includes("coth")), "hyperbolic pole gap missing");
await input("curve-select", "helix", "change"); await tick(4, 50); await elapse(210);
assert.match($("coordinate-readout").textContent, /z -?\d/); assert.notEqual(state.unwrap.frame.point[2], 0);

// Real audio controller on the mock host, all recipes, edits and mute paths.
await mode("fourier");
for (const preset of HARMONIC_PRESET_LIST) {
  await input("harmonic-preset-select", preset.id, "change");
  const scene = makeScene(); near(scene.data.epicycle.endpoint[1], evaluateHarmonics(state.fourier.terms, state.fourier.phase), preset.id);
  render(); render(360);
}
await $("add-harmonic-button").click(); assert.equal(state.fourier.preset, "custom");
const edit = $("harmonic-editor").children.at(-1).children[1].children[0]; edit.value = ".21"; await edit.emit("input");
near(state.fourier.terms.at(-1).amplitude, .21, "harmonic editor");
await input("audio-parameter-pitch", 220); await input("audio-parameter-volume", .1);
await $("audio-button").click(); assert(!state.fourier.muted, $("audio-status").textContent);
const startMessage = audioMessages.findLast((m) => m.type === "start"); assert(startMessage); assert.equal(startMessage.descriptor.pitch, 220);
await input("audio-parameter-pitch", 180); assert.equal(audioMessages.findLast((m) => m.type === "update").descriptor.pitch, 180);
await check("audio-mute-toggle", true); assert(state.fourier.muted); assert.equal(gains.at(-1).value, 0);
await check("audio-mute-toggle", false); assert(!state.fourier.muted);
await $("playback-button").click(); assert(state.fourier.muted); assert.equal(audioContexts.at(-1).state, "suspended"); assert.equal(gains.at(-1).value, 0);
await $("audio-button").click(); assert(!state.fourier.muted);
await mode("pendulum"); assert(state.fourier.muted); assert.equal(gains.at(-1).value, 0);
await input("pendulum-parameter-mass1", 2); assert.equal(state.pendulum.model.t, 0);
await tick(120); assert(state.pendulum.model.t > 0); assert(state.pendulum.phase.filter(Boolean).every((p) => p.every((v) => Math.abs(v) <= Math.PI))); render();
await mode("spirograph"); await input("spiro-parameter-r", 7); assert(state.spirograph.error); render();
await input("spiro-parameter-r", 3); assert(!state.spirograph.error);
for (const name of ["hypotrochoid", "epitrochoid", "rose"]) { await input("spirograph-select", name, "change"); await tick(4); render(); }
for (const source of LIVE_SYSTEM_LIST) {
  await mode("live"); await input("live-system-select", source.id, "change"); await tick(20);
  assert(state.live.points.every((point) => point.every(Number.isFinite)), source.id);
  const key = Object.keys(source.parameters)[0]; await input(`live-parameter-${key}`, source.parameters[key].min); assert.equal(state.live.params[key], source.parameters[key].min); render();
}

// PNG must be a new high-resolution rendering, and download happens only once
// its asynchronous toBlob callback has returned a blob.
const originalCanvas = $("trace-canvas"), widthWrites = originalCanvas.widthWrites, heightWrites = originalCanvas.heightWrites;
await tick(8); assert.equal(originalCanvas.widthWrites, widthWrites); assert.equal(originalCanvas.heightWrites, heightWrites);
const exporting = $("snapshot-button").click(); await microtasks();
assert.equal(blobs.length, 1); assert.equal(downloads.length, 0);
assert.equal(blobs[0].canvas.width, state.width * 2); assert(blobs[0].canvas.context.operations > 0);
await elapse(1); await exporting; assert.equal(downloads.length, 1); assert.match(downloads[0].download, /^trace-explorer-live-.*\.png$/);
await elapse(1001); assert.deepEqual(revoked, ["blob:mock-png"]);
await mode("fourier"); await $("audio-button").click(); assert(!state.fourier.muted);
doc.hidden = true; await doc.emit("visibilitychange"); assert(!state.playing); assert(state.fourier.muted); assert.equal(gains.at(-1).value, 0); assert.equal(frames.size, 0);
doc.hidden = false; await doc.emit("visibilitychange"); assert(state.fourier.muted); assert(!state.playing, "reduced-motion must not resume hidden playback");
const metricWrites = mutations.filter((m) => m.id === "metrics-grid");
for (let i = 1; i < metricWrites.length; i += 1) assert(metricWrites[i].at - metricWrites[i - 1].at >= 200, "telemetry exceeded 5 Hz");
for (const palette of Object.keys(STUDIO_PALETTES)) { await input("theme-select", palette, "change"); assert.equal(state.palette, palette); render(360, 1200); }
console.log("UI_TEST_PASS modes=6 curves=14 presets=6 live=5 palettes=5");
console.log("UI_STREAM_PASS fixed_dt=1/120 history<=900 synchronous=true pole_gaps=true loop_gaps=true edit_resets=true");
console.log("UI_GEOMETRY_PASS channels=vx,vy,normalX,normalY,curvatureRadius,speed radius=N/kappa coordinates=xyz");
console.log("UI_LIFECYCLE_PASS stale_worker=ignored family_race=cleared stored_replay=labelled audio_mute=verified png_callback=verified telemetry<=5Hz");
console.log("UI_RENDER_PASS finite_canvas=true desktop_mobile=true budgets=bounded velocity_colors=multiple resize=stable");
