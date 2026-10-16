import { expect, test, type Page } from "@playwright/test";

/** Collects CSP violations and uncaught errors of a page. */
function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text()))
      problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}

async function logIn(page: Page, username: string) {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Sign in" }).click();
}

// The apps send a strict CSP. A blocked script, style or socket would break
// the app without a failed unit test, so the real browser checks it here.
test("both apps work under their CSP, with no violation", async ({
  browser,
}) => {
  const monitor = await (await browser.newContext()).newPage();
  const monitorProblems = watchProblems(monitor);
  const response = await monitor.goto("/");
  await logIn(monitor, "monitor");
  await expect(monitor.getByText("Connected", { exact: true })).toBeVisible();
  // The chart is a lazy chunk; it must load under the CSP too.
  await expect(monitor.getByRole("figure", { name: /chart/ })).toBeVisible();
  await expect(monitor.locator(".recharts-line-curve")).toBeVisible();

  const control = await (await browser.newContext()).newPage();
  const controlProblems = watchProblems(control);
  await control.goto("/control/");
  await logIn(control, "operator");
  await expect(control.getByText("Connected", { exact: true })).toBeVisible();

  expect(response?.headers()["location"] ?? "").toBe(""); // no redirect loop
  expect(monitorProblems).toEqual([]);
  expect(controlProblems).toEqual([]);
});

test("the app pages and assets have the security and cache headers", async ({
  request,
}) => {
  const page = await request.get("/control/");
  expect(page.headers()["content-security-policy"]).toContain(
    "default-src 'self'",
  );
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  expect(page.headers()["cache-control"]).toBe("no-cache");

  const html = await page.text();
  const asset = /src="(\/control\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(asset).toBeDefined();
  const script = await request.get(asset!);
  expect(script.headers()["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
});

test("readiness and liveness", async ({ request }) => {
  expect((await request.get("/healthz")).status()).toBe(200);
  const ready = await request.get("/readyz");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: "ready" });
});
