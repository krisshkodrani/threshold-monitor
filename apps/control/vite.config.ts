import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Served by the relay under /control/ in production.
  base: "/control/",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    // The app always connects to the relative /ws, in dev and in production.
    proxy: { "/ws": { target: "ws://localhost:8080", ws: true } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
