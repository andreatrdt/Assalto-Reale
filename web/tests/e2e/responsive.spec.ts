import { expect, test, type Page } from "@playwright/test";

// A small, stable set of viewports exercised via setViewportSize (not extra
// projects). Exhaustive resolution matrices are intentionally avoided — the
// uncovered sizes are noted as a limitation in docs/browser-quality.md.

async function startHumanMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

async function hasNoHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test.describe("responsive layout", () => {
  test("desktop (1366) is board-first with the panel beside the board", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await startHumanMatch(page);

    const boardArea = await page.locator(".gameBoardArea").boundingBox();
    const panel = await page.locator(".gamePanel").boundingBox();
    expect(boardArea).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(boardArea!.x).toBeLessThan(panel!.x);
    expect(boardArea!.width).toBeGreaterThan(panel!.width);
    expect(await hasNoHorizontalScroll(page)).toBeTruthy();
  });

  for (const { name, width, height } of [
    { name: "tablet portrait", width: 768, height: 1024 },
    { name: "tablet landscape", width: 1024, height: 768 },
  ]) {
    test(`${name} (${width}x${height}) fits without horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await startHumanMatch(page);

      await expect(page.locator(".gameBoardArea")).toBeVisible();
      await expect(page.getByRole("grid", { name: "Assalto Reale board" })).toBeVisible();
      // Core controls stay reachable at tablet widths.
      await expect(page.getByRole("button", { name: /Leave match/i })).toBeVisible();
      expect(await hasNoHorizontalScroll(page)).toBeTruthy();
    });
  }

  test("mobile (360) stacks status, board, then panel without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await startHumanMatch(page);

    const status = await page.locator(".gameStatus").boundingBox();
    const boardArea = await page.locator(".gameBoardArea").boundingBox();
    const panel = await page.locator(".gamePanel").boundingBox();
    expect(status!.y).toBeLessThan(boardArea!.y);
    expect(boardArea!.y).toBeLessThan(panel!.y);
    expect(await hasNoHorizontalScroll(page)).toBeTruthy();
  });
});
