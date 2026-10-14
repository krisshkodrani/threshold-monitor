import { expect, test } from "vitest";
import { PROTOCOL_VERSION } from "./index";

test("exposes the protocol version", () => {
  expect(PROTOCOL_VERSION).toBe(1);
});
