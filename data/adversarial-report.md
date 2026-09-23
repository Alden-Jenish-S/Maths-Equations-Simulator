# Adversarial evaluation

Reference Hénon score: 38.37 (structured)
Scale diagnostics: 8, 12, 16, 24, 32, 48 cells per side

| Fixture | Expected | Actual | Naive | Final | Key penalties |
| --- | --- | --- | ---: | ---: | ---: |
| canonical-henon | structured | structured | 73.3 | 38.37 | 0.51 |
| fixed-point | trivial | trivial | 40.2 | 0.00 | 1.00 |
| translated-circle | trivial | trivial | 61.6 | 0.00 | 1.05 |
| noisy-square | bounded-low-complexity | bounded-low-complexity | 100.0 | 14.69 | 0.06 |
| thin-line | trivial | trivial | 54.1 | 0.57 | 1.30 |
| clipped-divergence | divergent | divergent | 42.6 | 0.00 | 2.54 |
| one-percent-nan | divergent | divergent | 61.6 | 0.00 | 2.05 |
| nonfinite-final | divergent | divergent | 61.6 | 0.00 | 2.05 |
| finite-overflow | divergent | divergent | 40.2 | 0.00 | 3.00 |
| short-missing | transient | transient | 61.6 | 0.00 | 2.05 |
| requested-count-underflow | trivial | trivial | 61.6 | 0.00 | 1.05 |
| metadata-divergence | divergent | divergent | 61.6 | 0.00 | 2.05 |
| rich-then-fixed | transient | transient | 68.4 | 0.00 | 1.50 |
| invalid-scale-zero | divergent | divergent | 61.6 | 0.00 | 1.00 |
| invalid-scale-nan | divergent | divergent | 61.6 | 0.00 | 1.00 |
| empty | divergent | divergent | 0.0 | 0.00 | 3.00 |
| family-lorenz | structured | structured | 100.0 | 37.18 | 0.55 |
| family-duffing | structured | structured | 100.0 | 39.76 | 0.42 |
| family-ikeda | structured | structured | 100.0 | 48.61 | 0.32 |
| family-clifford | structured | structured | 100.0 | 68.00 | 0.13 |
| family-dejong | structured | structured | 100.0 | 52.37 | 0.34 |
| family-aizawa | structured | structured | 100.0 | 72.54 | 0.01 |
| family-rossler | structured | structured | 100.0 | 58.99 | 0.21 |
| family-thomas | structured | structured | 100.0 | 54.49 | 0.11 |

Every fixture performs its own class/score policy assertion; aggregate pass counts are not used as a substitute.

## Limitations

These are deterministic heuristics, not proofs of chaos, fractal dimension, or Lyapunov exponents. A bounded structure outside its declared coordinate scale can score poorly, while a novel structure can resemble a protected collapse family. Metadata divergence is trusted as an explicit simulator contract signal; unlabeled domain-specific failure modes remain the simulator's responsibility.
