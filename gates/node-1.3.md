# Gates: Product branch

- [x] G1: UI and performance checks pass.
  CHECK: node scripts/smoke-server.mjs && node scripts/benchmark.mjs
  EXPECT: SERVER_SMOKE_PASS
  EVIDENCE: SERVER_SMOKE_PASS status=200 assets=atlas | BENCHMARK_PASS cases=2 max_render_ms=10.60
