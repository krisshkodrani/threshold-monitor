import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans when test globals are enabled; we import
// `test`/`expect` explicitly instead, so unmount rendered trees ourselves.
afterEach(() => {
  cleanup();
});

// jsdom has no layout engine and no ResizeObserver, which Recharts'
// ResponsiveContainer needs. A no-op is enough: tests never assert on chart pixels.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
