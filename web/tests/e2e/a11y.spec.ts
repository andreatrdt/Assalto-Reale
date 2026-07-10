import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Accessibility gate. We fail the build on `serious`/`critical` axe violations;
// `minor`/`moderate` are surfaced in the report but do not block, so the gate
// stays actionable rather than noisy. WCAG 2.0/2.1 A + AA tags scope the rules
// to the levels we commit to.
const IMPACT_BLOCKING = new Set(["serious", "critical"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function analyze(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.filter((violation) => IMPACT_BLOCKING.has(violation.impact ?? ""));
}

function formatViolations(violations: Awaited<ReturnType<typeof analyze>>) {
  return violations.map((violation) => `${violation.id} (${violation.impact}) — ${violation.help}`).join("\n");
}

async function startHumanMatch(page: Page) {
  await page.goto("/setup");
  await page.getByRole("button", { name: "Start Match" }).click();
  await expect(page.getByText("Black is placing a King")).toBeVisible();
}

const primaryRoutes = [
  { path: "/", heading: "Assalto Reale" },
  { path: "/setup", heading: "Start a Match" },
  { path: "/rules", heading: "How to Play" },
  { path: "/load", heading: "Saved Matches" },
  { path: "/settings", heading: "Settings" },
];

test.describe("accessibility", () => {
  for (const route of primaryRoutes) {
    test(`no serious or critical axe violations on ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();

      const violations = await analyze(page);
      expect(violations, formatViolations(violations)).toEqual([]);
    });
  }

  test("no serious or critical axe violations during an active match", async ({ page }) => {
    await startHumanMatch(page);
    // The interactive board (role="grid" with gridcells) is the densest ARIA
    // surface in the app; assert it clears the same bar as the static routes.
    await expect(page.getByRole("grid", { name: "Assalto Reale board" })).toBeVisible();

    const violations = await analyze(page);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});
