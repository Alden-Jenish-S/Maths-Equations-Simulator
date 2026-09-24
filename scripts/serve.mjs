import http from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8" };
const publicPath = /^(?:index\.html|styles\.css|README\.md|src\/[a-z0-9-]+\.js|(?:data|docs)\/[a-zA-Z0-9-]+\.(?:json|md))$/;

export async function createStaticServer(directory = defaultRoot) {
  const root = await realpath(directory);
  return http.createServer(async (request, response) => {
    // Reject foreign Host names even when DNS points them at this loopback
    // listener. Otherwise a rebinding origin could read local project files.
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(request.headers.host ?? "")) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Forbidden"); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      if (!publicPath.test(relative)) throw new Error("not a public asset");
      const file = join(root, relative);
      if (await realpath(file) !== file) throw new Error("symlinked asset");
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": types[extname(file)], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createStaticServer();
  server.listen(Number(process.env.PORT ?? 4173), "127.0.0.1", () => console.log(`Trace Explorer running at http://127.0.0.1:${server.address().port}`));
}
