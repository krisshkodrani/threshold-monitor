import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // Source-only workspace package; bundled like in the server.
  noExternal: ["@app/protocol"],
});
