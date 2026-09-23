# Gates: Discovery collection and reports

Scope: Generated JSON and markdown reports contain equations, parameters, metrics, and configs.

- [x] G1: Discovery artifacts are generated with reproducibility metadata.
  CHECK: node scripts/explore.mjs --families all --samples 24 --top 8 --seed 424242
  EXPECT: artifacts=data/discoveries.json,data/exploration-report.md
  EVIDENCE: 7. henon structured score=37.90 id=henon-0-0-35ebfaee | 8. ikeda structured score=37.59 id=ikeda-0-2-b6a2788f
