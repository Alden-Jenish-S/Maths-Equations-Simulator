# Exact Fourier audio

The Fourier mode uses the same finite equation for its epicycle and its audio:

```text
y(phase) = Σ amplitude · sin(frequency · phase + phaseOffset)
```

`src/audio.js` is safe to import from Node. It does not create an `AudioContext`, worklet, or other browser resource at module load time.

## Pure API

```js
import {
  audioDescriptorForHarmonics,
  buildEpicycleState,
  evaluateHarmonics,
  presetHarmonics,
  synthesizeAudio,
} from "./src/audio.js";

const terms = [
  { amplitude: 1, frequency: 1, phase: 0 },
  { amplitude: 0.5, frequency: 0.9, phase: Math.PI / 3 },
];
const phase = 0.8;
const endpoint = buildEpicycleState(terms, phase).endpoint;
console.log(endpoint[1] === evaluateHarmonics(terms, phase));

const descriptor = audioDescriptorForHarmonics(terms, {
  pitch: 110,
  volume: 0.12,
  sampleRate: 48000,
});
const samples = synthesizeAudio(descriptor, 2048, 0);
```

`presetHarmonics(id, count)` returns editable `{ amplitude, frequency, phase }` terms. Available IDs are `sine`, `square`, `sawtooth`, `triangle`, `pulse`, and `beating`. The pulse preset is exactly `Σ sin((4k + 1)x) / (k + 1)`; beating contains `sin(x) + sin(.9x)`. Frequencies are multipliers of the base phase, so `0.9` remains fractional throughout the equation and audio path.

`audioDescriptorForHarmonics` applies a conservative normalization of `1 / max(1, Σ|amplitude|)` and keeps the requested volume at or below the controller limit. It filters terms whose absolute frequency in Hz is at or above `sampleRate / 2`; `droppedTerms` reports the number removed. Supply the actual output sample rate when using the pure synthesizer.

## Browser controller

```js
import { createAudioController, presetHarmonics } from "./src/audio.js";

const audio = createAudioController();
button.addEventListener("click", async () => {
  await audio.start(presetHarmonics("beating"), { pitch: 110, volume: 0.1 });
});

audio.update(editedTerms, { pitch: 110, volume: 0.1 });
audio.stop();
await audio.suspend();
await audio.destroy();
```

`start` must be called directly from a visible-page user gesture. The controller creates the context and loads `src/audio-worklet.js` only then. The worklet sums the equation per output sample, maintains a sample-frame phase for exact fractional frequencies and term phases, and fades starts, updates, and stops to suppress clicks. An update crossfades between equations rather than replacing a running oscillator with a guessed pitch. There is no value-to-pitch or one-oscillator sonification path.

The controller exposes `playing` and `supported` getters. `stop()` silences the worklet with a short ramp. `suspend()` and page visibility/page-hide handling mute before suspending; suspension does not automatically restart audio. `destroy()` removes listeners, disconnects nodes, closes the context, and makes later updates invalid.

## Frontend caveats

- Keep the audio button handler as the user-gesture boundary. Do not start audio from a timer, animation frame, module import, or slider `input` event.
- Treat visual `phase` and audio time as separate quantities. A drawing can advance phase at any visual speed; audio advances phase from `sampleIndex / sampleRate` at the selected pitch.
- Rebuild the edited term array before `update`. A new amplitude, fractional frequency, or phase is part of the equation and is sent to the worklet as such.
- Show `droppedTerms` when a high-frequency edit is filtered. Filtering uses the browser output rate in the controller and the supplied rate in pure Node synthesis.
- The worklet is the browser implementation. AudioWorklet availability, secure-context rules, output-device permissions, and browser autoplay policy can make `supported` false or cause `start` to reject; keep the Fourier canvas usable when audio is unavailable.
- Terms and samples are bounded to keep edits and generated buffers finite: at most 128 terms, 4,096× base-frequency multiplier, 65,536 samples per pure call, and a 24-hour worklet frame budget.
