import { highlightDocument } from "./build/highlight.ts";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  server: { strictPort: true },
  plugins: [
    {
      name: "guide-code-highlighting",
      enforce: "pre",
      async load(id) {
        const [path, query] = id.split("?");
        if (
          !path?.endsWith("/content/code.html") ||
          !new URLSearchParams(query).has("raw")
        )
          return;
        this.addWatchFile(path);
        return `export default ${JSON.stringify(highlightDocument(await readFile(path, "utf8")))}`;
      },
    },
    react(),
    {
      name: "guide-source-links",
      configureServer(server) {
        const root = fileURLToPath(new URL("../../", import.meta.url));
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/__source/")) {
            next();
            return;
          }
          const path = decodeURIComponent(
            req.url.slice("/__source/".length).split("?")[0]!,
          );
          const file = resolve(root, path);
          if (
            !file.startsWith(root + (root.endsWith(sep) ? "" : sep)) ||
            !/^(?:README\.md|(?:docs|sensor\/src|server\/src|packages\/[a-z-]+\/src|apps\/(?:monitor|control)\/src)\/[a-zA-Z0-9_./-]+\.(?:ts|tsx|md))$/.test(
              path,
            )
          ) {
            res.statusCode = 404;
            res.end("Source file not found");
            return;
          }
          void readFile(file, "utf8")
            .then((content) => {
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.end(content);
            })
            .catch(() => {
              res.statusCode = 404;
              res.end("Source file not found");
            });
        });
      },
    },
  ],
  // This offline document intentionally includes its authored, highlighted HTML
  // and both guide languages in one bundle; token markup compresses well and
  // needs no runtime grammar or external translation service.
  build: { cssCodeSplit: false, chunkSizeWarningLimit: 700 },
  test: { environment: "node" },
});
