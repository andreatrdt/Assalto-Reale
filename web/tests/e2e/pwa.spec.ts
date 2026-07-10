import { expect, test, type Page } from "@playwright/test";

// Runs against the production preview (the Playwright webServer), where the
// service worker actually registers. Each test gets a fresh context, so cache
// and storage are isolated; we still wait for the worker to reach `activated`
// before asserting so we never race an install.

async function waitForActivatedWorker(page: Page) {
  await page.waitForFunction(
    async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg && reg.active && reg.active.state === "activated");
    },
    null,
    { timeout: 20_000 },
  );
}

test.describe("PWA and offline", () => {
  test("registers a service worker that reaches the activated state", async ({ page }) => {
    await page.goto("/");
    await waitForActivatedWorker(page);
    const controlled = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { active: reg?.active?.state ?? null };
    });
    expect(controlled.active).toBe("activated");
  });

  test("links and serves a valid web app manifest with resolvable icons", async ({ page }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBeTruthy();

    const manifestUrl = new URL(href!, page.url()).toString();
    const manifestResponse = await page.request.get(manifestUrl);
    expect(manifestResponse.ok()).toBeTruthy();

    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe("Assalto Reale");
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeTruthy();

    // Every declared icon must actually resolve.
    for (const icon of manifest.icons) {
      const iconUrl = new URL(icon.src, manifestUrl).toString();
      const iconResponse = await page.request.get(iconUrl);
      expect(iconResponse.ok(), `icon ${icon.src}`).toBeTruthy();
    }
  });

  test("serves the app shell when the network is offline", async ({ page }) => {
    const context = page.context();
    await page.goto("/");
    await waitForActivatedWorker(page);

    // Reload once online so the shell + hashed assets are cached through the
    // now-controlling worker, then drop the network and reload again.
    await page.reload();
    await page.waitForLoadState("networkidle");

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Assalto Reale" })).toBeVisible();
    await context.setOffline(false);
  });
});
