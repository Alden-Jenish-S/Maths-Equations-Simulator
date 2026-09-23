import { spawn } from "node:child_process";

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

for (const [name, args] of commands) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${name} failed with exit ${code}`)));
  });
}
console.log("ALL_TESTS_PASS");
