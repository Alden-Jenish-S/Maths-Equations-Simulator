# Gates: Exploration branch

- [x] G1: Deterministic exploration and collection artifacts pass.
  CHECK: node scripts/explore.mjs --families all --samples 24 --top 8 --seed 424242
  EXPECT: EXPLORE_PASS discoveries=8
  EVIDENCE: 7. henon structured score=37.90 id=henon-0-0-35ebfaee | 8. ikeda structured score=37.59 id=ikeda-0-2-b6a2788f
