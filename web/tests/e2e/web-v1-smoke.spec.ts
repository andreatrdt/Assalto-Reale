import { expect, test } from "@playwright/test";

test.describe("web v1 smoke flows", () => {
  test("renders all primary routes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();

    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Configure Battle" })).toBeVisible();

    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "Rules Of Assalto Reale" })).toBeVisible();

    await page.goto("/load");
    await expect(page.getByRole("heading", { name: "Continue A Match" })).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("starts a Human versus Human Quick Balanced match", async ({ page }) => {
    await page.goto("/setup");
    await page.getByRole("button", { name: /Quick Balanced/i }).click();
    await page.getByRole("button", { name: "Start Match" }).click();

    await expect(page.getByRole("button", { name: "Pass" })).toBeVisible();
    await expect(page.getByText("Quick Balanced deployment complete.")).toBeVisible();
  });

  test("manual placement shows invalid feedback and can be saved", async ({ page }) => {
    await page.goto("/setup");
    await page.getByRole("button", { name: "Start Match" }).click();

    await expect(page.getByText("Manual Placement")).toBeVisible();
    await page.getByRole("gridcell", { name: /^I12/ }).click();
    await expect(page.getByLabel("Board and current status").getByText(/left half/i)).toBeVisible();

    await page.getByRole("gridcell", { name: /^A12/ }).click();
    await expect(page.getByLabel("Board and current status").getByText(/White: place King/i)).toBeVisible();

    await page.getByRole("button", { name: "Save Deployment" }).click();
    await expect(page.getByLabel("Board and current status").getByText("Game saved locally.")).toBeVisible();
  });

  test("configured clock counts down during active human play", async ({ page }) => {
    await page.goto("/setup");
    await page.getByRole("button", { name: "5 minutes", exact: true }).click();
    await page.getByRole("button", { name: /Quick Balanced/i }).click();
    await page.getByRole("button", { name: "Start Match" }).click();

    await expect(page.getByText("5:00").first()).toBeVisible();
    await expect(page.getByText("4:59").first()).toBeVisible({ timeout: 2500 });
  });
});
