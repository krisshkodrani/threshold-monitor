import { expect, test, type Page } from "@playwright/test";

/** The relay's login page; DEMO_USERS gives "operator", "monitor" and "demo" (password "demo"). */
async function logIn(page: Page, username: string) {
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Sign in" }).click();
}

// The whole flow across both apps and the relay, as a user sees it.
test("an alarm goes from the monitor to the control room and back", async ({
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

  // 2. The monitor signs in and runs fast, fixed data until the relay accepts an alert.
  await monitor.goto("/?rate=10&seed=7");
  await logIn(monitor, "monitor");
  await expect(monitor).toHaveURL(/\/\?rate=10&seed=7$/);
  await expect(monitor.getByText("Connected", { exact: true })).toBeVisible();
  await expect(monitor.locator(".chip--accepted").first()).toBeVisible({
    timeout: 30_000,
  });
  await monitor.getByRole("button", { name: "Pause" }).click();

  // 3. Every accepted alert is in the control room, exactly once.
  const monitorRows = monitor.locator("tbody tr");
  const controlRows = control.locator("tbody tr");
  await expect(monitor.locator(".chip--queued, .chip--sent")).toHaveCount(0);
  const count = await monitorRows.count();
  await expect(controlRows).toHaveCount(count);

  // 4. Acknowledge the newest alarm; the monitor learns who did it, by the
  //    name from the operator's session.
  await control
    .getByRole("button", { name: /^Acknowledge / })
    .first()
    .click();
  await expect(
    control.getByText(/^Acknowledged by Demo Operator at/),
  ).toHaveCount(1);
  await expect(
    monitor.locator(".chip--acknowledged", {
      hasText: "Acknowledged by Demo Operator",
    }),
  ).toHaveCount(1);

  // 5. No duplicate rows on either side.
  await expect(controlRows).toHaveCount(count);
  await expect(monitorRows).toHaveCount(count);

  // 6. Log out: back to the login page, and the session is gone.
  await control.getByRole("button", { name: "Log out" }).click();
  await expect(control).toHaveURL(/\/login\?next=%2Fcontrol%2F$/);
  expect((await control.request.get("/api/session")).status()).toBe(401);
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
