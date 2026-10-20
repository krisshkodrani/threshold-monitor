import { expect, test, type Page } from "@playwright/test";

/** The relay's login page; DEMO_USERS gives "operator", "monitor" and "demo" (password "demo"). */
async function logIn(page: Page, username: string) {
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** The <dd> value next to a <dt> label in the monitor's readout. */
const readout = (page: Page, label: string) =>
  page
    .locator("dt", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd");

// The whole flow: the sensor agent makes the readings and the alerts; the
// monitor shows them; an operator acknowledges in the control room.
test("an alarm goes from the sensor to the control room and back to the monitor", async ({
  browser,
}) => {
  const control = await (await browser.newContext()).newPage();
  const monitor = await (await browser.newContext()).newPage();

  // 1. The operator signs in; the login page returns to the control room.
  await control.goto("/control/");
  await logIn(control, "operator");
  await expect(control).toHaveURL(/\/control\/$/);
  await expect(control.getByText("Connected", { exact: true })).toBeVisible();
  await expect(control.getByText("Signed in as Demo Operator")).toBeVisible();

  // 2. The monitor shows the sensor's live data and its alerts.
  await monitor.goto("/");
  await logIn(monitor, "monitor");
  await expect(monitor).toHaveURL(/\/$/);
  await expect(monitor.getByText("Connected", { exact: true })).toBeVisible();
  await expect(monitor.getByText("Sensor 1 · online")).toBeVisible();
  await expect(readout(monitor, "Current")).toHaveText(/°C$/);
  await expect(monitor.locator(".chip--received").first()).toBeVisible({
    timeout: 30_000,
  });

  // 3. Acknowledge the newest open alarm. The table must not move: the
  //    columns keep their widths and the acknowledged row keeps its height.
  // Live data: wait for an open alarm (earlier runs may have acknowledged all).
  const button = control.getByRole("button", { name: /^Acknowledge / }).first();
  await expect(button).toBeEnabled({ timeout: 30_000 });
  // The alarm's row, found again by its key after the ack and live updates.
  const key = await button.evaluate(
    (el) => el.closest("tr")?.dataset.key ?? "",
  );
  expect(key).not.toBe("");
  const row = control.locator(`tbody tr[data-key="${key}"]`);
  const layout = async () => ({
    columns: await control.evaluate(() =>
      [...document.querySelectorAll("thead th")].map(
        (th) => th.getBoundingClientRect().width,
      ),
    ),
    rowHeight: (await row.boundingBox())?.height,
  });
  const before = await layout();
  await row.getByRole("button", { name: /^Acknowledge / }).click();
  await expect(row).toContainText("Acknowledged by Demo Operator");
  expect(await layout()).toEqual(before);

  // 4. The monitor learns who did it, by the name from the operator's session.
  await expect(
    monitor
      .locator(".chip--acknowledged", {
        hasText: "Acknowledged by Demo Operator",
      })
      .first(),
  ).toBeVisible();

  // 5. Log out: back to the login page, and the session is gone.
  await control.getByRole("button", { name: "Log out" }).click();
  await expect(control).toHaveURL(/\/login\?next=%2Fcontrol%2F$/);
  expect((await control.request.get("/api/session")).status()).toBe(401);
});

test("two monitor tabs show the same data and share the settings", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto("/");
  await logIn(first, "monitor");
  await expect(first.getByText("Connected", { exact: true })).toBeVisible();
  const second = await context.newPage(); // the same session cookie
  await second.goto("/");
  await expect(second.getByText("Connected", { exact: true })).toBeVisible();

  // The same reading arrives in both tabs at the same time.
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([
        readout(first, "Current").textContent(),
        readout(second, "Current").textContent(),
      ]);
      return a !== null && a !== "—" && a === b;
    })
    .toBe(true);

  // A threshold change in one tab reaches the other through the relay.
  const input = first.getByLabel("Threshold (°C)");
  await input.fill("23.4");
  await input.press("Enter");
  await expect(readout(second, "Threshold")).toHaveText("23.4 °C");
  await expect(second.getByLabel("Threshold (°C)")).toHaveValue("23.4");
  await second.getByText("Sensor details", { exact: true }).click();
  await expect(
    second.getByText(/Settings changed by Demo Monitor/),
  ).toBeVisible();
});

test("a user without the role cannot use the control room", async ({
  page,
}) => {
  await page.goto("/control/");
  await logIn(page, "monitor");
  await expect(page.getByRole("alert")).toHaveText(
    "This account cannot use the control room.",
  );
});

test("a wrong password stays on the login page", async ({ page }) => {
  await page.goto("/control/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill("operator");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Wrong username or password.",
  );
});
