# Gates: Mathematical systems branch

- [x] G1: Child system and scoring gates pass.
  CHECK: node scripts/validate.mjs && node scripts/adversarial.mjs
  EXPECT: VALIDATION_PASS
  EVIDENCE: ADVERSARIAL_PASS metrics=complete penalty_cases=4 | reference_score=38.02 fixtures=6
