# Gates: Metrics and adversarial scoring

Scope: Quantitative classification and anti-gaming checks.

- [x] G1: Metric output includes occupancy, entropy, periodicity, symmetry, spectrum, stability, class, and score components.
  CHECK: node scripts/adversarial.mjs
  EXPECT: metrics=complete
  EVIDENCE: ADVERSARIAL_PASS metrics=complete penalty_cases=4 | reference_score=38.02 fixtures=6
- [x] G2: Adversarial candidates are reported and high-scoring visual fakes are penalized.
  CHECK: node scripts/adversarial.mjs
  EXPECT: penalty_cases=
  EVIDENCE: ADVERSARIAL_PASS metrics=complete penalty_cases=4 | reference_score=38.02 fixtures=6
