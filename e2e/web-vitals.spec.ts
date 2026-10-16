import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Core Web Vitals in the lab: LCP, CLS and INP, measured with the browser's
 * own PerformanceObserver entries (no extra library). The CPU is 4 times
 * slower, like the Lighthouse mobile preset. Lab values are not field data:
 * they catch regressions, they do not replace real-user measurement.
 */

/** The "good" limits of web.dev for each metric. */
const BUDGET = { lcp: 2_500, cls: 0.1, inp: 200 };
const CPU_SLOWDOWN = 4;

type Vitals = { lcp: number | null; cls: number; inp: number | null };

declare global {
  interface Window {
    __vitals: Vitals;
  }
}

/** Starts the observers before the page loads, so buffered entries count. */
async function observeVitals(page: Page) {
  await page.addInitScript(() => {
    const vitals: Vitals = { lcp: null, cls: 0, inp: null };
    window.__vitals = vitals;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) vitals.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    // CLS: the largest session window (shifts less than 1 s apart, at most
    // 5 s long), without the shifts just after an input.
    let session = 0;
    let first = 0;
    let last = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (entry.hadRecentInput) continue;
        const t = entry.startTime;
        if (session > 0 && t - last < 1_000 && t - first < 5_000)
          session += entry.value;
        else {
          session = entry.value;
          first = t;
        }
        last = t;
        vitals.cls = Math.max(vitals.cls, session);
      }
    }).observe({ type: "layout-shift", buffered: true });
    // INP with few interactions: the slowest one. The browser reports only
    // events of 16 ms or more, so null means "all under 16 ms".
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        interactionId?: number;
      })[]) {
        if (!entry.interactionId) continue;
        vitals.inp = Math.max(vitals.inp ?? 0, entry.duration);
      }
    }).observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
  });
}

/** The browser stops LCP at the first input, so wait for it before a click. */
async function waitForLcp(page: Page) {
  await page.waitForFunction(() => window.__vitals.lcp !== null);
}

async function slowCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
}

async function logIn(page: Page, username: string) {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Reads the values, puts them in the report and checks the budget. */
async function check(page: Page, name: string, testInfo: TestInfo) {
  // The event entries arrive after the next frame.
  await page.waitForTimeout(500);
  const vitals = await page.evaluate(() => window.__vitals);
  const text = `LCP ${vitals.lcp?.toFixed(0) ?? "—"} ms, CLS ${vitals.cls.toFixed(3)}, INP ${vitals.inp === null ? "under 16" : vitals.inp.toFixed(0)} ms`;
  testInfo.annotations.push({ type: `web vitals: ${name}`, description: text });
  console.log(`${name}: ${text}`);

  expect(vitals.lcp, `${name} LCP`).not.toBeNull();
  expect(vitals.lcp!, `${name} LCP`).toBeLessThan(BUDGET.lcp);
  expect(vitals.cls, `${name} CLS`).toBeLessThan(BUDGET.cls);
  if (vitals.inp !== null)
    expect(vitals.inp, `${name} INP`).toBeLessThan(BUDGET.inp);
}

test.describe("core web vitals (CPU 4x slower)", () => {
  test("the login page", async ({ page }, testInfo) => {
    await observeVitals(page);
    await slowCpu(page);
    await page.goto("/login");
    await waitForLcp(page);
    await page.getByLabel("Username").click(); // one interaction for INP
    await page.getByLabel("Username").fill("monitor");
    await check(page, "login", testInfo);
  });

  test("the monitor, with live data and a settings change", async ({
    browser,
  }, testInfo) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/");
    await logIn(page, "monitor");
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();

    // A fresh load with the session, as a user who comes back.
    await observeVitals(page);
    await slowCpu(page);
    await page.goto("/");
    await expect(page.getByText("Sensor 1 · online")).toBeVisible();
    await waitForLcp(page);
    // Live readings for 5 s: the chart and the readout must not move the page.
    await page.waitForTimeout(5_000);
    const input = page.getByLabel("Threshold (°C)");
    await input.fill("24.8");
    await page.getByRole("button", { name: "Apply" }).click();
    await check(page, "monitor", testInfo);
  });

  test("the control room, with an acknowledgement", async ({
    browser,
  }, testInfo) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/control/");
    await logIn(page, "operator");
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();

    await observeVitals(page);
    await slowCpu(page);
    await page.goto("/control/");
    const button = page.getByRole("button", { name: /^Acknowledge / }).first();
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await waitForLcp(page);
    await page.waitForTimeout(2_000); // new alarms arrive meanwhile
    await button.click();
    await check(page, "control room", testInfo);
  });
});
