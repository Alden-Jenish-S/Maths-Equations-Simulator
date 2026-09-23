# Plan: Autonomous Multi-Modal Mathematical Art & Audio-Visual Simulation Platform

Depth: tree 4   Mode: orchestrated
Budget note: independent numerical, geometry/audio, metrics, frontend, and verification tracks followed by an integration pass and full reproducibility checks.

## Contract

- **Runtime:** dependency-free vanilla ES modules; Node 20+; browser Web APIs only. `.venv` is preserved for isolated auxiliary verification and must never receive committed secrets.
- **System interface:** `SYSTEMS` entries expose `{ id, name, equation, description, kind, parameters, defaults, defaultConfig, simulate(params, config) }`. Simulations return `{ points, rawPoints, metadata }`, with explicit `bounded`, `diverged`, `divergedAt`, and finite-count metadata.
- **Curve interface:** `CURVES` entries expose `{ id, name, equation, family, parameters, defaults, sample(params, t), unwrap(params, t) }`; `sampleCurve(id, params, count)` returns points and synchronized channel arrays.
- **Audio/epicycle interface:** presets expose harmonic terms `{ amplitude, frequency, phase }`; `evaluateHarmonics`, `buildEpicycleState`, and `audioDescriptorForHarmonics` are deterministic and browser audio is optional.
- **Physics interface:** `generateSpirograph`, `createDoublePendulum`, and `stepDoublePendulum` return finite geometry with bounded safeguards.
- **Candidate interface:** existing discovery schema remains compatible; candidate fingerprints are canonical strings derived from seed, family, parameters, metadata, and metrics.
- **Data ownership:** dynamics in `src/systems.js`; curves/audio/physics in `src/art-modes.js`; metrics in `src/metrics.js`; search in `src/explorer.js`; renderer and browser integration in `src/renderer.js`, `src/app.js`, `index.html`, `styles.css`; CLI/tests in `scripts/`; artifacts in `data/`; docs in `docs/`.
- **Naming:** camelCase JavaScript, kebab-case ids, Unicode equations allowed in user-facing strings, no hidden randomness, every generated file records its seed/config.

## Tree

- 1 Platform
  - 1.1 Mathematical foundation ........ `gates/node-2.1.md`
    - 1.1.1 Expanded deterministic systems ........ `gates/leaf-2.1.1.md`
    - 1.1.2 Generalized geometry, epicycles, audio, physics ........ `gates/leaf-2.1.2.md`
  - 1.2 Trustworthy discovery and telemetry ........ `gates/node-2.2.md`
    - 1.2.1 Adversarial metric audit ........ `gates/leaf-2.2.1.md`
    - 1.2.2 Reproducible CLI artifacts and docs ........ `gates/leaf-2.2.2.md`
  - 1.3 Interactive product ........ `gates/node-2.3.md`
    - 1.3.1 Frontend, themes, animation, audio UX ........ `gates/leaf-2.3.1.md`
    - 1.3.2 Performance, smoke, and integration verification ........ `gates/leaf-2.3.2.md`

## Status log

- 2026-09-23: expanded acceptance ledger and interface contract written before fan-out.
- 2026-09-23: four independent read-only audits complete. Implementation contracts and exclusive file ownership recorded in `docs/IMPLEMENTATION-CONTRACT.md`; discovered initial repository is uncommitted, and `.venv`/sample videos will be excluded from commits.
