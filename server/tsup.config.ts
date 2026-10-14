import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // @app/protocol ships TypeScript source with no build step, so it must be bundled
  // into the server output. It is a devDependency for the same reason: it never
  // needs to exist in the production node_modules.
  noExternal: ["@app/protocol"],
});
