import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The app always connects to the relative /ws, in dev and in production.
    proxy: { "/ws": { target: "ws://localhost:8080", ws: true } },
  },
  test: {
    environment: "jsdom",
  },
});
