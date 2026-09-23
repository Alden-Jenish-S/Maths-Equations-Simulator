# Integration contract

These APIs are the integration boundary for the parallel implementation. All numerical APIs are importable in Node without a DOM. Browser-only resources are created on explicit calls, never at module import.

## Geometry and physics: `src/art-modes.js`

- `CURVES`, `CURVE_LIST`: 14 entries: circle, ellipse, hyperbola, parabola, involute, superellipse, lemniscate, cardioid, deltoid, nephroid, archimedean, logarithmic, clothoid, helix. Each `{id,name,family,equation,description,defaults,parameters,domain:[min,max],closed}`. Every schema `{label,min,max,step,default}`.
- `sampleCurve(id, params={}, count=720)` → `{points, channels, metadata}`. Channels are arrays keyed by channel name, missing/singular entries are `null` (never connected across a pole).
- `curveFrame(id, params={}, t=0)` → `{point:[x,y,z?], tangent:[...], normal:[...], curvature:number|null, speed:number, channels:{name:number|null}, singular:boolean}`. `t` is actual curve parameter; all 14 default domains finite. Circle channels sin/cos/tan/cot/sec/csc; hyperbola cosh/sinh/tanh/sech/csch/coth; other curves x/y/z as relevant, plus tangentX/tangentY, normalX/normalY, speed, curvature.
- `SPIROGRAPH_DEFAULTS={R:5,r:3,d:2,mode:'hypotrochoid'}`; `spirographPoint(params,t,phase=0)` → `[x,y]`; `generateSpirograph(params={}, count=2400)` → `{points,metadata}`. Modes hypotrochoid, epitrochoid, rose. UI may pass multi-pen phases.
- `PENDULUM_DEFAULTS={length1:1,length2:1,mass1:1,mass2:1,gravity:9.81,damping:0}`; `createDoublePendulum(initial={})` → `{t,theta1,theta2,omega1,omega2,...}`. `stepDoublePendulum(state,params={},dt=1/240)` mutates state and returns `{point,geometry:{origin,bob1,bob2},phaseSpace:[theta1,theta2],energy:number,bounded:boolean,diverged:boolean}`; `doublePendulumFrame(state,params={})` returns same without advancing. Numerical state unwrapped; display may wrap angles. Reject/freeze invalid input, never clip a divergence into art.

## Fourier/audio: `src/audio.js`

- `HARMONIC_PRESETS`, `HARMONIC_PRESET_LIST`: `{id,name,description}` entries square, sawtooth, pulse, beating, sine, triangle.
- `presetHarmonics(id='square',count=8)` → terms `{amplitude,frequency,phase}`. Frequency is a multiplier of the base angular phase; non-integer 0.9 supported.
- `evaluateHarmonics(terms,phase)` → number `Σ A sin(frequency*phase+phaseOffset)`.
- `buildEpicycleState(terms,phase)` → `{endpoint:[x,y],vectors:[{center:[x,y],endpoint:[x,y],radius,angle,frequency}]}`. y endpoint equals evaluateHarmonics exactly within FP tolerance.
- `audioDescriptorForHarmonics(terms,{pitch=110,volume=0.12,sampleRate=48000}={})` → `{terms,pitch,volume,normalization,droppedTerms}`. Normalize amplitude for hearing safety, drop above-Nyquist terms, report it. Preserve equation phase and fractional frequencies.
- `synthesizeAudio(descriptor,count=2048,startSample=0)` → Float32Array; deterministic formula at seconds=sample/sampleRate.
- `createAudioController()` → `{start(terms,options):Promise, update(terms,options):void, stop():void, suspend():Promise, destroy():Promise, get playing(), get supported()}`. User gesture only, mute on hidden/mode leave. Browser rendering worklet is allowed as a local module. No pitch/value sonification substitution: synthesize the actual summed equations. Timbre is controlled by edited harmonics and preset/count.

## Frontend

Owns `src/app.js`, `index.html`, `styles.css`, `src/studio-renderer.js` (new), `src/simulation-worker.js` (new). Keep original `src/renderer.js` API unchanged for benchmark compatibility. Modes atlas, unwrap, fourier, spirograph, pendulum, live (old live.js signals retained). Shared controls theme-select, snapshot-button, playback-button, speed-control, persistence-control, glow-control. Preserve family-select, discovery-select, parameter-controls, regenerate-button, trace-canvas for smoke compatibility. Canvas scenes invoke functions above. Heavy atlas simulations/metrics go to worker, not animation frame. Do not update DOM per animation frame: telemetry at <=5 Hz. Adaptive draw budget and DPR cap. Pausing/visibility must mute audio. Per-scene explanatory text must distinguish dimensionless visual phase from audio pitch/time.

## Parallel ownership

- Dynamics/verification agent: `src/systems.js`, `scripts/validate.mjs`, `docs/NUMERICS.md` only.
- Geometry/physics agent: `src/art-modes.js`, `scripts/art-test.mjs`, `docs/GEOMETRY.md` only.
- Audio agent: `src/audio.js`, `src/audio-worklet.js`, `scripts/audio-test.mjs`, `docs/AUDIO.md` only.
- Metrics agent: `src/metrics.js`, `scripts/adversarial.mjs`, `docs/SCORING.md` only (generated adversarial artifacts permitted).
- Frontend agent: files named above only.
- Driver: explorer, CLI integration, remaining docs, gates, git, verification.
