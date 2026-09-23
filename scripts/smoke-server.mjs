import { spawn } from "node:child_process";

const port = 4317;
const child = spawn(process.execPath, ["scripts/serve.mjs"], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
const wait = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start")), 5000);
  child.stdout.on("data", (chunk) => { if (chunk.toString().includes("Trace Explorer running")) { clearTimeout(timer); resolve(); } });
  child.on("error", reject);
});
try {
  await wait;
  const response = await fetch(`http://127.0.0.1:${port}/`);
  const html = await response.text();
  if (!response.ok || !html.includes("Trace Explorer") || !html.includes("trace-canvas")) throw new Error("homepage content check failed");
  const asset = await fetch(`http://127.0.0.1:${port}/data/discoveries.json`);
  if (!asset.ok) throw new Error("generated atlas unavailable");
  console.log("SERVER_SMOKE_PASS status=200 assets=atlas");
} finally {
  child.kill("SIGTERM");
}
