import { expect, test, type Page } from "@playwright/test";

async function startManualMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

test.describe("board motion presentation", () => {
  test("manual placement exposes a deterministic running-to-idle lifecycle", async ({ page }) => {
    await startManualMatch(page);
    const board = page.locator(".assaltoBoard");
    await expect(board).toHaveAttribute("data-animation-state", "idle");

    const observedMotion = page.evaluate(
      () =>
        new Promise<{ type: string; id: string }>((resolve, reject) => {
          const element = document.querySelector<SVGElement>(".assaltoBoard");
          if (!element) {
            reject(new Error("Board was not rendered"));
            return;
          }

          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error("Board animation did not enter the running state"));
          }, 2_000);

          const observer = new MutationObserver(() => {
            if (element.dataset.animationState !== "running") return;
            window.clearTimeout(timeout);
            observer.disconnect();
            resolve({
              type: element.dataset.animationType ?? "",
              id: element.dataset.animationId ?? "",
            });
          });
          observer.observe(element, {
            attributes: true,
            attributeFilter: ["data-animation-state", "data-animation-type", "data-animation-id"],
          });
        }),
    );

    await page.locator(".boardCell:has(.placementValid)").first().click();
    const observed = await observedMotion;
    expect(observed).toMatchObject({ type: "place" });
    expect(Number(observed.id)).toBeGreaterThan(0);

    await expect(board).toHaveAttribute("data-animation-state", "idle");
    await expect(page.getByLabel("Match controls").getByText("1/26", { exact: true })).toBeVisible();
  });

  test("reduced motion still exposes the final state without a long translation", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "assalto-reale-ui-settings",
        JSON.stringify({
          reducedMotion: true,
          highContrastBoard: false,
          soundEnabled: false,
          volume: 0.6,
        }),
      );
    });
    await startManualMatch(page);

    const board = page.locator(".assaltoBoard");
    await page.locator(".boardCell:has(.placementValid)").first().click();
    await expect(board).toHaveAttribute("data-animation-state", "idle", { timeout: 1_000 });
    await expect(page.getByLabel("Match controls").getByText("1/26", { exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  });
});
