import { expect, test, type Page } from "@playwright/test";

// The AI runs on a paced setTimeout loop (GamePage) whose effect cleanup flips a
// `cancelled` flag; leaving a match must tear that loop down so no stale AI
// callback fires against an unmounted board. The pure motion-cancellation logic
// (reset/reduced-motion) is unit-tested in boardMotion.test.ts and exercised
// behaviourally in board-motion.spec.ts; this spec covers the runtime teardown,
// which cannot be observed through the node/SSR unit setup.

async function startComputerMatchAsWhite(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Computer" }).click();
  // Human plays White → the AI owns Black, which places first, so the paced AI
  // loop is already running the moment the match starts.
  await page.getByRole("button", { name: "White", exact: true }).click();
  await page.getByRole("button", { name: "Start Match" }).click();
}

test.describe("AI teardown", () => {
  test("leaving a match mid-AI-turn cancels the paced loop without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await startComputerMatchAsWhite(page);

    // Confirm the AI is actively placing (progress advances on its own) so the
    // teardown happens while a callback is genuinely scheduled.
    const progress = page.getByLabel("Match controls").getByText(/\/26/);
    await expect(progress).toBeVisible();
    await expect.poll(async () => Number((await progress.textContent())?.split("/")[0] ?? 0), { timeout: 8000 }).toBeGreaterThan(0);

    // Leave while the loop is still scheduled.
    await page.getByRole("button", { name: /Leave match/i }).click();
    await page.getByRole("button", { name: "Return Home" }).click();
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();

    // Give any stale paced callback more than one interval to (not) fire.
    await page.waitForTimeout(1200);
    expect(errors, errors.join("\n")).toEqual([]);

    // The home screen stays stable — no phantom navigation back into a match.
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();
  });
});
