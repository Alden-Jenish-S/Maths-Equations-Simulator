# Gates: metrics hardening

Scope: `src/metrics.js`, `scripts/adversarial.mjs`, `docs/SCORING.md`, and generated `data/adversarial-*` only. This generated ledger lives here to respect the metrics ownership contract.

- [x] G1: Every named fixture asserts its own policy; recursive finite/range, deterministic repeat, interface, and multiscale checks pass.
  CHECK: node scripts/adversarial.mjs
  EXPECT: ADVERSARIAL_PASS
  EVIDENCE: `ADVERSARIAL_PASS metrics=complete fixtures=24 dft=separable`

- [x] G2: Canonical Hénon remains structured; each new-family reference has a meaningful positive score; translated rings and noise cannot outrank the reference.
  EVIDENCE: `reference_score=38.37 reference_class=structured`; family scores 37.18–72.54; translated-circle=0.00; noisy-square=14.69.

- [x] G3: Independent DFT reference agrees with the separable implementation; overflow, malformed input, metadata, missing samples, and tail-collapse attacks are individually checked.
  EVIDENCE: adversarial output includes `dft=separable`; fixtures `finite-overflow`, `one-percent-nan`, `metadata-divergence`, `short-missing`, and `rich-then-fixed` each pass their own assertions.

- [x] G4: Scoring documentation matches implemented policies, thresholds, interface, performance bounds, and heuristic limitations; changes stay within ownership.
  EVIDENCE: `docs/SCORING.md` documents the six scales, total-input behavior, O(n^3) DFT, classes, and limitations; `npm test` ended with `ALL_TESTS_PASS`.
