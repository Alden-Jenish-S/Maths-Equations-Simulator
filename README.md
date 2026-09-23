# Trace Explorer Studio

Trace Explorer is a dependency-light browser application and deterministic Node.js research pipeline for discovering visually interesting, bounded structures in parameterized dynamical systems. It intentionally treats a good picture as a hypothesis, not proof: every retained trace has a parameter configuration, numerical method, tail metrics, classification, and an adversarial score review.

## What is included

- Nine deterministic dynamical families: Hénon, Lorenz, forced Duffing, Ikeda, Clifford, De Jong, Aizawa, Rössler, and Thomas.
- Fixed-step RK4 for continuous-time systems and direct iteration for maps.
- Halton parameter coverage followed by deterministic elite-local refinement.
- Multi-signal scoring: boundedness, occupancy, entropy, recurrence, symmetry, frequency structure, covariance collapse, tail drift, and scale consistency.
- Adversarial fixtures for fixed points, circles, noisy squares, thin lines, clipped divergence, and short transients.
- An interactive responsive observatory with attractor atlas, generalized curve unwrapping, synchronized projection channels, Fourier epicycles, exact WebAudio synthesis, spirographs, double-pendulum phase portraits, five palettes, glow/trail controls, and high-resolution PNG export.
- Generated reproducibility artifacts in `data/`, including complete retained trajectories, candidate audits, canonical JSON, SHA-256 fingerprints, and scientific reports.

## Run it

Requirements: Node.js 20 or newer. There are no npm dependencies and no build step.

```sh
npm test
npm start
```

Then open <http://127.0.0.1:4173>. Audio is opt-in and requires a user gesture in a browser that supports AudioWorklet. To refresh the atlas with a different deterministic search:

```sh
node scripts/explore.mjs --families all --samples 12 --top 12 --seed 424242
```

The explorer writes `data/discoveries.json` and `data/exploration-report.md`. The adversarial review writes `data/adversarial-report.json` and `data/adversarial-report.md`.

## Reproduce and inspect

```sh
node scripts/validate.mjs
node scripts/adversarial.mjs
node scripts/art-test.mjs
node scripts/audio-test.mjs
node scripts/ui-test.mjs
node scripts/repro-test.mjs
node scripts/benchmark.mjs
node scripts/smoke-server.mjs
```

The exact algorithm, equations, numerical checks, scoring limits, failed approaches, audio/geometry caveats, and known limitations are documented in `docs/`. `GATES.md` is the machine-checkable acceptance ledger for this project.

## Scientific scope

The ranking score is a discovery heuristic. “Structured” means the output is bounded, has non-trivial spatial and temporal signals, survives the current anti-collapse checks, and lies above the current threshold. It does not establish a mathematical proof of chaos or fractality. Positive Lyapunov behaviour, invariant-measure estimates, and box-counting dimension are useful follow-up analyses, not hidden claims in the current score.
