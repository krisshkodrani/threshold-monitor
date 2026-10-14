import { existsSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import sirv from "sirv";
import type { Logger } from "./logger";

/**
 * Plain HTTP: a health check plus the two built apps, so production is one
 * process on one port with no CORS (the pages and /ws share an origin).
 * sirv handles the file serving details: content types, ETags, path
 * traversal protection and falling back to index.html for client routes.
 */
export function createHttpServer({
  staticDir,
  logger,
}: {
  staticDir: string;
  logger: Logger;
}) {
  const monitor = serveApp(path.join(staticDir, "monitor", "dist"), logger);
  const control = serveApp(path.join(staticDir, "control", "dist"), logger);

  return createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ status: "ok" }));
    }
    if (pathname === "/control") {
      res.writeHead(301, { location: "/control/" });
      return res.end();
    }
    if (pathname.startsWith("/control/")) {
      // The control app is built with base "/control/"; strip it so sirv
      // looks inside control/dist.
      req.url = req.url!.slice("/control".length);
      return control ? control(req, res, () => notFound(res)) : notFound(res);
    }
    return monitor ? monitor(req, res, () => notFound(res)) : notFound(res);
  });
}

function serveApp(dir: string, logger: Logger) {
  if (!existsSync(path.join(dir, "index.html"))) {
    // Normal in development, where Vite serves the pages.
    logger.info("built app not found, not serving it", { dir });
    return null;
  }
  return sirv(dir, { single: true, etag: true });
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end(
    "Not found. In development, open the Vite dev servers on ports 5173 and 5174.",
  );
}
