# Gates: Interactive product (integration)

Scope: browser frontend and runtime verification.

- [x] N1: child gates are checked.
  CHECK: node /Users/aldenjenish/.config/opencode/skills/unlazy/scripts/gate-check.mjs --status gates/leaf-2.3.1.md gates/leaf-2.3.2.md
  EXPECT: /ALL MET/
  EVIDENCE: gates/leaf-2.3.2.md: 3 gates | ALL MET (5 met)

- [x] N2: full test suite passes.
  CHECK: npm test
  EXPECT: ALL_TESTS_PASS
  EVIDENCE: SERVER_SMOKE_PASS status=200 assets=atlas | ALL_TESTS_PASS
