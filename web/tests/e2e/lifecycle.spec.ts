import { expect, test, type Page } from "@playwright/test";

async function startHumanMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

async function placeValid(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) {
    await page.locator(".boardCell:has(.placementValid)").first().click();
  }
}

async function completePlacement(page: Page) {
  // Click valid squares until the match begins (Pass appears), bounded.
  for (let i = 0; i < 30; i += 1) {
    if (
      await page
        .getByRole("button", { name: "Pass" })
        .isVisible()
        .catch(() => false)
    )
      return;
    await page.locator(".boardCell:has(.placementValid)").first().click();
  }
}

test.describe("match lifecycle persistence", () => {
  test("save an active match, reload the page, restore from local storage and continue", async ({ page }) => {
    await startHumanMatch(page);
    await completePlacement(page);
    await expect(page.getByRole("button", { name: "Pass" })).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();

    // Full page reload clears the in-memory store, so this proves localStorage restore.
    await page.reload();
    await page.goto("/load");
    await page.getByRole("button", { name: "Continue" }).click();

    // Restored into an active playing match.
    await expect(page.getByRole("button", { name: "Pass" })).toBeVisible();
    await expect(page.getByText(/to move/)).toBeVisible();

    // Continuation: a legal move is still accepted.
    const blackCells = page.locator(".boardCell:has(.pieceBlack)");
    const count = await blackCells.count();
    for (let i = 0; i < count; i += 1) {
      await blackCells.nth(i).click();
      if ((await page.locator(".moveIndicator").count()) > 0) break;
    }
    await page.locator(".boardCell:has(.moveIndicator)").first().click();
    await expect(page.getByRole("button", { name: "Pass" })).toBeVisible();
  });

  test("save during placement, reload, restore and finish placement into a started match", async ({ page }) => {
    await startHumanMatch(page);
    await placeValid(page, 5);

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Match controls").getByText("Game saved locally.")).toBeVisible();

    await page.reload();
    await page.goto("/load");
    await page.getByRole("button", { name: "Continue" }).click();

    // Restored mid-placement.
    await expect(page.getByText(/is placing/)).toBeVisible();

    // Finish placement; the match begins exactly once.
    await completePlacement(page);
    await expect(page.getByRole("button", { name: "Pass" })).toBeVisible();
  });
});
