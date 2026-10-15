import { expect, test } from "@playwright/test";

// The whole flow across both apps and the relay, as a user sees it.
test("an alarm goes from the monitor to the control room and back", async ({
  browser,
}) => {
  const control = await (await browser.newContext()).newPage();
  const monitor = await (await browser.newContext()).newPage();

  // 1. The operator signs in to the control room.
  await control.goto("/control/");
  await expect(control.getByText("Connected", { exact: true })).toBeVisible();
  await control.getByLabel("Operator name").fill("Ada");
  await control.getByRole("button", { name: "Save" }).click();
  await expect(control.getByText("Acknowledging as Ada.")).toBeVisible();

  // 2. The monitor runs fast, fixed data until the relay accepts an alert.
  await monitor.goto("/?rate=10&seed=7");
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

  // 4. Acknowledge the newest alarm; the monitor learns who did it.
  await control
    .getByRole("button", { name: /^Acknowledge / })
    .first()
    .click();
  await expect(control.getByText(/^Acknowledged by Ada at/)).toHaveCount(1);
  await expect(
    monitor.locator(".chip--acknowledged", { hasText: "Acknowledged by Ada" }),
  ).toHaveCount(1);

  // 5. No duplicate rows on either side.
  await expect(controlRows).toHaveCount(count);
  await expect(monitorRows).toHaveCount(count);
});
