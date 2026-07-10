import { expect, test } from "@playwright/test";

test.describe("invite multiplayer shell", () => {
  test("Home exposes Play Online and the host/join route", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Play Online" })).toBeVisible();

    await page.getByRole("button", { name: "Play Online" }).click();
    await expect(page).toHaveURL(/\/online$/);
    await expect(page.getByRole("heading", { name: "Play Online" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create a private match" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Enter an invite code" })).toBeVisible();
  });

  test("unconfigured deployments fail closed without hiding the feature", async ({ page }) => {
    await page.goto("/online");
    await expect(page.getByText("Server not configured")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Online Match" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Join Match" })).toBeDisabled();
    await expect(page.getByLabel("Invite code")).toBeVisible();
  });

  test("mobile host/join layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/online");

    const noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noHorizontalScroll).toBeTruthy();
  });
});
