# Gates: Deterministic search and ranking

Scope: Seeded parameter-space exploration with diversity-aware retention.

- [x] G1: Same seed and arguments reproduce identical discovery ids and scores.
  CHECK: node scripts/explore.mjs --families all --samples 12 --top 4 --seed 7 && cp data/discoveries.json /tmp/discoveries-a.json && node scripts/explore.mjs --families all --samples 12 --top 4 --seed 7 && cmp data/discoveries.json /tmp/discoveries-a.json && printf 'DETERMINISM_PASS\n'
  EXPECT: DETERMINISM_PASS
  EVIDENCE: 4. ikeda bounded-low-complexity score=29.14 id=ikeda-0-4-24aee889 | DETERMINISM_PASS
