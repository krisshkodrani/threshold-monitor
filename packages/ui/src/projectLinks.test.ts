import { expect, test } from "vitest";
import { projectHref } from "./projectLinks";

test("development links preserve the hostname and select each app's port", () => {
  const location = new URL("http://127.0.0.1:5173/?x=1#alarm");
  expect(projectHref("control", location, true)).toBe(
    "http://127.0.0.1:5174/control/",
  );
  expect(projectHref("architecture", location, true)).toBe(
    "http://127.0.0.1:5175/",
  );
});
test("deployed links preserve the HTTPS origin without development ports", () => {
  const location = new URL("https://example.test:8443/architecture/#code");
  expect(projectHref("monitor", location, false)).toBe(
    "https://example.test:8443/",
  );
  expect(projectHref("control", location, false)).toBe(
    "https://example.test:8443/control/",
  );
  expect(projectHref("architecture", location, false)).toBe(
    "https://example.test:8443/architecture/",
  );
});
test("offline guide links open the local development apps", () => {
  expect(
    projectHref(
      "monitor",
      new URL("file:///tmp/architecture-guide.html"),
      false,
    ),
  ).toBe("http://localhost:5173/");
});
