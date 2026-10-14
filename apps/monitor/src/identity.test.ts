import { describe, expect, test } from "vitest";
import { getSourceIdentity } from "./identity";
import { blockedStorage, memoryStorage } from "./test/fakes";

const ID = "a3f0c6a8-6b1d-4c2a-9f4e-2a7d5b9c1e01";

describe("getSourceIdentity", () => {
  test("creates a labelled identity from the id", () => {
    expect(getSourceIdentity(memoryStorage, () => ID)).toEqual({
      sourceId: ID,
      sourceLabel: "Monitor A3F",
    });
  });

  test("returns the same identity on the next load of the same tab", () => {
    const storage = memoryStorage();
    const first = getSourceIdentity(
      () => storage,
      () => ID,
    );
    const second = getSourceIdentity(
      () => storage,
      () => "other",
    );
    expect(second).toEqual(first);
  });

  test("replaces a corrupt stored identity", () => {
    const storage = memoryStorage();
    storage.setItem("threshold-monitor:identity:v1", "{not json");
    expect(
      getSourceIdentity(
        () => storage,
        () => ID,
      ).sourceId,
    ).toBe(ID);
  });

  test("still works when storage throws", () => {
    expect(getSourceIdentity(blockedStorage, () => ID).sourceLabel).toBe(
      "Monitor A3F",
    );
  });
});
