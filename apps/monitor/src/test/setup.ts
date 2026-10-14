import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans when test globals are enabled; we import
// `test`/`expect` explicitly instead, so unmount rendered trees ourselves.
afterEach(() => {
  cleanup();
});

// jsdom has no layout engine and no ResizeObserver. Recharts' ResponsiveContainer
// measures its box through ResizeObserver and draws nothing at 0 x 0, so this
// stub reports a fixed size once, like a browser would on first layout.
// Tests still never assert on pixels, only on what gets drawn.
globalThis.ResizeObserver ??= class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const contentRect = { width: 600, height: 300 } as DOMRectReadOnly;
    this.callback([{ target, contentRect } as ResizeObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
};
