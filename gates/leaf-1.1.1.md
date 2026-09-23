# Gates: Systems and numerical validation

Scope: Four implemented dynamical-system families with stable numerical methods.

- [x] G1: Systems export equations, schemas, and simulations for Henon, Lorenz, Duffing, and Ikeda.
  CHECK: node scripts/validate.mjs
  EXPECT: systems=4
  EVIDENCE: VALIDATION_PASS systems=4 finite_reference=4
- [x] G2: Reference simulations remain finite for bounded regimes and mark unstable regimes.
  CHECK: node scripts/validate.mjs
  EXPECT: finite_reference=4
  EVIDENCE: VALIDATION_PASS systems=4 finite_reference=4
