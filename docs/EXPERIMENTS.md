# Experiments and decisions

## Reproducibility repair: schema 3

The inspected explorer had four concrete replay/audit defects:

1. Cross-family parameter novelty subtracted vectors of different lengths. Missing coordinates yielded NaN; the clamp also lacked default limits. JSON serialization could consequently persist a null novelty or selection score.
2. Simulation used full-precision values while persistence rounded them to eight decimal places. In particular, Lorenz β = 8/3 was not replayed with the same input.
3. The fingerprint rounded numbers to twelve significant digits and combined two non-cryptographic 32-bit hashes. Identity depended on search position and lacked a complete numerical configuration.
4. Retained trajectories were truncated to 2,400 points, and the candidate summary omitted rejected candidates' configs, metadata and full metrics. The previous sample-budget loop could also evaluate a different count than requested.

The replacement uses fixed cross-family distance, same-family-only parameter distance, exact pre-simulation inputs, canonical finite-only JSON, SHA-256 identities/digests, and separate search provenance. Each family now consumes exactly its requested attempt budget. `candidateAudit` includes every attempt; retained arrays are complete. Rejected arrays are hashed then released, and selected candidates are replayed and fingerprint-checked before persistence.

These are engineering regression corrections, not new evidence of chaotic dynamics or a comparison of scientific estimators. Equation definitions and observation policies are documented in `METHODOLOGY.md` and recorded in the generated report.

## Commands and bounded budgets

```sh
# Default: 12 discoveries, all nine families, 12 attempts per family, seed 424242.
node scripts/explore.mjs

# Explicit atlas command; writes only the two normal exploration artifacts.
node scripts/explore.mjs --families all --samples 12 --top 12 --seed 424242

# Short repeatability run: two six-attempt-per-family searches plus stored replay.
node scripts/repro-test.mjs

# A separate preview can be requested without losing source data.
node scripts/explore.mjs --families all --samples 12 --top 12 --seed 424242 --preview 600
```

`--samples` and `--top` accept integers 1–100; `--seed` accepts unsigned integers 0–4294967295. `--preview` accepts 0–10000, with zero meaning no preview. Top must be at least the number of selected families and cannot exceed their total attempted-candidate budget. Thus `--families all --top 8` is invalid for the nine-family atlas; use at least 9, with 12 the default. Family IDs are validated, deduplicated and lexically sorted. Unknown flags/families, empty tokens, duplicate flags, missing values, fractional/non-finite numbers and out-of-range values fail before simulation or artifact writes.

The CLI reports the **represented** family count, and only prints `EXPLORE_PASS` when both the requested discovery count and family coverage are achieved. Some small budgets or seeds may lack enough eligible unique candidates; an insufficient run fails explicitly rather than claiming coverage. The API retains its complete accounting even when fewer candidates are selectable.

## Acceptance checks and evidence

The focused test is `scripts/repro-test.mjs`. It writes no artifacts. Its executable assertions cover:

- [x] Pure-JS SHA-256 matches Node crypto and runs without Node/browser globals; canonical JSON round-trips finite binary64 values including signed zero, subnormals and adjacent doubles.
- [x] Two fixed-seed six-attempt searches produce identical complete JSON and ordered discovery/audit fingerprints, including when input family order is reversed/deduplicated and localeCompare is disabled.
- [x] Parsed stored discovery records and all nine reference audit records replay to identical fingerprints; all nine complete simulator defaults also survive stored-JSON replay.
- [x] Changed dt, seed, analysis scale, lag limit and algorithm identity change the corresponding identities/fingerprints; key order and search position do not.
- [x] All numeric fields are finite, selected novelty is numeric, rejected audits have no trajectory arrays, retained raw arrays are complete, and separate previews preserve them.
- [x] CLI parsing rejects invalid bounded inputs and the generated report includes every equation and transparent rejection accounting.

Evidence: `node scripts/repro-test.mjs` → `REPRO_PASS sha256_vectors=15 fixed_json=identical ordered_fingerprints=12 defaults_replayed=9 families=9 candidates=54`.

Run-specific pass output and environment details are printed by the test. The two normal CLI artifacts are deterministic for the same code/runtime/platform; they contain no wall-clock timestamp or benchmark timing. The artifact digest in `REPRO_PASS` describes the six-attempt in-memory regression run, not necessarily the twelve-attempt CLI artifact.

## Scientific reporting and interpretation

`data/exploration-report.md` includes all selected-family equations, exact evaluated/retained/rejected counts, ineligible versus eligible-unselected counts, per-family accounting, observation and burn-in durations, dt, fixed scales, retained parameters/classes/scores, runtime details and reproduction commands. `data/discoveries.json` adds all candidate configs, metrics, metadata and fingerprints, plus complete retained trajectories. Report scores are formatted for reading; artifact values remain full precision.

Parameter-box exploration and deterministic elite refinement are an improvement in auditability over displaying a single hand-selected preset. They do not make the search exhaustive. Family reservations explicitly trade score optimality for coverage and can select low-complexity candidates.

The score combines multiple diagnostics to avoid relying on occupancy, entropy, recurrence or symmetry alone. These isolated criteria can favor filled regions, fixed points, narrow cycles or noise. Candidate-specific min/max normalization can hide escape; fixed family scales avoid that particular failure while introducing their own scale dependence. Actual adversarial validation is in `scripts/adversarial.mjs` and its report; this document does not invent an ablation effect size or claim a held-out chaos test.

Exact fingerprint agreement checks byte-level numerical reproducibility on the recorded runtime/platform. Cross-engine or libm variation can change transcendental results and sensitive trajectories; hashes may then disagree even when qualitative geometry is similar. A match does not establish physical correctness, and a mismatch alone does not establish a different dynamical regime.

## Other project experiments

| Experiment | Command | Evidence |
| --- | --- | --- |
| Nine-family numerical references and step refinement | `node scripts/validate.mjs` | stdout validation gate |
| Adversarial scorer fixtures | `node scripts/adversarial.mjs` | `data/adversarial-report.*` |
| Full atlas and candidate audit | `node scripts/explore.mjs --families all --samples 12 --top 12 --seed 424242` | `data/discoveries.json`, `data/exploration-report.md` |
| Repeatability, exact stored replay and finite serialization | `node scripts/repro-test.mjs` | `REPRO_PASS` and runtime description |
| Display decimation benchmark | `node scripts/benchmark.mjs` | stdout benchmark gate |
| Server/browser asset smoke | `node scripts/smoke-server.mjs` | stdout smoke gate |
| Live-source validation | `node scripts/live-test.mjs` | stdout live gate |

Live mode has separate deterministic sources and bounded display buffers. Its visual decimation and streaming behavior do not define the exploration artifact's scientific sample count. Likewise, a browser display that increases the simulation step count or changes projection is a new visualization, not an exact replay of the stored metrics.

## Follow-up experiments

Longer burn-in/observation windows, matched-duration dt/2 studies, independent initial states and seeds, alternate projections, tangent-space Lyapunov estimates and held-out metric tuning are needed to investigate robustness. Those are future experiments; current finite-window labels and `EXPLORE_PASS` do not prove chaos or an asymptotic attractor.
