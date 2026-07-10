import { expect, test, type Page } from "@playwright/test";

// A deliberately small smoke suite run across Firefox and WebKit (see the
// firefox/webkit projects in playwright.config.ts). It covers engine-agnostic
// core journeys only — deep behavioural coverage stays on Chromium to keep the
// cross-browser matrix cheap and stable.

async function startHumanMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

test.describe("cross-browser smoke", () => {
  test("primary routes render", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Start a Match" })).toBeVisible();
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "How to Play" })).toBeVisible();
    await page.goto("/load");
    await expect(page.getByRole("heading", { name: "Saved Matches" })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("a match starts and the board accepts a placement", async ({ page }) => {
    await startHumanMatch(page);
    const progress = page.getByLabel("Match controls");
    await expect(progress.getByText("0/26", { exact: true })).toBeVisible();

    await page.locator(".boardCell:has(.placementValid)").first().click();
    await expect(progress.getByText("1/26", { exact: true })).toBeVisible();
  });

  test("a saved match survives a reload", async ({ page }) => {
    await startHumanMatch(page);
    await page.locator(".boardCell:has(.placementValid)").first().click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Match controls").getByText("Game saved locally.")).toBeVisible();

    await page.goto("/load");
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  });
});
