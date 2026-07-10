import { expect, test, type Page } from "@playwright/test";

// Board keyboard model (documented in docs/browser-quality.md):
//  - Every board square is a role="gridcell" with tabIndex=0; Tab moves focus
//    cell-to-cell and Enter/Space activates the focused square.
//  - Arrow-key roving grid navigation is intentionally NOT supported yet.
//  - Escape dismisses genuinely dismissible dialogs (Modal/ConfirmDialog,
//    VictoryOverlay) only. The inline Transform and Defended-King decision
//    panels are not dismissible and have no Escape path, so they cannot be
//    bypassed from the keyboard.

async function startHumanMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

test.describe("keyboard and focus", () => {
  test("the first Tab lands on a focusable control with a visible focus ring", async ({ page }) => {
    await page.goto("/");
    await page.locator("body").press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth) };
    });
    expect(focused).not.toBeNull();
    expect(["A", "BUTTON", "INPUT"]).toContain(focused!.tag);
    expect(focused!.outlineStyle).toBe("solid");
    expect(focused!.outlineWidth).toBeGreaterThanOrEqual(2);
  });

  test("Enter activates a focused control", async ({ page }) => {
    await page.goto("/");
    const primary = page.getByLabel("Start actions").getByRole("button").first();
    await primary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Start a Match" })).toBeVisible();
  });

  test("a focused board square is activated with Enter and with Space", async ({ page }) => {
    await startHumanMatch(page);
    const progress = page.getByLabel("Match controls");
    const board = page.getByRole("grid", { name: "Assalto Reale board" });
    const waitBoardIdle = () => expect(board).toHaveAttribute("aria-busy", "false");
    await expect(progress.getByText("0/26", { exact: true })).toBeVisible();

    await waitBoardIdle();
    await page.locator(".boardCell:has(.placementValid)").first().focus();
    await page.keyboard.press("Enter");
    await expect(progress.getByText("1/26", { exact: true })).toBeVisible();

    // The placement-settle animation locks the board; wait for idle so the next
    // key activation is not swallowed while aria-busy is true.
    await waitBoardIdle();
    await page.locator(".boardCell:has(.placementValid)").first().focus();
    await page.keyboard.press("Space");
    await expect(progress.getByText("2/26", { exact: true })).toBeVisible();
  });

  test("Escape closes the dismissible leave-match dialog and keeps the match", async ({ page }) => {
    await startHumanMatch(page);
    await page.getByRole("button", { name: /Leave match/i }).click();
    await expect(page.getByRole("button", { name: "Return Home" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Return Home" })).toHaveCount(0);
    // Still in the match — the board is present and placement continues.
    await expect(page.getByRole("grid", { name: "Assalto Reale board" })).toBeVisible();
  });
});
