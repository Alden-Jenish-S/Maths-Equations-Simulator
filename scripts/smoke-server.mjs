import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "./serve.mjs";
import { fileURLToPath } from "node:url";
import { get } from "node:http";

const child = spawn(process.execPath, [fileURLToPath(new URL("./serve.mjs", import.meta.url))], {
  env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
});
const closed = new Promise((resolve) => child.once("close", resolve));
const wait = new Promise((resolve, reject) => {
  let stdout = "", stderr = "";
  const finish = (error, url) => { clearTimeout(timer); error ? reject(error) : resolve(url); };
  const timer = setTimeout(() => finish(new Error(`server did not start: ${stderr}`)), 5000);
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk).slice(-4096);
    const url = stdout.match(/Trace Explorer running at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (url) finish(null, url);
  });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4096); });
  child.once("error", (error) => finish(error));
  child.once("exit", (code, signal) => finish(new Error(`server exited (${code ?? signal}): ${stderr}`)));
});
async function expectStatus(url, status) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  await response.arrayBuffer();
  assert.equal(response.status, status, `${url} returned ${response.status}`);
}
async function expectHost(url, host, expected) {
  // Fetch may replace a supplied Host header; use the HTTP client to exercise
  // the server's actual authority check rather than silently testing localhost.
  const status = await new Promise((resolve, reject) => {
    const request = get(url, { headers: { Host: host } }, (response) => {
      response.resume(); response.once("end", () => resolve(response.statusCode)); response.once("error", reject);
    });
    request.once("error", reject);
    request.setTimeout(5000, () => request.destroy(new Error("Host check timed out")));
  });
  assert.equal(status, expected, `Host ${host}`);
}
try {
  const url = await wait;
  const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(5000) });
  const html = await response.text();
  if (!response.ok || !html.includes("Trace Explorer") || !html.includes("trace-canvas")) throw new Error("homepage content check failed");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  for (const path of ["index.html", "styles.css", "src/app.js", "src/simulation-worker.js", "src/audio-worklet.js", "data/discoveries.json", "docs/METHODOLOGY.md", "README.md"]) {
    await expectStatus(`${url}/${path}`, 200);
  }
  for (const path of [".git/config", "%2egit/config", ".env", "package.json", "scripts/serve.mjs", "data/..%2f.env", "..%2fprivate.json", "%", "data/%00"]) {
    await expectStatus(`${url}/${path}`, 404);
  }
  await expectHost(`${url}/`, "rebound.example", 403);
  await expectHost(`${url}/`, "localhost", 200);
} finally {
  child.kill("SIGTERM");
  await closed;
}

// Public-looking paths must not follow symlinks to private or outside files.
const fixture = await mkdtemp(join(tmpdir(), "trace-explorer-server-"));
let server;
try {
  const root = join(fixture, "public");
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, ".env"), "private fixture");
  await writeFile(join(fixture, "outside.json"), "outside fixture");
  await symlink(join(root, ".env"), join(root, "data", "private.json"));
  await symlink(join(fixture, "outside.json"), join(root, "data", "outside.json"));
  server = await createStaticServer(root);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  await expectStatus(`${url}/data/private.json`, 404);
  await expectStatus(`${url}/data/outside.json`, 404);
} finally {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(fixture, { recursive: true, force: true });
}
console.log("SERVER_SMOKE_PASS status=200 assets=atlas private_paths=blocked symlinks=blocked host=validated");
