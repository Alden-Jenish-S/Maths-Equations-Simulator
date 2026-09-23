# Gates: Expanded deterministic systems

Scope: retain the four foundation systems and add five bounded chaotic families with deterministic integrators.

- [x] G1: Nine systems expose descriptions and parameter schemas.
  CHECK: npm run validate
  EXPECT: /VALIDATION_PASS systems=9/
  EVIDENCE: > node scripts/validate.mjs | VALIDATION_PASS systems=9 finite_reference=9 convergence=lorenz:15.20,duffing:16.04,aizawa:16.04,rossler:16.39,thomas:16.09

- [x] G2: Reference trajectories are finite, deterministic, and bounded.
  CHECK: npm run validate
  EXPECT: /finite_reference=9/
  EVIDENCE: > node scripts/validate.mjs | VALIDATION_PASS systems=9 finite_reference=9 convergence=lorenz:15.20,duffing:16.04,aizawa:16.04,rossler:16.39,thomas:16.09
