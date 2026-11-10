import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

// The WCAG 2.2 AA rules and axe's best practices, as the E2E accessibility
// audit runs them.
const axeTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
  "best-practice",
];

/**
 * Runs axe over the elements the selectors match in a Bun browser test page
 * and lists each violation with the elements it found, so a failed
 * `toEqual([])` names what to fix.
 */
export async function readAxeViolations(
  page: Page,
  include: readonly string[]
) {
  // Legacy mode runs axe inside the page instead of opening a page of its
  // own, which a page from `browser.newPage()` cannot do. It skips only
  // cross-origin frames, which the harness pages have none of.
  const builder = new AxeBuilder({ page }).withTags(axeTags).setLegacyMode();
  for (const selector of include) builder.include(selector);
  const { violations } = await builder.analyze();
  return violations.map(
    ({ help, id, nodes }) =>
      `${id}: ${help} (${nodes.map(({ target }) => target.join(" ")).join(", ")})`
  );
}
