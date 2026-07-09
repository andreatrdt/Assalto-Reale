import { expect, test } from "@playwright/test";

test.describe("game-feel settings", () => {
  test("Settings exposes sound controls that persist across reload", async ({ page }) => {
    await page.goto("/settings");

    const sound = page.getByRole("checkbox", { name: /Sound effects/i });
    await expect(sound).toBeVisible();
    await expect(sound).toBeChecked(); // default enabled
    await expect(page.getByRole("slider", { name: /Volume/i })).toBeVisible();

    await sound.click();
    await expect(sound).not.toBeChecked();

    await page.reload();
    await expect(page.getByRole("checkbox", { name: /Sound effects/i })).not.toBeChecked();
  });

  test("reduced-motion preference applies to the document and persists", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("checkbox", { name: /Reduce motion/i }).click();

    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.motion)).toBe("reduced");

    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.motion)).toBe("reduced");
  });
});
