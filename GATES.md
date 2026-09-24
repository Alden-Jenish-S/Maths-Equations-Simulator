# Gates: Autonomous Multi-Modal Mathematical Art & Audio-Visual Simulation Platform

Scope: a deterministic, standalone mathematical-art atlas with generalized curve projection, epicycles/audio, physics modes, quantitative scoring, and a production browser surface.

- [x] G1: The atlas retains the four original families and includes Clifford, De Jong, Aizawa, Rössler, and Thomas with equations, parameter schemas, and bounded deterministic simulators.
  CHECK: npm run validate
  EXPECT: /VALIDATION_PASS systems=9/
  EVIDENCE: > node scripts/validate.mjs | VALIDATION_PASS systems=9 finite_reference=9 convergence=lorenz:15.20,duffing:16.04,aizawa:16.04,rossler:16.39,thomas:16.09

- [x] G2: Generalized curve sampling covers circular, conic, hyperbolic, superellipse, algebraic/polar, spiral, harmonic, spatial-knot, and complex-mapping families with finite projected/unwrapped channels.
  CHECK: node scripts/validate.mjs
  EXPECT: /curves=17/
  EVIDENCE: VALIDATION_PASS systems=9 finite_reference=9 curves=17 convergence=lorenz:15.20,duffing:16.04,aizawa:16.04,rossler:16.39,thomas:16.09

- [x] G3: Fourier presets, epicycle decomposition, and deterministic audio synthesis descriptors are implemented and tested without external dependencies.
  CHECK: npm run live-test
  EXPECT: /audio=ok epicycles=ok/
  EVIDENCE: AUDIO_TEST_PASS audio=ok epicycles=ok | LIVE_TEST_PASS systems=5 samples_per_system=2400 determinism=ok resume=ok history=ok guards=ok curves=17 audio=ok epicycles=ok physics=ok

- [x] G4: Spirograph/trochoid generation and a bounded Lagrangian double-pendulum solver expose trails and phase-space coordinates.
  CHECK: npm run live-test
  EXPECT: /physics=ok/
  EVIDENCE: AUDIO_TEST_PASS audio=ok epicycles=ok | LIVE_TEST_PASS systems=5 samples_per_system=2400 determinism=ok resume=ok history=ok guards=ok curves=17 audio=ok epicycles=ok physics=ok

- [x] G5: analyzeTrajectory includes multi-scale entropy, occupancy, periodicity/lag, spectral structure, symmetry, stability, and explicit divergence/collapse penalties that survive adversarial fixtures.
  CHECK: npm run adversarial
  EXPECT: /ADVERSARIAL_PASS/
  EVIDENCE: fixture=family-rossler expected=structured actual=structured score=58.99 | fixture=family-thomas expected=structured actual=structured score=54.49

- [x] G6: The browser provides responsive glass UI, five themes, projection and animation controls, glowing canvas rendering, snapshot export, and WebAudio interaction.
  CHECK: node scripts/smoke-server.mjs
  EXPECT: /SERVER_SMOKE_PASS status=200 assets=atlas/
  EVIDENCE: SERVER_SMOKE_PASS status=200 assets=atlas

- [x] G7: Fixed-seed exploration is byte-stable at the fingerprint level and writes complete discovery/report artifacts.
  CHECK: npm run explore -- --families all --samples 12 --top 12 --seed 424242
  EXPECT: /EXPLORE_PASS discoveries=12 families=9/
  EVIDENCE: 11. ikeda bounded-low-complexity score=34.18 fingerprint=sha256-e6fca48591a8edcdb3b2d3987c69e9a3e0e64c107dbe93b0cd4cf38298158800 | 12. rossler bounded-low-complexity score=23.33 fingerprint=sha256-815

- [x] G8: Required CLI validation, live, adversarial, benchmark, and composite tests pass inside the project Node runtime; the project .venv remains present.
  CHECK: npm test
  EXPECT: /ALL_TESTS_PASS/
  EVIDENCE: SERVER_SMOKE_PASS status=200 assets=atlas | ALL_TESTS_PASS

- [x] G9: Scientific documentation and generated data describe equations, integrators, metrics, reproducibility, and limitations.
  CHECK: node scripts/docs-check.mjs
  EXPECT: /DOCS_PASS/
  EVIDENCE: DOCS_PASS ui_controls=present
