# Gates: Rendering and performance

Scope: Point-cloud renderer uses canvas, point decimation, and benchmark evidence.

- [x] G1: Rendering benchmark remains within a responsive budget for a large point cloud.
  CHECK: node scripts/benchmark.mjs
  EXPECT: BENCHMARK_PASS
  EVIDENCE: BENCHMARK_PASS cases=2 max_render_ms=16.00
