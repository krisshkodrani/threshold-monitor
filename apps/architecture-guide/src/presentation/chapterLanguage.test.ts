import { describe, expect, it } from "vitest";
import german from "../content/translations/de.json";
import { chapterText } from "./chapterLanguage";

describe("guide translations", () => {
  it("translates overview and simulator controls", () => {
    expect(chapterText("System overview", "de")).toBe("Systemübersicht");
    expect(chapterText("Step", "de")).toBe("Schritt");
    expect(chapterText("Settings", "en")).toBe("Settings");
  });
  it("interpolates dynamic stages without changing their values", () => {
    expect(chapterText("Sample 4 / 7 · Browser apps · 3 / 3", "de")).toBe(
      "Messwert 4 / 7 · Browser-Apps · 3 / 3",
    );
    expect(chapterText("A01 stored; sensor receives accepted", "de")).toBe(
      "A01 gespeichert; Sensor empfängt accepted",
    );
  });
  it("translates nested decision fragments", () => {
    expect(
      chapterText(
        "25.4°C is strictly above the upper edge of 25.3°C. The detector changes from below to above and creates one up alert.",
        "de",
      ),
    ).toContain("25.4°C liegt strikt über der oberen Grenze bei 25.3°C");
  });
  it("retains all interpolation slots in the German catalog", () => {
    for (const [english, translated] of Object.entries(german)) {
      const slots = (text: string) =>
        [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
      expect(slots(translated), english).toEqual(slots(english));
    }
  });
});
