# Gates: Integration verification

Scope: full CLI suite, rendering benchmark, and project-local isolated runtime.

- [x] G1: Composite tests pass.
  CHECK: npm test
  EXPECT: /ALL_TESTS_PASS/
  EVIDENCE: SERVER_SMOKE_PASS status=200 assets=atlas | ALL_TESTS_PASS

- [x] G2: Rendering decimation stays within the benchmark budget.
  CHECK: npm run benchmark
  EXPECT: /BENCHMARK_PASS/
  EVIDENCE: > node scripts/benchmark.mjs | BENCHMARK_PASS cases=2 max_render_ms=10.32

- [x] G3: Project virtual environment exists.
  CHECK: test -x .venv/bin/python && node --version
  EXPECT: v
  EVIDENCE: v24.12.0
