import { describe, expect, test } from "vitest";
import { parseThresholdInput, type ValueRange } from "./thresholdInput";

const range: ValueRange = {
  min: -40,
  max: 80,
  decimals: 1,
  unit: "°C",
  noun: "temperature",
};
const parse = (raw: string) => parseThresholdInput(raw, range);

describe("parseThresholdInput", () => {
  test.each([
    ["25", 25],
    ["25.5", 25.5],
    ["25,5", 25.5],
    ["  25,5  ", 25.5],
    ["-3", -3],
    ["−3", -3], // typographic minus
    ["+7", 7],
    [",5", 0.5],
    ["25.", 25],
    ["25.46", 25.5],
    ["25.44", 25.4],
    ["-0.01", 0],
    ["-40", -40],
    ["80", 80],
  ])("accepts %j as %d", (raw, value) => {
    expect(parse(raw)).toEqual({ ok: true, value });
  });

  test("rounding never produces negative zero", () => {
    const result = parse("-0.04");
    expect(result.ok && Object.is(result.value, 0)).toBe(true);
  });

  test.each(["", "   "])("asks for a value when the input is %j", (raw) => {
    expect(parse(raw)).toEqual({ ok: false, error: "Enter a temperature." });
  });

  test.each([
    "abc",
    "25abc",
    "1.2.3",
    "25,5,1",
    "1e3",
    "0x10",
    "Infinity",
    "NaN",
    "-",
    ".",
  ])("rejects %j as not a number", (raw) => {
    expect(parse(raw)).toEqual({
      ok: false,
      error: "Use a number such as 25.5.",
    });
  });

  test.each(["-40.1", "80.1", "1000"])("rejects %j as out of range", (raw) => {
    expect(parse(raw)).toEqual({
      ok: false,
      error: "Keep it between −40 and 80 °C.",
    });
  });
});
