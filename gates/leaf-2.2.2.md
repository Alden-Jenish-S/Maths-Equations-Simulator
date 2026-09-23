# Gates: Reproducible artifacts and scientific docs

Scope: deterministic discovery fingerprints, generated JSON/Markdown, and documentation coverage.

- [x] G1: Exploration emits twelve discoveries across nine families and a report.
  CHECK: npm run explore -- --families all --samples 12 --top 12 --seed 424242
  EXPECT: /EXPLORE_PASS discoveries=12 families=9/
  EVIDENCE: 11. ikeda bounded-low-complexity score=34.18 fingerprint=sha256-e6fca48591a8edcdb3b2d3987c69e9a3e0e64c107dbe93b0cd4cf38298158800 | 12. rossler bounded-low-complexity score=23.33 fingerprint=sha256-815

- [x] G2: Documentation checks pass.
  CHECK: node scripts/docs-check.mjs
  EXPECT: /DOCS_PASS/
  EVIDENCE: DOCS_PASS ui_controls=present
