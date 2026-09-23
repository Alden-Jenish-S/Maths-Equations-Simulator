# Discovery methodology

## Scope and implementation sources

The atlas performs an exploratory parameter search over nine deterministic dynamical-system families. Its score measures properties of a finite, projected trajectory. A retained image is a candidate for further investigation, not evidence that a new attractor or a chaotic regime has been established.

The executable definitions are in `src/systems.js`; observation policies, analysis scales and selection are in `src/explorer.js`; diagnostic definitions and weights are in `src/metrics.js`. Fingerprinting and canonical JSON are implemented in `src/fingerprint.js`. The run-specific evidence is `data/discoveries.json` and `data/exploration-report.md`, generated together by `scripts/explore.mjs`.

## Nine equation families

For maps, primes mean the next iteration; for ODEs, dots mean derivatives with respect to model time. These are the equations implemented in `src/systems.js`.

| Family | Equations | Output coordinates |
| --- | --- | --- |
| Hénon | x′ = 1 − a x² + y; y′ = b x | x, y |
| Lorenz | ẋ = σ(y − x); ẏ = x(ρ − z) − y; ż = xy − βz | x, y, z |
| Forced Duffing | ẋ = v; v̇ = −δv − αx − βx³ + γ cos(ωt); ṫ = 1 | x, v; t is integrated internally |
| Ikeda | θ = 0.4 − 6/(1 + x² + y²); x′ = 1 + u(x cos θ − y sin θ); y′ = u(x sin θ + y cos θ) | x, y |
| Clifford | x′ = sin(a y) + c cos(a x); y′ = sin(b x) + d cos(b y) | x, y |
| De Jong | x′ = sin(a y) − cos(b x); y′ = sin(c x) − cos(d y) | x, y |
| Aizawa | ẋ = (z−b)x−dy; ẏ = dx+(z−b)y; ż = c+az−z³/3−(x²+y²)(1+ez)+fzx³ | x, y, z |
| Rössler | ẋ = −y−z; ẏ = x+ay; ż = b+z(x−c) | x, y, z |
| Thomas | ẋ = sin(y)−bx; ẏ = sin(z)−by; ż = sin(x)−bz | x, y, z |

Maps use direct iteration. ODEs use fixed-step classical RK4 with JavaScript binary64 numbers. Escape checks stop at the first non-finite or over-radius state; points are not clipped into a bounded-looking trace. See `docs/NUMERICS.md` for the simulator's validation and coordinate conventions.

## Search and observation policy

1. Families are validated, deduplicated and sorted by UTF-16 lexical order, independently of the host locale.
2. For a budget of N attempts per family, `max(1, floor(0.7N))` are coarse samples, capped at N. Coarse index zero uses the full-precision reference parameters (including Lorenz β = 8/3 and Thomas b = 0.208186). Other coarse samples use seeded, dimension-specific offsets into Halton sequences with prime bases.
3. The three highest-scoring coarse attempts, or all attempts if fewer than three exist, become local anchors. The remaining budget is distributed round-robin over those anchors. Each local parameter perturbation has a total normalized width of 0.16 (up to ±0.08), clamped to the declared box. There is one local stage, not a second 0.06 stage. Parameter generation rounds sampled proposals to four decimal places for schema steps below 0.01, otherwise three; this happens **before** simulation. Reference values are never rounded.
4. Each candidate gets a resolved, persisted config before simulation: seed, burn-in, steps, initial state, escape radius, integrator, applicable dt, coordinate scale and periodicity-lag limit. Parameter keys are sorted before simulation. The simulator's legacy Ikeda u clamp is applied before hashing. All finite binary64 parameter/config values are retained exactly.
5. All attempts are scored and recorded. Coarse ordering is score descending, family then identity lexically, and finally stage/index for duplicate identities. Local anchors and their IDs are recorded separately as search provenance.

The following are the **search** observation windows; full simulator defaults can be longer. ODE durations are model-time units, not seconds. Map durations are iteration counts. The first retained point follows burnIn+1 updates; the interval between first and last retained points is (steps−1)dt, while the table's observation duration is steps×dt.

| Family | Burn-in updates | Saved updates | dt | Burn-in duration | Observation duration | Fixed x-y scale | Hard radius |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Hénon | 500 | 4200 | n/a | 500 iterations | 4200 iterations | 2.2, 2.2 | 30 |
| Lorenz | 900 | 4500 | 0.01 | 9 | 45 | 30, 30 | 120 |
| Duffing | 1300 | 7000 | 0.02 | 26 | 140 | 3.5, 3.5 | 80 |
| Ikeda | 700 | 4200 | n/a | 700 iterations | 4200 iterations | 8, 8 | 160 |
| Clifford | 800 | 4200 | n/a | 800 iterations | 4200 iterations | 3, 3 | 10 |
| De Jong | 800 | 4200 | n/a | 800 iterations | 4200 iterations | 2.2, 2.2 | 10 |
| Aizawa | 1200 | 5200 | 0.01 | 12 | 52 | 2.2, 2.2 | 20 |
| Rössler | 1400 | 5200 | 0.01 | 14 | 52 | 20, 20 | 160 |
| Thomas | 1400 | 5200 | 0.02 | 28 | 104 | 5, 5 | 20 |

Initial states are [0.1, 0.1] for Hénon, Clifford and De Jong; [0, 0] for Ikeda; and [0.1, 0, 0] for ODEs. For Duffing the third coordinate is initial forcing time, not z. Every audit record stores the actual initial state and config, so future default changes cannot silently alter a replay.

## Analysis and retention

Analysis uses the unclipped first-two-coordinate projection, divided by the fixed family scales above. Spatial ODEs retain z in their raw output, but z does not contribute directly to the current geometric score. The metrics module examines at most the last 12,000 post-burn-in points. Search windows in this table are shorter than that limit. It uses occupancy/entropy grids of sizes 8, 12, 16, 24, 32 and 48, a 24×24 spectrum, a maximum lag of 48, and finite/escape, collapse, noise-prediction, growth and tail-drift diagnostics. Full formulas and their interpretation are in `docs/SCORING.md` and `src/metrics.js`.

Eligibility requires a positive score and a class other than `divergent`. The metric implementation gives zero score to incomplete or fewer-than-512-point outputs. Other classes, including transient and bounded-low-complexity, can be eligible; the family reservation does not certify that every winner is structured.

Selection first reserves the best eligible unique identity from each family, in lexical family order. Remaining slots maximize

`0.8 × (intrinsic score / 100) + 0.2 × novelty`.

Novelty is `clamp(min_distance / 0.35, 0, 1)`. Pair distance is `0.8 × featureDistance + 0.2 × parameterOrFamilyDistance`. The feature distance is the root-mean-square difference of the ten common diagnostics in `featureVector`. Parameter distance is the root-mean-square difference of normalized parameters **only within the same family**, with keys sorted consistently. Different families have a parameter-or-family distance of exactly 1, regardless of vector length. This prevents undefined cross-family coordinates and NaN selection scores. Same-family malformed vectors are rejected.

Duplicate numerical identities occupy at most one slot. Ties use lexical identity ordering, never `localeCompare`. The final displayed ranking is by intrinsic score descending and identity; stored novelty/finalSelectionScore describe the moment of selection, not novelty recomputed after sorting.

## Audit and full trajectories

Schema version 3 contains:

- `candidateAudit`: every attempted candidate's full parameters, normalized parameter vector, resolved config, equations, metadata, metrics, classification, identity, component fingerprints, search provenance, eligibility, retained flag and rejection reason. Repeated attempts are still separate audit entries.
- `discoveries`: retained records, selection-score components, and **all** post-burn-in `points` and `rawPoints` returned by the simulator, in their original order. No 2,400-point truncation is applied.
- `search`: exact attempted/retained/rejected counts, ineligible counts, eligible-unselected counts, family statistics, observation durations, scales and budgets.
- `runtime`: environment information separated from numerical identity. The Node CLI records Node and V8 versions, OS platform/release and CPU architecture.

Trajectory arrays are released immediately after each attempt is scored and hashed. Only selected candidates are replayed to obtain complete persisted trajectories; their replay fingerprints must match. This keeps memory proportional to audit records plus retained trajectories instead of keeping every rejected trajectory. The audit contains a full raw-trajectory digest even for rejected attempts.

`--preview N` explicitly adds a separate uniform-index preview. It never replaces the source arrays and is unsuitable as scoring evidence. Burn-in states are not stored; they are reproducible from initial state and config. Duffing's `rawPoints` contain the complete x-v output contract rather than its internal clock; reproduce the clock through the same integrator.

Rejected means **not retained**, including both ineligible attempts and eligible attempts omitted by the diversity budget or deduplicated. The report provides those counts separately rather than calling all rejected attempts numerical failures. Null is used only for explicit absence (such as no detected period, no divergence index, no invalid-input reason, or no rejection reason); it never substitutes for a non-finite number.

## Exact serialization and identity

`canonicalSerialize` emits JSON with recursively sorted object keys and preserved array order. It uses JavaScript's shortest round-tripping spelling of each finite number, with explicit `-0`; it applies no decimal rounding. Unsupported values, sparse arrays, cycles and non-finite numbers throw instead of becoming missing values or `null`. Ordinary `JSON.stringify` is not the artifact writer because it loses signed zero and silently converts non-finite values to null.

The synchronous pure-JavaScript SHA-256 implementation needs no Node imports, WebCrypto, browser crypto globals or asynchronous operations. `scripts/repro-test.mjs` compares it with Node crypto, including Unicode, SHA padding boundaries and a million-character message, and executes it in an isolated context without Node/browser globals.

A candidate ID hashes schema/algorithm version, family, equation, exact parameters and resolved config (including seed). A candidate fingerprint additionally includes simulator metadata, complete metrics and a digest of **all** raw points. Component digests for parameters, config, metadata, metrics and rawPoints are also persisted. Search stage, index, anchor and selection score are separate provenance, so finding the same numerical candidate at another search index does not change its ID or fingerprint. The seed influences parameter proposals, not a stochastic simulator, but is deliberately part of identity.

Replay a parsed audit or discovery record with:

```js
import { getSystem } from "./src/systems.js";
import { evaluateCandidate } from "./src/explorer.js";

const replay = evaluateCandidate(getSystem(record.family), record.parameters, record.config);
if (replay.fingerprint !== record.fingerprint) throw new Error("Replay mismatch");
```

Bit-identical replay is tested on the same source version, JS engine/runtime and platform. The SHA-256 algorithm itself is portable, but `Math.sin`, `Math.cos`, `Math.exp`, `Math.log` and other transcendental functions can vary by engine/libm implementation. Small numerical differences can grow along sensitive trajectories and change metric bins or rankings. Cross-browser, cross-architecture or cross-runtime equality is not promised. Keep runtime details with the artifact, and bump the algorithm version when numerical or scoring definitions change. Exact hashes are regression identities, not proofs of scientific equivalence.

## Limitations and follow-up

Fixed finite windows cannot establish asymptotic boundedness, convergence to an attractor or chaos. A stable-looking phase portrait can be a transient, a periodic orbit or an integration artifact. Duffing observations are uniformly sampled phase clouds, not stroboscopic Poincaré sections. Projection, fixed scale, burn-in length, initial conditions, parameter boxes, proposal quantization and heuristic score weights all influence what gets selected. Halton coverage with seeded offsets and elite refinement is exploratory; it does not provide a probability sample or confidence intervals.

Follow-up work should use longer independent windows and initial conditions, ODE step-size refinement at matched physical durations, alternate projections/scales, validated tangent-space Lyapunov estimates, and held-out scoring evaluations. None of those is implied by `EXPLORE_PASS` or a high score.
