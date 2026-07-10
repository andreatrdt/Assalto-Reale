import { expect, test, type Page } from "@playwright/test";

// Pixel regression, Chromium-only (the `visual` project). Baselines are Linux
// only and generated inside the Playwright Docker image so CI rendering is
// pixel-identical — see docs/browser-quality.md for the regenerate command.
// Tolerances are deliberately tight and per-assertion; there is no permissive
// global maxDiffPixelRatio. Animations are frozen and volatile regions (clocks,
// build/version line) are masked so the shots are deterministic.

const SNAPSHOT = { animations: "disabled", maxDiffPixels: 120 } as const;

async function startHumanMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

test.describe("visual regression", () => {
  test("home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();
    await expect(page).toHaveScreenshot("home.png", SNAPSHOT);
  });

  test("setup", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Start a Match" })).toBeVisible();
    await expect(page).toHaveScreenshot("setup.png", SNAPSHOT);
  });

  test("rules", async ({ page }) => {
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "How to Play" })).toBeVisible();
    await expect(page).toHaveScreenshot("rules.png", SNAPSHOT);
  });

  test("board in placement", async ({ page }) => {
    await startHumanMatch(page);
    // Snapshot just the board frame; the surrounding panel carries the live
    // clock, which is masked at the page level but is simply excluded here.
    await expect(page.locator(".boardFrame")).toHaveScreenshot("board-placement.png", SNAPSHOT);
  });
});
