import assert from "node:assert/strict";
import {
  AUDIO_LIMITS,
  HARMONIC_PRESET_LIST,
  audioDescriptorForHarmonics,
  buildEpicycleState,
  createAudioController,
  evaluateHarmonics,
  presetHarmonics,
  synthesizeAudio,
} from "../src/audio.js";

const close = (actual, expected, tolerance = 1e-6, message = "values differ") => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

assert.deepEqual(HARMONIC_PRESET_LIST.map(({ id }) => id), ["square", "sawtooth", "pulse", "beating", "sine", "triangle"]);
assert.deepEqual(presetHarmonics("pulse", 4).map(({ frequency }) => frequency), [1, 5, 9, 13]);
assert.deepEqual(presetHarmonics("beating", 8), [
  { amplitude: 1, frequency: 1, phase: 0 },
  { amplitude: 1, frequency: 0.9, phase: 0 },
]);
assert.deepEqual(presetHarmonics("sine", 8), [{ amplitude: 1, frequency: 1, phase: 0 }]);

const terms = [
  { amplitude: 0.75, frequency: 1, phase: 0.2 },
  { amplitude: -0.25, frequency: 0.9, phase: -0.4 },
  { amplitude: 0.1, frequency: 2.5, phase: 0.7 },
];
const phase = 1.234;
const expected = terms.reduce((sum, term) => sum + term.amplitude * Math.sin(term.frequency * phase + term.phase), 0);
close(evaluateHarmonics(terms, phase), expected, 1e-12, "harmonic sum");
const epicycle = buildEpicycleState(terms, phase);
close(epicycle.endpoint[1], expected, 1e-12, "epicycle y endpoint");
assert.equal(epicycle.vectors.length, terms.length);
for (let index = 1; index < epicycle.vectors.length; index += 1) {
  assert.deepEqual(epicycle.vectors[index].center, epicycle.vectors[index - 1].endpoint);
}

const descriptor = audioDescriptorForHarmonics(terms, { pitch: 137.5, volume: 0.12, sampleRate: 48000 });
const first = synthesizeAudio(descriptor, 32, 0);
const second = synthesizeAudio(descriptor, 32, 0);
assert.deepEqual(first, second, "synthesis is not deterministic");
const expectedFirst = terms.reduce((sum, term) => sum + term.amplitude * Math.sin(
  term.frequency * 2 * Math.PI * 137.5 * 0 / 48000 + term.phase,
), 0) * descriptor.normalization * descriptor.volume;
close(first[0], expectedFirst, 1e-7, "sample formula");
const expectedAtOffset = terms.reduce((sum, term) => sum + term.amplitude * Math.sin(
  term.frequency * 2 * Math.PI * 137.5 * 17 / 48000 + term.phase,
), 0) * descriptor.normalization * descriptor.volume;
close(synthesizeAudio(descriptor, 1, 17)[0], expectedAtOffset, 1e-7, "sample offset");
assert.notEqual(first[0], synthesizeAudio(audioDescriptorForHarmonics([
  { amplitude: 1, frequency: 1, phase: 0 },
  { amplitude: 1, frequency: 0.9, phase: 0 },
], { pitch: 137.5, volume: 0.12, sampleRate: 48000 }), 1)[0]);
const beatingDescriptor = audioDescriptorForHarmonics([
  { amplitude: 1, frequency: 1, phase: 0 },
  { amplitude: 1, frequency: 0.9, phase: 0 },
], { pitch: 137.5, volume: 0.12, sampleRate: 48000 });
const beatingSample = synthesizeAudio(beatingDescriptor, 2, 1)[1];
const beatingExpected = (Math.sin(2 * Math.PI * 137.5 * 2 / 48000)
  + Math.sin(0.9 * 2 * Math.PI * 137.5 * 2 / 48000)) * beatingDescriptor.normalization * beatingDescriptor.volume;
close(beatingSample, beatingExpected, 1e-7, "fractional beating frequency");
const phaseDescriptor = audioDescriptorForHarmonics([{ amplitude: 1, frequency: 1, phase: Math.PI / 2 }], { pitch: 110 });
close(synthesizeAudio(phaseDescriptor, 1)[0], phaseDescriptor.volume, 1e-7, "term phase");
assert.ok(first.every((sample) => Math.abs(sample) <= descriptor.volume + 1e-7), "normalized gain exceeded volume");

const nyquist = audioDescriptorForHarmonics([
  { amplitude: 1, frequency: 1, phase: 0 },
  { amplitude: 1, frequency: 2, phase: 0 },
  { amplitude: 1, frequency: 0.5, phase: 0 },
], { pitch: 2000, volume: 0.2, sampleRate: 8000 });
assert.equal(nyquist.droppedTerms, 1, "Nyquist filtering was not reported");
assert.deepEqual(nyquist.terms.map(({ frequency }) => frequency), [1, 0.5]);
assert.equal(nyquist.normalization, 0.5);
assert.ok(synthesizeAudio(nyquist, 8).every(Number.isFinite), "filtered descriptor was not synthesizable");

for (const invalid of [
  () => presetHarmonics("missing"),
  () => presetHarmonics("sine", 1.5),
  () => evaluateHarmonics([{ amplitude: Number.NaN, frequency: 1, phase: 0 }], 0),
  () => evaluateHarmonics([{ amplitude: 1, frequency: 1, phase: 0 }], Infinity),
  () => audioDescriptorForHarmonics([{ amplitude: 1, frequency: 1, phase: 0 }], { sampleRate: 7999 }),
  () => synthesizeAudio(descriptor, AUDIO_LIMITS.maxSamples + 1),
]) assert.throws(invalid);

class MockPort {
  constructor() { this.messages = []; this.onmessage = null; this.closed = false; }
  postMessage(message) { this.messages.push(message); }
  close() { this.closed = true; }
}

class MockGain {
  constructor() {
    this.connections = [];
    this.gain = {
      value: 0,
      cancelScheduledValues: () => {},
      setValueAtTime: (value) => { this.gain.value = value; },
      linearRampToValueAtTime: (value) => { this.gain.value = value; },
    };
  }
  connect(destination) { this.connections.push(destination); }
  disconnect() { this.connections.length = 0; }
}

class MockContext {
  constructor() {
    this.state = "suspended";
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.audioWorklet = { addModule: async () => {} };
    this.listeners = new Map();
    this.destination = {};
    MockContext.instance = this;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  emit(type) { this.listeners.get(type)?.(); }
  createGain() { return new MockGain(); }
  async resume() { this.state = "running"; this.emit("statechange"); }
  async suspend() { this.state = "suspended"; this.emit("statechange"); }
  async close() { this.state = "closed"; this.emit("statechange"); }
}

class MockWorkletNode {
  constructor() {
    this.port = new MockPort();
    this.listeners = new Map();
    MockWorkletNode.instance = this;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  connect() {}
  disconnect() {}
}

const previousGlobals = new Map([
  ["AudioContext", globalThis.AudioContext],
  ["AudioWorkletNode", globalThis.AudioWorkletNode],
  ["isSecureContext", globalThis.isSecureContext],
]);
globalThis.AudioContext = MockContext;
globalThis.AudioWorkletNode = MockWorkletNode;
globalThis.isSecureContext = true;
try {
  const controller = createAudioController();
  assert.equal(controller.supported, true);
  await controller.start([{ amplitude: 1, frequency: 0.9, phase: 0.25 }], { pitch: 110, volume: 0.1 });
  assert.equal(controller.playing, true);
  assert.equal(MockWorkletNode.instance.port.messages.at(-1).type, "start");
  controller.update([{ amplitude: 0.5, frequency: 1.1, phase: -0.25 }], { pitch: 123.5, volume: 0.08 });
  assert.equal(MockWorkletNode.instance.port.messages.at(-1).type, "update");
  await controller.suspend();
  assert.equal(controller.playing, false);
  assert.equal(MockContext.instance.state, "suspended");
  await controller.destroy();
  assert.throws(() => controller.update([]), /destroyed/);
} finally {
  for (const [name, value] of previousGlobals) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
}

console.log("AUDIO_TEST_PASS audio=ok epicycles=ok");
