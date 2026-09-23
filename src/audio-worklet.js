import { AUDIO_LIMITS, audioDescriptorForHarmonics } from "./audio.js";

const TAU = 2 * Math.PI;

class EquationSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.descriptor = null;
    this.pending = null;
    this.resetOnSwap = false;
    this.frame = 0;
    this.gain = 0;
    this.targetGain = 0;
    this.remaining = 0;
    this.rampFrames = Math.max(1, Math.round(sampleRate * AUDIO_LIMITS.rampSeconds));
    this.port.onmessage = ({ data }) => {
      try {
        this.receive(data);
      } catch (error) {
        this.clear();
        this.port.postMessage({ type: "error", message: error.message });
      }
    };
  }

  clear() {
    this.descriptor = null;
    this.pending = null;
    this.resetOnSwap = false;
    this.gain = 0;
    this.targetGain = 0;
    this.remaining = 0;
  }

  ramp(target) {
    this.targetGain = target;
    this.remaining = this.rampFrames;
  }

  swap() {
    this.descriptor = this.pending;
    this.pending = null;
    if (this.resetOnSwap) this.frame = 0;
    this.resetOnSwap = false;
    if (this.descriptor) this.ramp(1);
  }

  receive(message) {
    if (!this.alive) return;
    if (!message || typeof message !== "object") throw new TypeError("Invalid audio message");
    switch (message.type) {
      case "start":
      case "update": {
        const source = message.descriptor;
        if (!source || source.sampleRate !== sampleRate) throw new RangeError("Descriptor must use the hardware sample rate");
        // Revalidate at the worklet boundary; do not trust externally supplied gain.
        const descriptor = audioDescriptorForHarmonics(source.terms, { ...source, sampleRate });
        if (message.type === "update" && !this.descriptor && !this.pending) return;
        this.pending = descriptor;
        this.resetOnSwap ||= message.type === "start";
        if (!this.descriptor || this.gain === 0) this.swap();
        else if (this.targetGain !== 0) this.ramp(0);
        break;
      }
      case "stop":
        this.pending = null;
        this.resetOnSwap = false;
        if (this.descriptor && this.targetGain !== 0) this.ramp(0);
        break;
      case "mute":
        this.clear();
        break;
      case "destroy":
        this.clear();
        this.alive = false;
        break;
      default:
        throw new RangeError("Unknown audio message type");
    }
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    if (!channels?.length) return this.alive;
    const output = channels[0];
    for (let i = 0; i < output.length; i += 1) {
      let value = 0;
      if (this.descriptor) {
        if (this.frame >= sampleRate * AUDIO_LIMITS.maxSeconds) {
          this.clear();
          this.port.postMessage({ type: "error", message: "Audio session reached the 24-hour frame limit" });
        } else {
          const { terms, pitch, volume, normalization } = this.descriptor;
          const phase = TAU * pitch * (this.frame / sampleRate);
          let sum = 0;
          for (const term of terms) sum += term.amplitude * Math.sin(term.frequency * phase + term.phase);
          value = sum * normalization * volume * this.gain;
          this.frame += 1;
        }
      }
      output[i] = value;
      if (this.remaining > 0) {
        this.gain += (this.targetGain - this.gain) / this.remaining;
        this.remaining -= 1;
        if (this.remaining === 0) {
          this.gain = this.targetGain;
          if (this.targetGain === 0) this.swap();
        }
      }
    }
    for (let channel = 1; channel < channels.length; channel += 1) channels[channel].set(output);
    return this.alive;
  }
}

registerProcessor("equation-synth", EquationSynthProcessor);
