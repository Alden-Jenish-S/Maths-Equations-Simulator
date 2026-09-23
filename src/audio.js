const TAU = 2 * Math.PI;

export const AUDIO_LIMITS = Object.freeze({
  maxTerms: 128,
  maxAmplitude: 16,
  maxFrequency: 4096,
  maxPhase: 1e9,
  minPitch: 0.01,
  maxPitch: 20000,
  maxVolume: 0.25,
  minSampleRate: 8000,
  maxSampleRate: 192000,
  maxSamples: 65536,
  maxSeconds: 86400,
  rampSeconds: 0.01,
});

export const HARMONIC_PRESET_LIST = Object.freeze([
  { id: "square", name: "Square", description: "Odd sine harmonics, 4 / (πn)." },
  { id: "sawtooth", name: "Sawtooth", description: "All sine harmonics, alternating 2 / (πn)." },
  { id: "pulse", name: "Pulse series", description: "Σ sin((4k + 1)x) / (k + 1), starting at k = 0." },
  { id: "beating", name: "Beating", description: "sin(x) + sin(0.9x): two genuinely different frequencies." },
  { id: "sine", name: "Sine", description: "One sine term, sin(x)." },
  { id: "triangle", name: "Triangle", description: "Alternating odd harmonics, 8 / (π²n²)." },
].map(Object.freeze));

export const HARMONIC_PRESETS = Object.freeze(Object.fromEntries(
  HARMONIC_PRESET_LIST.map((preset) => [preset.id, preset]),
));

function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function bounded(value, min, max, name, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  if (value < min || value > max || (integer && !Number.isSafeInteger(value))) {
    throw new RangeError(`${name} must be ${integer ? "an integer " : ""}in [${min}, ${max}]`);
  }
  return value;
}

function copyTerms(terms) {
  if (!Array.isArray(terms)) throw new TypeError("terms must be an array");
  bounded(terms.length, 0, AUDIO_LIMITS.maxTerms, "term count", true);
  // Array.from also visits holes, so sparse/partially edited arrays cannot bypass validation.
  return Array.from(terms, (term, index) => {
    record(term, `term ${index}`);
    return {
      amplitude: bounded(term.amplitude, -AUDIO_LIMITS.maxAmplitude, AUDIO_LIMITS.maxAmplitude, "amplitude"),
      frequency: bounded(term.frequency, -AUDIO_LIMITS.maxFrequency, AUDIO_LIMITS.maxFrequency, "frequency"),
      phase: bounded(term.phase === undefined ? 0 : term.phase, -AUDIO_LIMITS.maxPhase, AUDIO_LIMITS.maxPhase, "phase offset"),
    };
  });
}

export function presetHarmonics(id = "square", count = 8) {
  if (typeof id !== "string" || !Object.hasOwn(HARMONIC_PRESETS, id)) throw new RangeError(`Unknown harmonic preset: ${String(id)}`);
  bounded(count, 0, AUDIO_LIMITS.maxTerms, "term count", true);
  const length = Math.min(count, id === "sine" ? 1 : id === "beating" ? 2 : count);
  return Array.from({ length }, (_, k) => {
    const n = k + 1;
    const odd = 2 * k + 1;
    const sign = k % 2 === 0 ? 1 : -1;
    switch (id) {
      case "square": return { amplitude: 4 / (Math.PI * odd), frequency: odd, phase: 0 };
      case "sawtooth": return { amplitude: sign * 2 / (Math.PI * n), frequency: n, phase: 0 };
      case "pulse": return { amplitude: 1 / n, frequency: 4 * k + 1, phase: 0 };
      case "beating": return { amplitude: 1, frequency: k === 0 ? 1 : 0.9, phase: 0 };
      case "triangle": return { amplitude: sign * 8 / (Math.PI ** 2 * odd ** 2), frequency: odd, phase: 0 };
      default: return { amplitude: 1, frequency: 1, phase: 0 };
    }
  });
}

export function evaluateHarmonics(terms, phase) {
  const checked = copyTerms(terms);
  bounded(phase, -AUDIO_LIMITS.maxPhase, AUDIO_LIMITS.maxPhase, "phase");
  let y = 0;
  for (const term of checked) y += term.amplitude * Math.sin(term.frequency * phase + term.phase);
  return y;
}

export function buildEpicycleState(terms, phase) {
  const checked = copyTerms(terms);
  bounded(phase, -AUDIO_LIMITS.maxPhase, AUDIO_LIMITS.maxPhase, "phase");
  let x = 0;
  let y = 0;
  const vectors = checked.map((term) => {
    const center = [x, y];
    const angle = term.frequency * phase + term.phase;
    x += term.amplitude * Math.cos(angle);
    // Use the same arithmetic as evaluateHarmonics, including negative amplitudes.
    y += term.amplitude * Math.sin(angle);
    return {
      center,
      endpoint: [x, y],
      radius: Math.abs(term.amplitude),
      angle: angle + (term.amplitude < 0 ? Math.PI : 0),
      frequency: term.frequency,
    };
  });
  return { endpoint: [x, y], vectors };
}

export function audioDescriptorForHarmonics(terms, options = {}) {
  record(options, "audio options");
  const { pitch = 110, volume = 0.12, sampleRate = 48000 } = options;
  bounded(pitch, AUDIO_LIMITS.minPitch, AUDIO_LIMITS.maxPitch, "pitch");
  bounded(volume, 0, AUDIO_LIMITS.maxVolume, "volume");
  bounded(sampleRate, AUDIO_LIMITS.minSampleRate, AUDIO_LIMITS.maxSampleRate, "sampleRate", true);
  const checked = copyTerms(terms);
  const audible = checked.filter((term) => Math.abs(term.frequency * pitch) < sampleRate / 2);
  const amplitudeSum = audible.reduce((sum, term) => sum + Math.abs(term.amplitude), 0);
  return {
    terms: audible,
    pitch,
    volume,
    sampleRate,
    normalization: 1 / Math.max(1, amplitudeSum),
    droppedTerms: checked.length - audible.length,
  };
}

export function synthesizeAudio(descriptor, count = 2048, startSample = 0) {
  record(descriptor, "descriptor");
  const checked = audioDescriptorForHarmonics(descriptor.terms, descriptor);
  if (descriptor.normalization !== checked.normalization || checked.droppedTerms !== 0) {
    throw new RangeError("Use a fresh audioDescriptorForHarmonics result after editing terms");
  }
  bounded(count, 0, AUDIO_LIMITS.maxSamples, "sample count", true);
  bounded(startSample, 0, checked.sampleRate * AUDIO_LIMITS.maxSeconds - count, "startSample", true);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const phase = TAU * checked.pitch * ((startSample + i) / checked.sampleRate);
    let sum = 0;
    for (const term of checked.terms) sum += term.amplitude * Math.sin(term.frequency * phase + term.phase);
    samples[i] = sum * checked.normalization * checked.volume;
  }
  return samples;
}

function audioError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

// No browser objects are accessed/created until this factory is explicitly called.
export function createAudioController() {
  let context = null;
  let node = null;
  let gate = null;
  let preparing = null;
  let suspending = null;
  let destroying = null;
  let destroyed = false;
  let wanted = false;
  let active = false;
  let revision = 0;
  let desired = null;
  let settings = { pitch: 110, volume: 0.12 };
  const documentTarget = globalThis.document;
  const pageTarget = globalThis.window;
  const Context = () => globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const supported = () => typeof Context() === "function"
    && typeof globalThis.AudioWorkletNode === "function"
    && globalThis.isSecureContext !== false
    && (!context || Boolean(context.audioWorklet));

  function assertLive() {
    if (destroyed) throw audioError("InvalidStateError", "Audio controller has been destroyed");
  }

  function setGate(value) {
    if (!gate || context.state === "closed") return;
    const now = context.currentTime;
    gate.gain.cancelScheduledValues(now);
    gate.gain.setValueAtTime(gate.gain.value ?? 0, now);
    if (typeof gate.gain.linearRampToValueAtTime === "function") {
      gate.gain.linearRampToValueAtTime(value, now + AUDIO_LIMITS.rampSeconds);
    } else {
      gate.gain.setValueAtTime(value, now);
    }
  }

  function stop() {
    wanted = false;
    active = false;
    revision += 1;
    node?.port.postMessage({ type: "stop" });
    setGate(0);
  }

  function mute() {
    stop();
    // Suspend/page-hide can freeze the audio clock, so force the emergency gate
    // closed after the normal click-suppressing stop ramp is requested.
    if (gate && context.state !== "closed") {
      gate.gain.cancelScheduledValues(context.currentTime);
      gate.gain.setValueAtTime(0, context.currentTime);
    }
    setGate(0);
    node?.port.postMessage({ type: "mute" });
  }

  function onStateChange() {
    // An OS/browser interruption must never re-enable a stale voice on resume.
    if (context.state !== "running") mute();
  }

  function onHidden() {
    if (documentTarget?.hidden) void suspend().catch(() => {});
  }

  function onPageHide() {
    void suspend().catch(() => {});
  }

  function releaseNode() {
    if (!node) return;
    node.removeEventListener("processorerror", onProcessorError);
    node.port.onmessage = null;
    node.port.postMessage({ type: "destroy" });
    node.disconnect();
    node.port.close();
    node = null;
  }

  function onProcessorError() {
    mute();
    releaseNode(); // A processor that threw cannot render again; next gesture rebuilds it.
  }

  function ensureContext() {
    if (context) return;
    context = new (Context())({ latencyHint: "interactive" });
    context.addEventListener("statechange", onStateChange);
    documentTarget?.addEventListener("visibilitychange", onHidden);
    pageTarget?.addEventListener("pagehide", onPageHide);
    gate = context.createGain();
    gate.gain.setValueAtTime(0, context.currentTime);
    gate.connect(context.destination);
  }

  function ensureNode() {
    if (node) return Promise.resolve();
    if (!preparing) {
      preparing = (async () => {
        if (!context.audioWorklet) throw audioError("NotSupportedError", "AudioWorklet is unavailable");
        await context.audioWorklet.addModule(new URL("./audio-worklet.js", import.meta.url).href);
        if (destroyed || context.state === "closed") return;
        node = new globalThis.AudioWorkletNode(context, "equation-synth", {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
        });
        node.addEventListener("processorerror", onProcessorError);
        node.port.onmessage = (event) => {
          if (event.data?.type === "error") mute();
        };
        node.connect(gate);
      })().finally(() => { preparing = null; });
    }
    return preparing;
  }

  function describe(terms, options) {
    record(options, "audio options");
    // Hardware rate, not a UI-supplied sample rate, determines browser Nyquist.
    return audioDescriptorForHarmonics(terms, {
      ...settings, ...options, sampleRate: context?.sampleRate ?? 48000,
    });
  }

  function remember(descriptor) {
    desired = descriptor;
    settings = { pitch: descriptor.pitch, volume: descriptor.volume };
  }

  async function start(terms, options = {}) {
    assertLive();
    if (!supported()) throw audioError("NotSupportedError", "Equation audio requires AudioWorklet on HTTPS or localhost");
    if (documentTarget?.hidden || globalThis.navigator?.userActivation?.isActive === false) {
      throw audioError("NotAllowedError", "Start audio directly from a visible-page user gesture");
    }
    if (suspending) throw audioError("InvalidStateError", "Await suspend() before starting audio again");
    describe(terms, options); // Reject malformed edits before creating browser resources.
    ensureContext();
    if (context.state === "closed") throw audioError("InvalidStateError", "Audio context is closed; create a new controller");
    remember(describe(terms, options));
    if (active && context.state === "running") {
      node.port.postMessage({ type: "update", descriptor: desired });
      return;
    }
    wanted = true;
    const ticket = ++revision;
    try {
      // resume() must run in the gesture call stack, before awaiting module loading.
      const resuming = context.resume();
      await Promise.all([resuming, ensureNode()]);
      if (destroyed || !wanted || ticket !== revision) return;
      if (context.state !== "running" || !node) throw audioError("NotAllowedError", "Audio context did not resume");
      setGate(1);
      node.port.postMessage({ type: "start", descriptor: desired });
      active = true;
    } catch (error) {
      if (ticket === revision) mute();
      throw error;
    }
  }

  function update(terms, options = {}) {
    assertLive();
    remember(describe(terms, options));
    if (wanted && active && context.state === "running") {
      node.port.postMessage({ type: "update", descriptor: desired });
    }
  }

  function suspend() {
    if (destroyed) return destroying ?? Promise.resolve();
    mute();
    if (!context || context.state === "closed") return Promise.resolve();
    if (!suspending) {
      try {
        suspending = Promise.resolve(context.suspend()).finally(() => { suspending = null; });
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return suspending;
  }

  function destroy() {
    if (destroyed) return destroying ?? Promise.resolve();
    destroyed = true;
    mute();
    documentTarget?.removeEventListener("visibilitychange", onHidden);
    pageTarget?.removeEventListener("pagehide", onPageHide);
    context?.removeEventListener("statechange", onStateChange);
    releaseNode();
    gate?.disconnect();
    gate = null;
    try {
      destroying = Promise.resolve(context && context.state !== "closed" ? context.close() : undefined);
    } catch (error) {
      destroying = Promise.reject(error);
    }
    return destroying;
  }

  return {
    start, update, stop, suspend, destroy,
    get playing() { return !destroyed && wanted && active && context?.state === "running"; },
    get supported() { return supported(); },
  };
}
