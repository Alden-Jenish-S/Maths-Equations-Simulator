import { performance } from "node:perf_hooks";
import { decimateToGrid } from "../src/renderer.js";

function cloud(count) {
  const points = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = i * 0.17;
    const radius = 0.2 + 0.8 * ((i * 2654435761) >>> 0) / 4294967296;
    points[i] = [400 + Math.cos(angle) * radius * 390, 300 + Math.sin(angle * 1.7) * radius * 290];
  }
  return points;
}

const cases = [50000, 200000];
let maxMs = 0;
for (const count of cases) {
  const points = cloud(count);
  const samples = [];
  for (let run = 0; run < 8; run += 1) {
    const start = performance.now();
    const result = decimateToGrid(points, 800, 600, 90000);
    samples.push(performance.now() - start);
    if (!result.length) throw new Error("decimator returned no points");
  }
  const p95 = [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)];
  maxMs = Math.max(maxMs, p95);
}
if (maxMs > 100) throw new Error(`decimator regression p95=${maxMs.toFixed(2)}ms`);
console.log(`BENCHMARK_PASS cases=${cases.length} max_render_ms=${maxMs.toFixed(2)}`);
