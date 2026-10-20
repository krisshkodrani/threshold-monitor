import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createAppStore } from "../../monitor/src/store";
import { decodeCode } from "./highlight";

it("shows the monitor's actual initial Redux state", () => {
  const document = readFileSync(
    new URL("../src/content/code.html", import.meta.url),
    "utf8",
  );
  const snapshot = document.match(
    /<code id="snippet-redux-initial"[^>]*>([\s\S]*?)<\/code>/,
  )?.[1];
  expect(snapshot).toBeDefined();
  const shown: unknown = JSON.parse(decodeCode(snapshot!));
  expect(shown).toEqual(createAppStore().getState());
});

it("keeps the added decision examples identical to their repository sources", () => {
  const document = readFileSync(
    new URL("../src/content/code.html", import.meta.url),
    "utf8",
  );
  const excerpts = [
    ...document.matchAll(
      /<code id="snippet-[^"]+" data-source="([^"]+)"[^>]*>([\s\S]*?)<\/code>/g,
    ),
  ];
  expect(excerpts).toHaveLength(8);
  for (const [, path, code] of excerpts) {
    const source = readFileSync(
      new URL("../../../" + path, import.meta.url),
      "utf8",
    );
    expect(source, path).toContain(decodeCode(code!));
  }
});
