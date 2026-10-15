import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Test globals are off, so Testing Library cannot clean up by itself.
afterEach(() => {
  cleanup();
});
