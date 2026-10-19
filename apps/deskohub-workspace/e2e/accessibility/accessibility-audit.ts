import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";

const axeTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
  "best-practice",
];

export const auditedLocales = ["en-US", "cs-CZ"] as const;
export type AuditedLocale = (typeof auditedLocales)[number];

/** Opens a page and waits until its streamed content stopped loading. */
export async function openSettledPage(page: Page, path: string) {
  await page.goto(path, { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", /^(en-US|cs-CZ)$/);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, {
    timeout: workspaceE2ETimeouts.browserNavigation,
  });
}

export async function expectAxeClean(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();

  if (results.violations.length > 0) {
    await testInfo.attach("axe-results", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
  }

  expect(
    results.violations,
    results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`
      )
      .join("\n")
  ).toEqual([]);
}
