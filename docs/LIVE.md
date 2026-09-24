# Streaming, clocks, and the six instruments

The app has six modes sharing one visual transport. The **Signal laboratory** uses the five incremental sources in `src/live.js`; the **Harmonic observatory** uses the separate editable-harmonic and audio APIs in `src/audio.js`. Discovery runs batch simulations and writes ranked artifacts. Interactive streaming keeps state in memory.

## Which clock is running?

| Mode / UI name | Source and clock | Display and edit semantics |
| --- | --- | --- |
| `atlas` / Dynamical atlas | Cached or worker-computed batch trajectory. Transport time moves a cursor through that trajectory; it does not integrate new samples. | Coordinate projections use retained raw points. Parameter edits request another trajectory. Projection and palette edits do not change the underlying dynamics. |
| `unwrap` / Parametric study | `curveFrame(id, params, t)` for seventeen curves. A dimensionless phase traverses the selected domain at 0.055 cycles per transport second. Scrolling history samples at 1/120 simulation second. | A shared history record aligns geometry and every channel at the same actual curve parameter `t`. The default scrolling history retains at most 900 records; domain preview shows a cached 961-sample domain. Curve/parameter/domain/channel edits and manual phase scrubbing reset history. |
| `fourier` / Harmonic observatory | Visual phase advances at 0.8 radians per transport second. Audio uses the device sample clock and the selected pitch in Hz. | Edited amplitudes, frequency multipliers, phases, and term counts immediately rebuild the visual equation at the current phase. Audio updates the same equation with its own transition ramp. |
| `spirograph` / Rolling gear laboratory | Rolling parameter advances at 0.8 radians per transport second over a cached finite domain. | Hypotrochoid, epitrochoid, and rose paths use phase-offset pens. Parameter edits rebuild the geometry and restart its visual phase. The rose is a polar oscillator, not a rolling-contact construction. |
| `pendulum` / Nonlinear dynamics | The double-pendulum model in `art-modes.js` receives repeated 1/240-second steps. | Physical bob trails and an angle–angle portrait share each integrated state. UI parameter edits restart this model. Angles remain unwrapped numerically; only the portrait is wrapped to ±π, with path gaps at wraps. |
| `live` / Signal laboratory | The selected `live.js` source advances one numerical step per call: Fourier 1/120 s, Lissajous 1/180 s, driven pendulum / Van der Pol / ECG-like wave 1/240 s. | At most 1,800 displayed points. Direct sources reevaluate retained timestamps on edits; live ODE sources keep their state and replace the visible buffer with one current point. |

The global `t` readout is the visual transport clock. It is reset on mode entry and can differ from a source's elapsed time, a curve parameter, an angular phase, or audio time. Only the active visual instrument advances. Entering Signal laboratory or Nonlinear dynamics resets that instrument; returning to Parametric study resets its history at the current phase.

### Frame scheduling and pause/resume

`requestAnimationFrame` supplies elapsed browser time. The app caps that elapsed time at **50 ms before applying playback speed**. Live and double-pendulum accumulators run at most **40 fixed steps per animation frame**; remaining whole-step backlog is discarded and a dropped-frame counter increments. Parametric history runs at most 20 fixed samples per frame and retains its remaining accumulator. These scheduling limits affect the relation to wall time, not the individual equations or numerical step size.

- **Play / Pause:** pausing preserves numerical state, fractional accumulators, and buffers. Resuming resets the browser timestamp baseline so the paused interval is not integrated. Grouping the same fixed steps into different render frames produces the same numerical sequence; changing `dt` is a different numerical experiment.
- **Restart:** live sources return to their initial state and render exactly one sample at `t=0`; the first subsequent step is at `dt`. The Restart button preserves the current Play/Pause selection.
- **Visibility:** hiding the page pauses visuals and mutes/suspends audio. Visible-page visuals resume only if previously playing and reduced motion is not requested. Audio requires an explicit enable gesture again.
- **Parameters:** range inputs supply numeric values on `input`. Drawing is scheduled/coalesced; edits do not write Discovery artifacts. Changes made at different numerical step indices can produce different streams even if the same wall-clock gesture was attempted.

## Live-source equations

### Fourier composer

\[
y(t)=A\frac{\sum_{n=1}^{K}n^{-p}\sin(2\pi nft+m\sin(2\pi(0.11+0.007n)t))}{\max(1,\sum_{n=1}^{K}n^{-p})}.
\]

`K` is an integer harmonic count; `p` sets the spectral slope, `f` the fundamental frequency, `m` the phase modulation, and `A` the output scale. Dividing by the sum of positive weights bounds the mathematical amplitude by `A`. This normalization is part of the defined equation, not a divergence clamp. It is separate from the custom epicycle/audio harmonic editor.

### Sine / Lissajous chirp

\[
x=A\sin(2\pi(f_xt+ct^2/2)),\qquad y=A\sin(2\pi(f_yt+0.73ct^2/2)+\delta).
\]

The `point` is `[x,y]`, not `[timestamp,value]`; its timestamp is `state.t`. Rational frequency ratios can close when chirp is zero. Nonzero chirp changes instantaneous frequency with source time. Direct evaluation avoids integration drift, but does not avoid floating-point phase error or visual undersampling.

### Driven pendulum

\[
\ddot\theta=-\frac{g}{L}\sin\theta-d\dot\theta+F\sin(2\pi f_dt).
\]

The live single pendulum starts at `theta=0.7`, `velocity=0`, `t=0`. Fixed-step RK4 integrates `(theta, velocity, t)`, and the displayed sample is `[t,theta]`. The frequency control is in Hz; the forcing uses `2π f_d t`. For small, undriven swings, `ω₀=√(g/L)` and `T=2π√(L/g)`. This source is distinct from the double-pendulum instrument.

### Van der Pol oscillator

\[
\dot x=v,\qquad \dot v=\mu(1-x^2)v-x+A\sin(2\pi f_dt).
\]

The initial state is `position=1`, `velocity=0`, `t=0`. Increasing `μ` sharpens relaxation oscillations and makes integration more demanding. The displayed point is `[t, amplitude * position]`, while the returned `value` remains the **unscaled position** for compatibility. Changing output amplitude does not alter the oscillator state.

### Synthetic ECG-like wave

\[
\phi=(t\,\mathrm{BPM}/60+H\sin(2\pi\,0.1t))\bmod1,
\]
\[
z(\phi)=M\sum_i a_i\exp\left(-\frac{\Delta(\phi-c_i)^2}{2b_i^2}\right)
+B\sin(2\pi\,0.25t)+N\bigl(\sin(2\pi\,7.1t)+0.5\sin(2\pi\,13.7t)\bigr),
\]

where `Δ(u)=u−round(u)`. Five wrapped Gaussian pulses suggest P/Q/R/S/T morphology. HRV and texture are deterministic phase/waveform terms, not randomness or measured variability. This is **not medical data, a physiological model, or a diagnostic tool**.

## Incremental API and validation

The module is DOM-free and creates no timers or audio resources:

```js
import { createLiveState, getLiveSystem, advanceLive, rebuildLiveWindow } from "./src/live.js";

const source = getLiveSystem("fourier");
const params = { ...source.defaults };
const state = createLiveState(source.id);
const initial = rebuildLiveWindow(source.id, state, params, 1800); // one t=0 point
const next = advanceLive(source.id, state, params);              // exactly one dt
params.harmonics = 10;
const revised = rebuildLiveWindow(source.id, state, params, 1800); // only t=0 and dt
const resumed = advanceLive(source.id, state, params);            // next source time
```

`advanceLive` commits numerical fields and timestamps only after a successful candidate step. It returns `{ point, value, diverged: false }`. Lissajous returns `value: null`; the other direct signals and the single pendulum return their scalar signal value. `sample` and `currentPoint` are read-only evaluations. Direct descriptor methods enforce the same declared-parameter validation as the exported wrappers.

| Input / state | Accepted bounds |
| --- | --- |
| `dt` | Finite JavaScript number, `1e-9 ≤ dt ≤ source.dt`. Omitted/`undefined` selects the default. Zero, negative, oversized, non-finite, `null`, and coerced string values are rejected. Pause by making no call. |
| Source time | `0 ≤ state.t ≤ 1,000,000` seconds, with a representably advancing half-step and full step. |
| Fourier | `frequency` 0.1…3; integer `harmonics` 1…16; `slope` 0…3; `modulation` 0…1; `amplitude` 0.2…2. |
| Lissajous | `frequencyX/Y` 0.1…4; `chirp` −0.25…0.25; `phase` −3.14…3.14; `amplitude` 0.2…1.5. |
| Single pendulum | `length` 0.5…3; `gravity` 1…15; `damping` 0…0.8; `drive` 0…3; `driveFrequency` 0.1…4. |
| Van der Pol | `nonlinearity` 0…8; `drive` 0…1.5; `driveFrequency` 0.1…3; `amplitude` 0.3…2. |
| ECG-like | `bpm` 45…150; `morphology` 0.5…1.5; `hrv` 0…0.2; `baseline` 0…0.3; `noise` 0…0.08. Fractional BPM is allowed by the API although the UI step is 1. |
| ODE state guards | Single pendulum: `|theta|, |velocity| ≤ 100`. Van der Pol: `|position| ≤ 50`, `|velocity| ≤ 100`. Every RK4 stage and final candidate must meet these guards and have finite derivatives. |
| Window count | Safe integer 1…1,000,000. This is a requested upper bound; returned data never exceeds available history or 1,800 points. Invalid requests throw rather than being rounded or silently clamped. |

Declared parameters must be finite numbers in their schema range. Missing/`undefined` parameters take defaults; `null`, booleans, arrays, strings, and non-finite values are rejected. Except for harmonic count, UI `step` is a slider increment, not an API quantization rule. Invalid input throws `TypeError` or `RangeError` without modifying state.

On a **computed numerical or clock guard failure**, the numerical fields and history remain at their last valid values. The state is marked `diverged: true` with a `reason`, and `advanceLive` throws `RangeError` without emitting a point. Further advances also throw until the caller resets. There is no angle/velocity clipping, wrapping of numerical state, time reset, or fabricated continuation. A guard can reject a large but physically legitimate motion; it is an operational limit, not proof of mathematical divergence or chaos.

The live-source animation branch catches guard errors, pauses playback, and displays a frozen status and the failure reason. The last finite state and visible prefix remain available for inspection. Restart or reselect the source to clear the frozen state and overlay. API callers should likewise catch errors and display `state.reason`.

### Retained history and parameter edits

Each new live state includes `history: [0]`. Every successful step appends its actual `t` and retains the latest 1,800 timestamps. History is strictly increasing, finite, and ends exactly at `state.t`; malformed, duplicate, sparse, future, or oversized history is rejected. Memory and rebuild work remain bounded regardless of session length.

For Fourier, Lissajous, and ECG-like sources, `rebuildLiveWindow` returns the requested suffix of **existing timestamps** reevaluated with the current parameters. It does not reconstruct timestamps using `floor(t / dt)` or extrapolate to fill a requested count. Thus requesting 1,800 samples at startup returns one; requesting them after three steps returns four. Variable-`dt` histories are preserved exactly. The last direct-source point always belongs to the current clock, including XY sources whose timestamp is not embedded in the point.

For ODE sources, rebuilding returns one current point without integration. The app discards the old displayed trail on that edit, but retains the actual oscillator state for the next step. A forcing edit changes subsequent dynamics; an output-scale edit can affect the displayed current point immediately. Direct-source edits instead redraw the past visible window using the new equation and can create a discontinuity at the edit. Neither behavior is a recording of the old parameter regime.

Rebuilding is read-only. `structuredClone(state)` or a JSON round trip preserves timestamps and numerical state for an independent resume with the same parameter/`dt` schedule. Parameters must be saved separately. A legacy state with no `history` has only its current timestamp available; the API returns one point instead of inventing earlier samples. The next successful step begins its new history there. History is caller-owned data, not an authenticated provenance log; copying only the outer object shares the history array.

## Projection, sampling, and audio limitations

- **Geometry is parameterized, not necessarily traversed at constant physical speed.** The curve parameter `t` and scrolling-history timestamp are different quantities. `speed` is `‖dr/dt‖`. Domain preview may show future domain positions relative to the cursor because it is a preview; live history contains only evaluated records. A negative empty left edge on a scrolling time axis is not a negative-time sample.
- **Projection changes appearance.** Atlas x–y/x–z/y–z views omit a coordinate. The helix is a 3D curve shown through the oblique map `(0.82x−0.48y, z+0.26x+0.43y)`; projected crossings, angles, lengths, and curvature are not the original 3D geometry. The optional moving-frame view projects positions relative to the current point onto its tangent/normal basis. Its axes move, and a spatial curve's binormal component is omitted.
- **Frame vectors have display conventions.** The geometry API supplies the left normal for planar curves and non-negative curvature. The app orients its displayed normal toward turning direction to draw `N/κ`. Tangent/normal arrows use visual sizing, the curvature-radius arrow has an explicit screen-length cap, and an off-scale osculating circle may be omitted. At cusps or zero curvature there is no fabricated finite curvature circle.
- **Singularities remain gaps.** Undefined ratio channels and cusp curvature are `null`. Batch curve sampling also removes values bracketing an interior pole; an isolated `curveFrame` has no neighboring interval to inspect. Exact batch/frame comparisons must use pole-aligned grids or explicitly account for this display-gap policy. Scrolling channels insert gaps at poles and domain loops. Ratio/radius panels can be labeled “display clipped”; clipping the panel is distinct from modifying source data.
- **Bounded output does not imply resolved dynamics.** The live limits bound work and protect finite output. RK4 is neither adaptive nor energy-preserving, and the guards are not error estimates. Long chaotic trajectories can separate with step refinement. Fourier harmonics, ECG-like pulse widths, and especially chirps can be undersampled; the chirp frequency grows with time even though its sine amplitude stays bounded. Long-time trigonometric evaluation also loses phase precision before an overflow would occur.
- **Audio has its own clock and spectrum.** At audio sample index `i`, the pure synthesizer evaluates the harmonic sum at `2π·pitch·i/sampleRate`. Epicycle endpoint y equals the unnormalized visual sum at its dimensionless phase. Audio normalizes amplitude and omits terms at or above device Nyquist, reporting `droppedTerms`; browser edits crossfade and therefore need not equal one static equation during a transition. Negative and fractional frequency multipliers remain part of the equation. The five live sources are visual sources and are not automatically sonified.
- **Rendering is a finite presentation.** Persistence selects a bounded window, the draw budget may decimate points, and Canvas2D uses layered strokes for glow. Autoscaling, projection, and bloom can emphasize patterns. A PNG or attractive finite trace is not evidence of stability, chaos, a physiological mechanism, or statistical significance.

See [GEOMETRY.md](GEOMETRY.md) for curve and double-pendulum definitions, [AUDIO.md](AUDIO.md) for synthesis and device behavior, and [NUMERICS.md](NUMERICS.md) for batch dynamics.

## Verification

Run `npm run live-test` (or `node scripts/live-test.mjs`). The test compares complete 2,400-step default and edited sequences for every live source, including irregular scheduling groups and serialized midstream resume. It checks initial frames, actual retained timestamps, oversized requests, variable steps, all parameter-box corners, invalid inputs, frozen guard failures, the analytic unforced linear limit of Van der Pol, and conservative/damped live-pendulum energy.

Integration checks compare all seventeen `curveFrame` point/channel streams with exact pole-aligned batch samples, compare every double-pendulum frame/state across repeated-step chunk groupings and edits, and verify edited epicycle sums and exact Float32 audio samples at aligned offsets. The script then **imports and awaits** `scripts/art-test.mjs` and `scripts/audio-test.mjs`, including the latter's asynchronous controller tests. A failed import or assertion prevents the final combined pass line. These are Node numerical/API tests; they do not certify real browser rendering or physical audio-device behavior.

### Streaming hardening acceptance gates

Scope: `src/live.js`, `scripts/live-test.mjs`, and this document.

- [x] L1: All five sources preserve complete deterministic sequences through grouped steps, parameter edits, and resume.
  CHECK: node scripts/live-test.mjs
  EXPECT: /LIVE_TEST_PASS systems=5 .*determinism=ok resume=ok/
  EVIDENCE: LIVE_TEST_PASS systems=5 samples_per_system=2400 determinism=ok resume=ok
- [x] L2: Initial frames and rebuilt windows contain only actual retained timestamps; invalid inputs and computed guard failures are explicit.
  CHECK: node scripts/live-test.mjs
  EXPECT: /history=ok guards=ok/
  EVIDENCE: LIVE_TEST_PASS includes history=ok guards=ok; assertions cover t=0, variable dt, count beyond history, and transactional RK4 failures.
- [x] L3: Aligned geometry, harmonic edits, grouped pendulum streams, and both imported suites pass before the combined result.
  CHECK: node scripts/live-test.mjs
  EXPECT: /curves=17 audio=ok epicycles=ok physics=ok/
  EVIDENCE: ART_TEST_PASS curves=17 physics=ok; AUDIO_TEST_PASS audio=ok epicycles=ok; LIVE_TEST_PASS includes curves=17 audio=ok epicycles=ok physics=ok.
- [x] L4: Documentation covers the current six modes, clocks, projections, and numerical/display limitations.
  EVIDENCE: This document's clock table, Frame scheduling, Incremental API, Retained history, and Projection sections were checked against src/app.js, src/studio-renderer.js, src/art-modes.js, src/audio.js, and src/live.js.

## Research sources

- Fourier-series definition and synthesis: <https://en.wikipedia.org/wiki/Fourier_series>
- Simple-pendulum approximation: <https://en.wikipedia.org/wiki/Pendulum_(mechanics)>
- ECG recording and waveform terminology: <https://en.wikipedia.org/wiki/Electrocardiography>
- Browser animation timing: <https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame>
- Page visibility: <https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>
- Canvas rendering: <https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas>

These sources motivate equations and terminology. The application-specific limits, clocks, and display conventions above describe the implementation rather than claims established by those references.
