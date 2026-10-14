import { PROTOCOL_VERSION } from "@app/protocol";
import { expect, test } from "vitest";

// Proves the workspace link to the source-only protocol package resolves.
test("resolves @app/protocol from the workspace", () => {
  expect(PROTOCOL_VERSION).toBe(1);
});
