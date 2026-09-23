# Gates: Adversarial metric audit

Scope: anti-divergence, anti-collapse, multi-scale telemetry and edge-case fixtures.

- [x] G1: Adversarial fixtures retain penalties and score a bounded reference.
  CHECK: npm run adversarial
  EXPECT: /ADVERSARIAL_PASS/
  EVIDENCE: fixture=family-rossler expected=structured actual=structured score=58.99 | fixture=family-thomas expected=structured actual=structured score=54.49
