import { expect, test, type Page } from "@playwright/test";

async function startHumanMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

async function completePlacement(page: Page) {
  for (let i = 0; i < 26; i += 1) {
    await page.locator(".boardCell:has(.placementValid)").first().click();
  }
}

test.describe("web v1 smoke flows", () => {
  test("renders all primary routes", async ({ page }) => {
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

  test("public setup hides Quick Balanced and difficulty and enters manual placement", async ({ page }) => {
    await page.goto("/setup");

    await expect(page.getByRole("button", { name: /Quick Balanced/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Easy" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hard" })).toHaveCount(0);
    await expect(page.getByText("Manual placement · Transform enabled")).toBeVisible();

    await page.getByRole("button", { name: "Start Match" }).click();
    await expect(page.getByText("Black is placing a King")).toBeVisible();
  });

  test("side selection appears only against the computer, difficulty never does", async ({ page }) => {
    await page.goto("/setup");

    await expect(page.getByRole("button", { name: "Random" })).toHaveCount(0);

    await page.getByRole("button", { name: "Computer" }).click();
    await expect(page.getByRole("button", { name: "Black" })).toBeVisible();
    await expect(page.getByRole("button", { name: "White" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Random" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Easy" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Medium" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hard" })).toHaveCount(0);
  });

  test("manual placement shows invalid feedback and can be saved", async ({ page }) => {
    await startHumanMatch(page);

    await page.getByRole("gridcell", { name: /^I12/ }).click();
    await expect(page.getByLabel("Match controls").getByText(/left half/i)).toBeVisible();

    await page.getByRole("gridcell", { name: /^A12/ }).click();
    await expect(page.getByLabel("Match controls").getByText(/White: place King/i)).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Match controls").getByText("Game saved locally.")).toBeVisible();
  });

  test("undo reverts a manual placement", async ({ page }) => {
    await startHumanMatch(page);

    await expect(page.getByLabel("Match controls").getByText("0/26", { exact: true })).toBeVisible();
    await page.locator(".boardCell:has(.placementValid)").first().click();
    await expect(page.getByLabel("Match controls").getByText("1/26", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Match controls").getByText("0/26", { exact: true })).toBeVisible();
  });

  test("Home offers Resume Match only after a match has started", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume Match" })).toHaveCount(0);

    await startHumanMatch(page);

    await page.getByRole("button", { name: /Leave match/i }).click();
    await page.getByRole("button", { name: "Return Home" }).click();

    await expect(page.getByRole("button", { name: "Resume Match" })).toBeVisible();
  });

  test("selected timer preset is shown during the match", async ({ page }) => {
    await page.goto("/setup");
    await page.getByRole("button", { name: "5 minutes", exact: true }).click();
    await page.getByRole("button", { name: "Start Match" }).click();

    await expect(page.getByText("Black is placing a King")).toBeVisible();
    await expect(page.getByText("5:00").first()).toBeVisible();
  });

  test("desktop game layout is board-first", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await startHumanMatch(page);

    const boardArea = await page.locator(".gameBoardArea").boundingBox();
    const panel = await page.locator(".gamePanel").boundingBox();
    expect(boardArea).not.toBeNull();
    expect(panel).not.toBeNull();
    // Board sits left of the compact panel and is the larger area.
    expect(boardArea!.x).toBeLessThan(panel!.x);
    expect(boardArea!.width).toBeGreaterThan(panel!.width);
    await expect(page.getByText("Command table")).toHaveCount(0);
  });

  test("mobile game layout stacks status, board, then panel with no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await startHumanMatch(page);

    const status = await page.locator(".gameStatus").boundingBox();
    const boardArea = await page.locator(".gameBoardArea").boundingBox();
    const panel = await page.locator(".gamePanel").boundingBox();
    expect(status!.y).toBeLessThan(boardArea!.y);
    expect(boardArea!.y).toBeLessThan(panel!.y);

    const noHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noHorizontalScroll).toBeTruthy();
  });

  test("completing manual placement reaches board-first active play", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await startHumanMatch(page);
    await completePlacement(page);

    await expect(page.getByRole("button", { name: "Pass" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();

    const boardArea = await page.locator(".gameBoardArea").boundingBox();
    const panel = await page.locator(".gamePanel").boundingBox();
    expect(boardArea!.width).toBeGreaterThan(panel!.width);
  });
});
