import { expect, test } from "@playwright/test";

test.describe("account foundation", () => {
  test("guest-only builds expose account status without gating private play", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Continue without an account" })).toBeVisible();
    await expect(page.getByText("Registered accounts are not configured")).toBeVisible();
    await expect(page.getByText(/rating|leaderboard|match history/i)).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: "Play online as guest" })).toBeVisible();
    await page.getByRole("button", { name: "Play online as guest" }).click();
    await expect(page).toHaveURL(/\/online$/);
    await expect(page.getByRole("heading", { name: "Create a private match" })).toBeVisible();
  });
});
