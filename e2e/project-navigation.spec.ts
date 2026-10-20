import { expect, test } from "@playwright/test";

test("project links open the other apps in new tabs with shared styling", async ({
  page,
  context,
  baseURL,
}) => {
  const policyErrors: string[] = [];
  context.on("page", (tab) =>
    tab.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text()))
        policyErrors.push(message.text());
    }),
  );
  await page.goto("/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Threshold Monitor", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect
    .poll(async () =>
      page
        .locator(".app__header")
        .evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeLessThan(45);
  await expect
    .poll(async () =>
      page
        .locator(".alert-log .data-table")
        .evaluate((el) => el.getBoundingClientRect().height),
    )
    .toBeGreaterThanOrEqual(220);
  await expect
    .poll(async () =>
      page
        .locator(".alert-log")
        .evaluate((el) => el.getBoundingClientRect().top),
    )
    .toBeLessThan(700);
  await expect(page.locator(".app__controls .readout")).toBeVisible();
  await expect(page.locator(".app > .readout")).toHaveCount(0);
  await expect(page.locator(".alert-summary")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("monitor-desktop.png"),
    fullPage: true,
  });
  const nav = page.getByRole("navigation", { name: "Project apps" });
  await expect(nav.locator('[aria-current="page"]')).toHaveText("Live Monitor");
  const nextTab = context.waitForEvent("page");
  await nav
    .getByRole("link", {
      name: "Control Room (opens in a new tab)",
      exact: true,
    })
    .click();
  const control = await nextTab;
  await expect(control).toHaveURL(`${baseURL}/control/`);
  await expect(
    control.getByRole("heading", { name: "Control Room", exact: true }),
  ).toBeVisible();
  for (const size of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await control.setViewportSize(size);
    await expect
      .poll(async () =>
        control.evaluate(() => {
          const header = document
            .querySelector(".app__header")!
            .getBoundingClientRect();
          const alarms = document
            .querySelector(".alarms")!
            .getBoundingClientRect();
          return alarms.top - header.bottom;
        }),
      )
      .toBeGreaterThanOrEqual(12);
    await expect
      .poll(async () =>
        control.evaluate(() => {
          const toolbar = document
            .querySelector(".panel__header")!
            .getBoundingClientRect();
          const table = document
            .querySelector(".data-table")!
            .getBoundingClientRect();
          return table.top - toolbar.bottom;
        }),
      )
      .toBeGreaterThanOrEqual(8);
    await control.locator(".data-table").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      control.getByRole("heading", { name: "Control Room", exact: true }),
    ).toBeInViewport();
    await expect(control.getByLabel("Unacknowledged only")).toBeInViewport();
    await control.screenshot({
      path: test.info().outputPath(`control-${size.width}.png`),
    });
  }
  const guideTab = context.waitForEvent("page");
  await control
    .getByRole("navigation", { name: "Project apps" })
    .getByRole("link", {
      name: "Architecture Guide (opens in a new tab)",
      exact: true,
    })
    .click();
  const guide = await guideTab;
  const errors: string[] = [];
  guide.on("pageerror", (error) => errors.push(error.message));
  await expect(guide).toHaveURL(`${baseURL}/architecture/`);
  await expect(
    guide.getByRole("heading", { name: "Threshold Monitor architecture" }),
  ).toBeVisible();
  await expect(
    guide.getByRole("navigation", { name: "Project apps" }).getByRole("link", {
      name: "Live Monitor (opens in a new tab)",
      exact: true,
    }),
  ).toHaveAttribute("href", `${baseURL}/`);
  for (const app of [page, control, guide]) {
    for (const size of [
      { width: 1280, height: 800 },
      { width: 1366, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await app.setViewportSize(size);
      await expect
        .poll(
          async () =>
            app.evaluate(
              () => document.documentElement.scrollHeight - innerHeight,
            ),
          {
            message: `Page height: ${app.url()} at ${size.width}×${size.height}`,
          },
        )
        .toBeLessThanOrEqual(1);
      if (app === page && size.width > 720) {
        await expect
          .poll(async () =>
            app
              .locator(".alert-log")
              .evaluate(
                (el) => el.getBoundingClientRect().bottom - innerHeight,
              ),
          )
          .toBeLessThanOrEqual(0);
        await expect
          .poll(async () =>
            app
              .locator(".alert-log .data-table")
              .evaluate((el) => el.clientHeight),
          )
          .toBeGreaterThan(100);
      }
    }
  }
  const styles = [];
  for (const app of [page, control, guide]) {
    if (
      app === guide &&
      (await guide
        .locator("#guide-nav-toggle")
        .getAttribute("aria-expanded")) === "false"
    ) {
      await guide.locator("#guide-nav-toggle").click();
    }
    styles.push(
      await app.evaluate(() => ({
        font: getComputedStyle(document.body).fontFamily,
        background: getComputedStyle(document.body).backgroundColor,
        accent: getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      })),
    );
    await expect(
      app
        .getByRole("navigation", { name: "Project apps" })
        .getByRole("link")
        .first(),
    ).toHaveAttribute("rel", "noopener noreferrer");
    await app.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(
        async () =>
          app.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        { message: app.url() },
      )
      .toBeLessThanOrEqual(0);
  }
  expect(styles[1]).toEqual(styles[0]);
  expect(styles[2]).toEqual(styles[0]);
  await page.screenshot({
    path: test.info().outputPath("monitor-mobile.png"),
    fullPage: true,
  });
  await guide.setViewportSize({ width: 1440, height: 1000 });
  await expect
    .poll(async () =>
      guide
        .locator(".sidebar")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(200);
  await guide.screenshot({ path: test.info().outputPath("guide-desktop.png") });
  expect(errors).toEqual([]);
  expect(policyErrors).toEqual([]);
});
