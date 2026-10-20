import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const offline = pathToFileURL(
  resolve(import.meta.dirname, "../docs/architecture-guide.html"),
).href;
for (const [name, url] of [
  ["development", "http://127.0.0.1:5175/"],
  ["offline export", offline],
] as const) {
  test(`${name}: navigation, simulation and saved runs`, async ({ page }) => {
    const errors: string[] = [];
    const step = async (count = 1) => {
      for (let n = 0; n < count; n++) await page.locator("#sim-next").click();
    };
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    if (name === "offline export")
      await page.route(/^https?:/, (route) => route.abort());
    await page.goto(url);
    if (name === "development") {
      const source = await page.request.get(
        "http://127.0.0.1:5175/__source/sensor/src/domain/crossing.ts",
      );
      expect(source.ok()).toBe(true);
      expect(await source.text()).toContain("export function step");
    }
    await expect(page.locator("#node-inspector h3")).toHaveText("Relay server");
    const appLinks = page.getByRole("navigation", { name: "Project apps" });
    await expect(appLinks.getByRole("link")).toHaveCount(2);
    await expect(
      appLinks.getByRole("link", {
        name: "Live Monitor (opens in a new tab)",
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      name === "development"
        ? "http://127.0.0.1:5173/"
        : "http://localhost:5173/",
    );
    await expect(appLinks.getByRole("link").first()).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(appLinks).toBeVisible();
    await page.locator("#guide-nav-toggle").click();
    await expect(appLinks).toBeHidden();
    await expect(page.locator("#guide-nav-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.reload();
    await expect(appLinks).toBeHidden();
    await page.locator("#guide-nav-toggle").click();
    await expect(appLinks).toBeVisible();
    await expect(appLinks.getByRole("link")).toHaveCount(2);
    await expect(
      page.locator('[data-page="interview"], #interview'),
    ).toHaveCount(0);
    await expect(page.locator('[data-page="flows"], #flows')).toHaveCount(0);
    await page.locator('a[data-page="code"]').click();
    await expect(page.locator('[data-code="source"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#snippet-source")).toBeVisible();
    await expect(
      page.locator(".code-focus-note, .code-line-focus"),
    ).toHaveCount(0);

    await expect(page.locator("#code-previous")).toBeDisabled();
    await page.locator("#code-next").click();
    await expect(page.locator('[data-code-panel="agent"]')).toBeVisible();
    await page.locator("#code-previous").click();
    await expect(page.locator('[data-code-panel="source"]')).toBeVisible();
    await expect(page.locator("[data-code-group]")).toHaveCount(5);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect
      .poll(async () =>
        page.locator(".code-reader").evaluate((el) => el.clientWidth),
      )
      .toBeGreaterThan(1250);
    await expect(
      page.locator("#snippet-source .code-line").last(),
    ).toBeInViewport();
    await expect(
      page.locator('[data-code-group="Packages"] .file-group'),
    ).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("source-wide-screen.png"),
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({
      path: test.info().outputPath("source-first-screen.png"),
    });
    for (const id of [
      "agent",
      "crossing",
      "outbox",
      "routing",
      "database",
      "redux-flow",
      "alerts",
      "control",
      "ack",
    ]) {
      await page.locator("#code-next").click();
      await expect(page.locator(`[data-code-panel="${id}"]`)).toBeVisible();
    }
    await page.locator('[data-code="protocol"]').click();
    await expect(page.locator("#snippet-protocol")).toBeVisible();
    await page.locator('[data-code="hook"]').click();
    await expect(page.locator("#snippet-hook")).toBeVisible();
    await expect(page.locator("#code-next")).toBeDisabled();
    await page.locator('[data-code="alerts"]').click();

    await expect(page.locator('[data-code="alerts"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("#snippet-redux-initial")).toBeVisible();
    await expect(
      page.locator(
        "#code .code-reader-path, #code .badge, #code .page-heading",
      ),
    ).toHaveCount(0);
    await expect(page.locator("#snippet-redux-initial")).toContainText(
      '"settings"',
    );
    await expect(
      page.locator('#snippet-redux-initial [data-line="4"]'),
    ).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("redux-state-first-screen.png"),
    });
    await page.screenshot({
      path: test.info().outputPath("redux-state-desktop.png"),
      fullPage: true,
    });
    await page.locator('[data-code="alerts"]').click();
    await expect(page.locator('[data-code-panel="alerts"]')).toBeVisible();
    const colors = await page.evaluate(() => ({
      keyword: getComputedStyle(
        document.querySelector("#snippet-alerts .syntax-keyword")!,
      ).color,
      identifier: getComputedStyle(
        document.querySelector("#snippet-alerts .syntax-identifier")!,
      ).color,
    }));
    expect(colors.keyword).not.toBe(colors.identifier);
    await page.locator('[data-code="alerts"]').click();
    await expect(page.locator("#snippet-alerts")).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("redux-reducers-desktop.png"),
      fullPage: true,
    });
    await page.locator('[data-code="redux-flow"]').click();
    await expect(page.locator("#snippet-redux-flow")).toBeVisible();
    await expect(page.locator("#snippet-redux-selectors")).toBeVisible();
    const displayedCode = await page
      .locator("#snippet-redux-flow")
      .textContent();
    const appSource = readFileSync(
      new URL("../apps/monitor/src/App.tsx", import.meta.url),
      "utf8",
    );
    expect(appSource).toContain(displayedCode);
    await page.locator(".code-reader").evaluate((main) => {
      main.scrollTop = main.scrollHeight;
    });
    await expect
      .poll(async () =>
        page.locator(".code-reader").evaluate((main) => main.scrollTop),
      )
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator("#guide-nav-toggle")).toBeInViewport();
    await page.locator('a[data-page="overview"]').click();
    await expect
      .poll(async () =>
        page.locator("#main").evaluate((main) => main.scrollTop),
      )
      .toBe(0);
    await page.locator('a[data-page="code"]').click();
    await page.locator("#guide-search").fill("Redux");
    await page
      .locator("#search-results .search-result")
      .filter({ hasText: "createAppStore().getState()" })
      .click();
    await expect(page.locator('[data-code="alerts"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.locator('[data-page="state"], [data-page="react"], #state, #react'),
    ).toHaveCount(0);
    for (const [panel, snippet] of [
      ["draft", "draft"],
      ["readings", "readings-store"],
      ["outbox", "outbox-expire"],
    ]) {
      await page.locator(`[data-code="${panel}"]`).click();
      await expect(page.locator(`#snippet-${snippet}`)).toBeVisible();
      await expect(
        page.locator(`#snippet-${snippet} .code-line`).first(),
      ).toBeVisible();
    }
    await page.locator('[data-code="draft"]').click();
    const originalSnippet = await page.locator("#snippet-draft").textContent();
    await page.locator('[data-guide-language="de"]').click();
    await expect(page.locator("#code-title")).toHaveText("Code-Explorer");
    await expect(page.locator("#code-panel-draft h3")).toHaveText(
      "Tippen ändert noch keine Einstellung",
    );
    await expect(page.locator("#snippet-draft")).toHaveText(originalSnippet!);
    await page.reload();
    await expect(page.locator('[data-guide-language="de"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.locator('[data-guide-language="en"]').click();
    for (const oldRoute of ["state", "react"]) {
      await page.evaluate((id) => {
        location.hash = "#" + id;
      }, oldRoute);
      await expect(page).toHaveURL(/#code$/);
      await expect(page.locator("#code")).toBeVisible();
    }
    await page.locator('a[data-page="simulator"]').click();
    await expect(page.locator("#sim-chart .sim-chart-empty")).toBeVisible();
    await page.locator("#sim-chart").screenshot({
      path: test.info().outputPath("simulator-empty-chart.png"),
    });
    await step(3);
    await expect(page.locator("#sim-chart .sim-chart-empty")).toHaveCount(0);
    await expect(page.locator("#sim-sample-counter")).toHaveText(
      "1 / 7 SAMPLES",
    );
    await page.locator('a[data-page="code"]').click();
    await page.locator('[data-guide-language="de"]').click();
    await page.locator('[data-guide-language="en"]').click();
    await page.locator('a[data-page="simulator"]').click();
    await expect(page.locator("#sim-sample-counter")).toHaveText(
      "1 / 7 SAMPLES",
    );
    await step(9);
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(1);
    await expect(
      page.locator("#sim-play, #sim-speed, #sim-next-reading"),
    ).toHaveCount(0);
    await page.clock.install();
    await page.locator("#sim-control-records [data-sim-ack]").click();
    await expect(
      page.locator('[data-sim-route="control-relay"]'),
    ).toHaveAttribute("data-route-state", "current");
    const pending = await page.evaluate(() =>
      localStorage.getItem("threshold-guide-simulator-v1"),
    );
    await page.clock.fastForward(60_000);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("threshold-guide-simulator-v1"),
      ),
    ).toBe(pending);
    await expect(
      page.locator("#sim-control-records .is-acknowledged"),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-sim-route="control-relay"]'),
    ).toHaveAttribute("data-route-state", "current");
    await step();
    await expect(
      page.locator('[data-sim-route="relay-database"]'),
    ).toHaveAttribute("data-route-state", "current");
    await expect(
      page.locator("#sim-control-records .is-acknowledged"),
    ).toHaveCount(0);
    await step();
    await expect(
      page.locator('[data-sim-route="relay-control"]'),
    ).toHaveAttribute("data-route-state", "current");
    await expect(
      page.locator("#sim-control-records .is-acknowledged"),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.locator('[data-sim-route="relay-control"]'),
    ).toHaveAttribute("data-route-state", "current");
    await step();
    await expect(
      page.locator("#sim-control-records .is-acknowledged"),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-sim-route="relay-control"]'),
    ).toHaveAttribute("data-route-state", "complete");
    await page.reload();
    await expect(
      page.locator("#sim-control-records .is-acknowledged"),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-sim-route="relay-control"]'),
    ).toHaveAttribute("data-route-state", "complete");
    await page.locator("#sim-restart").click();
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(0);
    await page.locator("#sim-case-picker").selectOption("configure");
    for (
      let n = 0;
      n < 20 && !(await page.locator("#sim-next").isDisabled());
      n++
    )
      await step();
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(1);
    await page.locator("#sim-case-picker").selectOption("hysteresis");
    await step(6);
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(0);
    await step(2);
    await expect(page.locator("#sim-live-config")).toContainText("0.6");
    await page.reload();
    await step();
    await expect(page.locator("#sim-live-config")).toContainText("0.2");
    await expect(page.locator("#sim-lower")).toContainText("24.9");
    await expect(page.locator("#sim-upper")).toContainText("25.1");
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(0);
    await step(3);
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(0);
    await step(3);
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(1);
    await step(3);
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(2);
    await expect(page.locator("#sim-next")).toBeDisabled();
    await page.evaluate(() => {
      location.hash = "#flows";
    });
    await expect(page.locator("#simulator")).toBeVisible();
    await expect(page).toHaveURL(/#simulator$/);
    await page.locator("#guide-search").fill("outbox");
    await page.locator("#search-results .search-result").first().click();
    await expect(page.locator("#search-results")).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const chapter of ["code"]) {
      await page.evaluate((id) => {
        location.hash = "#" + id;
      }, chapter);
      await expect(page.locator("#" + chapter)).toBeVisible();
      await expect(page.locator("#code .file-browser")).toBeHidden();
      await page.locator("#code-topic").selectOption("draft");
      await expect(page.locator("#code-panel-draft")).toBeVisible();
      await page.locator("#code-topic").selectOption("alerts");
      await expect(page.locator("#code-panel-alerts")).toBeVisible();
      await page.locator('[data-guide-language="de"]').click();
      await expect(page.locator("#" + chapter)).toHaveAttribute("lang", "de");

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator('[data-guide-language="en"]').click();
    }

    await page.evaluate(() => {
      location.hash = "#simulator";
    });
    await page.locator('button[data-workspace-view="control"]').click();
    await expect(page.locator(".sim-main-grid")).toHaveAttribute(
      "data-workspace-view",
      "control",
    );
    expect(errors).toEqual([]);
  });
}

for (const [name, url] of [
  ["development", "http://127.0.0.1:5175/"],
  ["offline export", offline],
] as const) {
  test(`${name}: German throughout the guide preserves the current run`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (name === "offline export")
      await page.route(/^https?:/, (route) => route.abort());
    await page.goto(url);
    const step = async (count = 1) => {
      for (let n = 0; n < count; n++) await page.locator("#sim-next").click();
    };
    await page.locator('[data-guide-language="de"]').click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("#overview-title")).toHaveText(
      "Architektur von Threshold Monitor",
    );
    await expect(page.locator('[data-page="overview"]')).toContainText(
      "Systemübersicht",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Projektanwendungen" })
        .getByRole("link", {
          name: "Leitstand (in neuem Tab öffnen)",
          exact: true,
        }),
    ).toBeVisible();
    await page.locator('[data-node="control"]').click();
    await expect(page.locator("#node-inspector h3")).toHaveText("Leitstand");
    await expect(page.locator("#node-inspector")).toContainText(
      "berechtigten Operatoren",
    );
    await page.locator('[data-node="relay"]').click();
    await expect(page.locator("#node-inspector")).toContainText(
      "Authentifiziert Verbindungen",
    );
    await page.locator('[data-page="simulator"]').click();
    await expect(page.locator("#sim-next")).toHaveText("Schritt");
    await expect(page.locator("#sim-chart .sim-chart-empty")).toContainText(
      "Warten auf Messwerte",
    );
    await page.locator("#sim-case-picker").selectOption("hysteresis");
    await expect(page.locator("#sim-case-picker option:checked")).toHaveText(
      "Hystereseband anpassen · 2 Alarme",
    );
    await page.locator("#sim-open-settings").click();
    await expect(page.locator("#sim-settings-title")).toHaveText(
      "Versuchseinstellungen",
    );
    await page.locator("#sim-threshold").fill("999");
    await expect(page.locator("#sim-input-error")).toContainText(
      "Der Grenzwert muss zwischen",
    );
    await page.locator("#sim-threshold").fill("25");
    await page.locator('[data-close-dialog="sim-settings-dialog"]').click();
    await page.locator("#sim-case-picker").selectOption("hysteresis");
    await step(8);
    await expect(page.locator("#sim-run-status")).toHaveText(
      "Alarm konfigurieren · 2 / 3",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("#sim-run-status")).toHaveText(
      "Alarm konfigurieren · 2 / 3",
    );
    await step();
    await expect(page.locator("#sim-decision-reason")).toContainText(
      "Das Band wird",
    );
    await expect(page.locator("#sim-live-config")).toContainText(
      "Hysterese 0.2°C",
    );
    await step(6);
    await expect(
      page.locator("#sim-control-records [data-record-id]"),
    ).toHaveCount(1);
    await expect(page.locator("#sim-control-records")).toContainText(
      "Abwärtsübergang",
    );
    await page.locator("#sim-control-records [data-sim-ack]").click();
    await expect(
      page.locator("#sim-control-records [data-sim-ack]"),
    ).toHaveText("Gesendet · Schritt");
    const pending = await page.evaluate(() =>
      localStorage.getItem("threshold-guide-simulator-v1"),
    );
    await page.locator('[data-guide-language="en"]').click();
    await expect(
      page.locator("#sim-control-records [data-sim-ack]"),
    ).toHaveText("Sent · Step");
    await page.locator('[data-guide-language="de"]').click();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("threshold-guide-simulator-v1"),
      ),
    ).toBe(pending);
    await step(3);
    await expect(
      page.locator("#sim-control-records [data-sim-ack]"),
    ).toHaveText("Bestätigt");
    await expect(page.locator("#sim-monitor-records")).toContainText(
      "Von Alex bestätigt",
    );
    await page.locator("#sim-open-details").click();
    await expect(page.locator("#sim-inspect-title")).toHaveText(
      "In diesem Schritt",
    );
    await expect(page.locator("#sim-events pre").first()).toContainText(
      "alertId",
    );
    await page.locator('[data-close-dialog="sim-inspect-dialog"]').click();
    await page.screenshot({
      path: test.info().outputPath("simulator-german.png"),
    });
    await page.locator('[data-page="code"]').click();
    await expect(page.locator("#code-title")).toHaveText("Code-Explorer");
    await expect(
      page.locator("#code-panel-source .code-connection"),
    ).toContainText("Aufgabe");
    await expect(
      page.locator("#code-panel-source .code-connection"),
    ).toContainText("Warum");
    await expect(page.locator("#snippet-source")).toContainText(
      "function tick()",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-guide-language="de"]')).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(0);
    await page.locator('[data-guide-language="en"]').click();
    await expect(page.locator("#overview-title")).toHaveText(
      "Threshold Monitor architecture",
    );
    expect(errors).toEqual([]);
  });
}
