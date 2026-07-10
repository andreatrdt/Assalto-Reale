import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercises import/export through the real LoadPage UI (download capture + the
// actual <input type="file">), complementing the unit-level persistence tests.

// A full-document navigation (page.goto) resets the in-memory store, so the
// "Export Current Match" button (gated on an in-memory active match) would be
// disabled on /load. We instead Save first and export the persisted save via
// the save card's "Export" button, which reads localStorage and is the durable
// UI path a returning user takes.
async function startAndSaveMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
  await page.locator(".boardCell:has(.placementValid)").first().click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Match controls").getByText("Game saved locally.")).toBeVisible();
}

test.describe("save import/export via the UI", () => {
  test("exporting a saved match downloads valid save JSON", async ({ page }) => {
    await startAndSaveMatch(page);
    await page.goto("/load");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^assalto-reale-saved-match-.*\.json$/);
    const json = JSON.parse(readFileSync(await download.path(), "utf8"));
    expect(json.board).toBeTruthy();
    expect([1, 2]).toContain(json.schema);
  });

  test("a UI-exported save re-imports through the file input and loads the match", async ({ page }) => {
    await startAndSaveMatch(page);
    await page.goto("/load");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const content = readFileSync(await (await downloadPromise).path(), "utf8");

    const file = join(mkdtempSync(join(tmpdir(), "assalto-save-")), "match.json");
    writeFileSync(file, content);

    // Drop the in-memory match, then import the file through the real input.
    await page.evaluate(() => window.localStorage.clear());
    await page.goto("/load");
    await page.locator('input[type="file"]').setInputFiles(file);

    // A valid import restores the match and routes into the board.
    await expect(page.getByRole("grid", { name: "Assalto Reale board" })).toBeVisible();
  });

  test("importing invalid JSON surfaces an error and stays on the load page", async ({ page }) => {
    await page.goto("/load");

    const file = join(mkdtempSync(join(tmpdir(), "assalto-bad-")), "broken.json");
    writeFileSync(file, "{ this is not a valid save ");
    await page.locator('input[type="file"]').setInputFiles(file);

    await expect(page.getByText("Imported save is invalid or unsupported.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Saved Matches" })).toBeVisible();
  });
});
