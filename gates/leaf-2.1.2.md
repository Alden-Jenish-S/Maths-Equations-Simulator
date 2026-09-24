# Gates: Generalized art modes

Scope: generalized curve unwrapping, Fourier epicycles/audio descriptors, spirographs, and double pendulum.

- [x] G1: Seventeen curve families sample finite points and synchronized channels.
  CHECK: node scripts/validate.mjs
  EXPECT: /curves=17/
  EVIDENCE: VALIDATION_PASS systems=9 finite_reference=9 curves=17 convergence=lorenz:15.20,duffing:16.04,aizawa:16.04,rossler:16.39,thomas:16.09

- [x] G2: Harmonic presets, epicycles, and physics generators pass deterministic checks.
  CHECK: npm run live-test
  EXPECT: /audio=ok epicycles=ok physics=ok/
  EVIDENCE: AUDIO_TEST_PASS audio=ok epicycles=ok | LIVE_TEST_PASS systems=5 samples_per_system=2400 determinism=ok resume=ok history=ok guards=ok curves=17 audio=ok epicycles=ok physics=ok
