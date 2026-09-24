import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const commands = [
  ["validate", ["scripts/validate.mjs"]],
  ["adversarial", ["scripts/adversarial.mjs"]],
  ["live", ["scripts/live-test.mjs"]],
  ["ui", ["scripts/ui-test.mjs"]],
  ["repro", ["scripts/repro-test.mjs"]],
  ["explore", ["scripts/explore.mjs", "--families", "all", "--samples", "12", "--top", "12", "--seed", "424242"]],
  ["docs", ["scripts/docs-check.mjs"]],
  ["benchmark", ["scripts/benchmark.mjs"]],
  ["smoke", ["scripts/smoke-server.mjs"]],
];

const root = fileURLToPath(new URL("..", import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), "trace-explorer-test-"));
try {
  for (const [name, [script, ...args]] of commands) {
    await new Promise((resolve, reject) => {
      // Artifact-generating checks must not replace the user's saved atlas.
      const cwd = name === "adversarial" || name === "explore" ? artifacts : root;
      const child = spawn(process.execPath, [join(root, script), ...args], { cwd, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${name} failed with exit ${code}`)));
    });
  }
} finally {
  await rm(artifacts, { recursive: true, force: true });
}
console.log("ALL_TESTS_PASS");
