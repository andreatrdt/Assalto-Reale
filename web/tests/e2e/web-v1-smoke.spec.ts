import { expect, test } from "@playwright/test";

test.describe("web v1 smoke flows", () => {
  test("renders all primary routes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();

    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Start a Match" })).toBeVisible();

    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "Rules Of Assalto Reale" })).toBeVisible();

    await page.goto("/load");
    await expect(page.getByRole("heading", { name: "Continue A Match" })).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("public setup hides Quick Balanced and difficulty and enters manual placement", async ({ page }) => {
    await page.goto("/setup");

    await expect(page.getByRole("button", { name: /Quick Balanced/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Easy" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hard" })).toHaveCount(0);
    await expect(page.getByText("Manual placement · Transform enabled")).toBeVisible();

    await page.getByRole("button", { name: "Start Match" }).click();
    await expect(page.getByText("Manual Placement")).toBeVisible();
  });

  test("side selection appears only against the computer, difficulty never does", async ({ page }) => {
    await page.goto("/setup");

    // Human opponent (default): no side choice.
    await expect(page.getByRole("button", { name: "Random" })).toHaveCount(0);

    await page.getByRole("button", { name: "Computer" }).click();
    await expect(page.getByRole("button", { name: "Black" })).toBeVisible();
    await expect(page.getByRole("button", { name: "White" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Random" })).toBeVisible();

    // Difficulty stays hidden in every case.
    await expect(page.getByRole("button", { name: "Easy" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Medium" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hard" })).toHaveCount(0);
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

  test("Home offers Continue Last Match only after a match has started", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue Last Match" })).toHaveCount(0);

    await page.goto("/setup");
    await page.getByRole("button", { name: "Start Match" }).click();
    await expect(page.getByText("Manual Placement")).toBeVisible();

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Return Home" }).click();

    await expect(page.getByRole("button", { name: "Continue Last Match" })).toBeVisible();
  });

  test("selected timer preset is applied to the new match", async ({ page }) => {
    await page.goto("/setup");
    await page.getByRole("button", { name: "5 minutes", exact: true }).click();
    await page.getByRole("button", { name: "Start Match" }).click();

    await expect(page.getByText("Manual Placement")).toBeVisible();
    await expect(page.getByText("5:00").first()).toBeVisible();
  });
});
