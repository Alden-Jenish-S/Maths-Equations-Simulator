# Exploration report

- Seed: `424242`
- Families: aizawa, clifford, dejong, duffing, henon, ikeda, lorenz, rossler, thomas
- Evaluated candidates: 108
- Retained discoveries: 12
- Rejected attempts: 96 (13 ineligible; 83 eligible but not selected or duplicate)
- Requested candidates per family: 12 (including each reference parameter set)
- Algorithm: atlas-2026-09-repro-v3
- Runtime/platform: `{"architecture":"arm64","engine":"V8","engineVersion":"13.6.233.17-node.37","osRelease":"25.6.0","platform":"darwin","runtime":"Node.js","version":"v24.12.0"}`
- Search: Halton coverage + deterministic elite-local refinement + diversity retention

## Equations and observation windows

Primes in map equations denote the next iteration; dots denote derivatives in model-time units. ODE observations are uniformly sampled phase trajectories, not Poincaré sections. Durations below are requested; a diverging attempt can terminate early, as recorded in its metadata.

| Family | Equation | Integrator | Burn-in steps / duration | Retained steps / duration | dt | Analysis scale (x, y) |
| --- | --- | --- | --- | --- | --- | --- |
| Aizawa attractor | ẋ=(z−b)x−dy; ẏ=dx+(z−b)y; ż=c+az−z³/3−(x²+y²)(1+ez)+fzx³ | fixed-step-rk4 | 1200 / 12 model-time units | 5200 / 52 model-time units | 0.01 | 2.2, 2.2 |
| Clifford attractor | x′ = sin(a y) + c cos(a x);  y′ = sin(b x) + d cos(b y) | direct-map | 800 / 800 iterations | 4200 / 4200 iterations | not applicable | 3, 3 |
| De Jong attractor | x′ = sin(a y) − cos(b x);  y′ = sin(c x) − cos(d y) | direct-map | 800 / 800 iterations | 4200 / 4200 iterations | not applicable | 2.2, 2.2 |
| Forced Duffing oscillator | ẍ + δẋ + αx + βx³ = γ cos(ωt) | fixed-step-rk4 | 1300 / 26 model-time units | 7000 / 140 model-time units | 0.02 | 3.5, 3.5 |
| Hénon map | x′ = 1 − a x² + y;  y′ = b x | direct-map | 500 / 500 iterations | 4200 / 4200 iterations | not applicable | 2.2, 2.2 |
| Ikeda map | t = 0.4 − 6/(1 + r²);  z′ = 1 + u z e^{it} | direct-map | 700 / 700 iterations | 4200 / 4200 iterations | not applicable | 8, 8 |
| Lorenz flow | ẋ = σ(y − x); ẏ = x(ρ − z) − y; ż = xy − βz | fixed-step-rk4 | 900 / 9 model-time units | 4500 / 45 model-time units | 0.01 | 30, 30 |
| Rössler attractor | ẋ=−y−z; ẏ=x+ay; ż=b+z(x−c) | fixed-step-rk4 | 1400 / 14 model-time units | 5200 / 52 model-time units | 0.01 | 20, 20 |
| Thomas cyclic attractor | ẋ=sin(y)−bx; ẏ=sin(z)−by; ż=sin(x)−bz | fixed-step-rk4 | 1400 / 28 model-time units | 5200 / 104 model-time units | 0.02 | 5, 5 |

## Candidate accounting

| Family | Evaluated | Ineligible | Eligible unselected / duplicate | Retained | Total rejected |
| --- | ---: | ---: | ---: | ---: | ---: |
| aizawa | 12 | 0 | 8 | 4 | 8 |
| clifford | 12 | 3 | 8 | 1 | 11 |
| dejong | 12 | 1 | 10 | 1 | 11 |
| duffing | 12 | 0 | 11 | 1 | 11 |
| henon | 12 | 6 | 5 | 1 | 11 |
| ikeda | 12 | 1 | 10 | 1 | 11 |
| lorenz | 12 | 0 | 11 | 1 | 11 |
| rossler | 12 | 2 | 9 | 1 | 11 |
| thomas | 12 | 0 | 11 | 1 | 11 |

## Retained structures

| Rank | Family | Class | Score | Parameters |
| ---: | --- | --- | ---: | --- |
| 1 | Aizawa attractor | structured | 81.13 | a=0.9178, b=0.8199, c=0.5024, d=3.6603, e=0.1113, f=0.0763 |
| 2 | Aizawa attractor | structured | 79.95 | a=0.9355, b=0.8258, c=0.5065, d=3.5864, e=0.1103, f=0.0771 |
| 3 | Aizawa attractor | structured | 79.01 | a=0.9651, b=0.7184, c=0.6197, d=3.59, e=0.2528, f=0.0948 |
| 4 | Clifford attractor | structured | 72.63 | a=-1.4, b=1.6, c=1, d=0.7 |
| 5 | Forced Duffing oscillator | structured | 71.79 | alpha=0.9844, beta=1.9374, delta=0.0601, gamma=1.7418, omega=0.8546 |
| 6 | Aizawa attractor | structured | 70.45 | a=0.8586, b=0.6121, c=0.7597, d=3.2172, e=0.2893, f=0.0708 |
| 7 | De Jong attractor | structured | 61.07 | a=-1.166, b=1.0082, c=2.4835, d=-2.2278 |
| 8 | Thomas cyclic attractor | structured | 57.70 | b=0.208186 |
| 9 | Lorenz flow | structured | 40.69 | beta=2.3449, rho=44.793, sigma=15.239 |
| 10 | Hénon map | structured | 38.25 | a=1.4, b=0.3 |
| 11 | Ikeda map | bounded-low-complexity | 34.18 | u=0.7838 |
| 12 | Rössler attractor | bounded-low-complexity | 23.33 | a=0.3206, b=0.3551, c=5.072 |

## Reproduction

```sh
node scripts/explore.mjs --families aizawa,clifford,dejong,duffing,henon,ikeda,lorenz,rossler,thomas --samples 12 --top 12 --seed 424242 --preview 0
node scripts/repro-test.mjs
```

`data/discoveries.json` contains the complete candidateAudit (all attempted parameters, resolved configs, metrics, metadata, provenance, component SHA-256 digests and rejection reasons). Every retained discovery has full post-burn-in points and rawPoints; previews, if requested, are separate. Rejected trajectories are released after hashing and can be regenerated from their audit records.

Replay a stored record with evaluateCandidate(getSystem(record.family), record.parameters, record.config); search stage/index are not part of numerical identity. Seed, algorithm version, equations, parameters, config, metadata, metrics, and a full raw-trajectory digest determine the candidate fingerprint. Key insertion order has no effect; no number is rounded during canonical serialization.

## Interpretation and limitations

This is an exploratory heuristic ranking of finite, projected trajectories. Family reservations can retain low-complexity or transient candidates with positive scores; the table reports their actual classes. Rejection can mean either invalid dynamics or a limited diversity budget. Neither a high score nor a bounded finite observation proves chaos, an attractor, asymptotic boundedness, or convergence of the integrator. No Lyapunov exponent or independent uncertainty estimate is computed here.

Analysis uses the unclipped x-y projection with fixed family scales, multiple occupancy grids, and maxPeriod=48. Spatial ODE rawPoints retain z; Duffing rawPoints contain x and velocity, with forcing time reconstructed from the persisted initial state and dt. Short burn-in, finite durations, projection, chosen scales, and parameter-box/score tuning can bias this ranking. Longer observations, step refinement, alternate projections and independent parameter/initial-state searches are needed to test robustness.

Exact SHA-256 agreement is a regression/replay check on the same source version, JS runtime/engine and platform. SHA-256 itself is portable and checked against Node crypto. Transcendental Math functions (libm/engine variation), floating-point sensitivity and long chaotic trajectories can differ across browsers, CPU architectures or runtime versions; matching seeds do not guarantee cross-platform bit identity. Runtime details are stored separately from numerical fingerprints. The JSON uses deterministic key ordering and contains no wall-clock timestamp or measured run time.
