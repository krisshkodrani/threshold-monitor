import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  clean: true,
  // Source-only workspace package; bundled like in the server.
  // zod too, so the sensor is one file with no node_modules in the image.
  noExternal: ["@app/protocol", "zod"],
});
