import { expect, test, type Page } from "@playwright/test";

// Reduced-motion, forced-colors and prefers-contrast are emulated per-test with
// page.emulateMedia so they never fan the whole suite across extra projects.
// Reduced motion also has behavioural coverage in board-motion/game-feel specs;
// here we pin the CSS contract that underpins them.

async function startPlacement(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

test.describe("forced colors (Windows High Contrast)", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
  });

  test("emulation is active and controls keep a visible boundary", async ({ page }) => {
    await page.goto("/setup");
    const forced = await page.evaluate(() => window.matchMedia("(forced-colors: active)").matches);
    expect(forced).toBe(true);

    // Every control gains an explicit border once system colours flatten
    // backgrounds — assert it on a real button.
    const border = await page.getByRole("button", { name: "Start Match" }).evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(border).toBe("solid");
  });

  test("keyboard focus stays visible under forced colors", async ({ page }) => {
    await page.goto("/setup");
    await page.locator("body").press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
    expect(outline).not.toBeNull();
    expect(outline!.style).toBe("solid");
    expect(outline!.width).toBeGreaterThanOrEqual(2);
  });

  test("board state cues are remapped to system colors, not brand fills", async ({ page }) => {
    await startPlacement(page);
    // Placement targets normally use the brand green stroke (#3f7257 →
    // rgb(63, 114, 87)). Under forced colors they must resolve to a system
    // colour instead so the cue survives the OS palette takeover.
    const stroke = await page
      .locator(".placementValid")
      .first()
      .evaluate((el) => getComputedStyle(el).stroke);
    expect(stroke).not.toBe("");
    expect(stroke).not.toBe("rgb(63, 114, 87)");
  });
});

test.describe("increased contrast preference", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ contrast: "more" });
  });

  test("neutral text ramp darkens under prefers-contrast: more", async ({ page }) => {
    await page.goto("/settings");
    const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim());
    expect(muted).toBe("#333b34");
  });
});

test.describe("reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the reduced-motion catch-all neutralises transitions", async ({ page }) => {
    await page.goto("/setup");
    // The global `@media (prefers-reduced-motion: reduce)` rule forces every
    // element's transition-duration to 1ms, so animations never translate.
    const duration = await page.getByRole("button", { name: "Start Match" }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration).toBe("0.001s");
  });
});
