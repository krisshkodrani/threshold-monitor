import { expect, test } from "vitest";
import { memoryStorage } from "./test/fakes";
import { loadOperator, normalizeOperator, saveOperator } from "./operator";

test("names are trimmed and must have 1 to 40 characters", () => {
  expect(normalizeOperator("  Ada ")).toBe("Ada");
  expect(normalizeOperator("   ")).toBeNull();
  expect(normalizeOperator("x".repeat(40))).toBe("x".repeat(40));
  expect(normalizeOperator("x".repeat(41))).toBeNull();
});

test("a saved name is loaded again", () => {
  const storage = memoryStorage();
  saveOperator(() => storage, "Ada");
  expect(loadOperator(() => storage)).toBe("Ada");
});

test("an invalid stored name counts as no operator", () => {
  const storage = memoryStorage();
  storage.setItem("threshold-control:operator:v1", " ");
  expect(loadOperator(() => storage)).toBeNull();
});

test("blocked storage never throws", () => {
  const blocked = (): Storage => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  expect(loadOperator(blocked)).toBeNull();
  expect(() => saveOperator(blocked, "Ada")).not.toThrow();
});
