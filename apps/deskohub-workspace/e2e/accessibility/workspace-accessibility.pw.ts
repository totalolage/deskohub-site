import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { enablePreviewAccess } from "../instant-navigation/navigation-test-helpers";

const axeTags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
  "best-practice",
];

const locales = ["en-US", "cs-CZ"] as const;
const auditedPaths = [
  "",
  "/contact",
  "/gallery",
  "/meeting-room",
  "/ttrpg-room",
  "/privacy-policy",
  "/marketing-communications",
  "/terms-and-conditions",
  "/operating-rules",
  "/cookie-policy",
  "/cookie-settings",
  "/logo",
  "/email-preview/contact-business",
  "/email-preview/contact-confirmation",
  "/email-preview/customer-reservation",
  "/email-preview/reservation-notification",
  "/reservation/cowork",
  "/reservation/meeting-room",
  "/reservation/office",
  "/checkout/pay",
  "/accessibility-audit-missing-page",
  ...(process.env.WORKSPACE_E2E_BASE_URL
    ? (["/dotypos-tables", "/map-preview"] as const)
    : []),
] as const;

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

for (const locale of locales) {
  for (const path of auditedPaths) {
    test(`${locale}${path || "/"} has no detectable accessibility violations`, async ({
      page,
    }, testInfo) => {
      await openSettledPage(page, `/${locale}${path}`);
      await expectAxeClean(page, testInfo);
    });
  }
}

test("keyboard users can bypass the repeated header", async ({ page }) => {
  await openSettledPage(page, "/en-US");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("the opened mobile menu remains accessible", async ({
  page,
}, testInfo) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) > 600,
    "This state only exists in the mobile header"
  );
  await openSettledPage(page, "/cs-CZ");

  await page.getByRole("button", { name: "Otevřít navigační nabídku" }).click();
  await expect(
    page.getByRole("navigation", { name: "Mobilní hlavní navigace" })
  ).toBeVisible();
  await expectAxeClean(page, testInfo);
});

test("reservation validation is associated with its controls", async ({
  page,
}, testInfo) => {
  await openSettledPage(page, "/en-US/reservation/cowork");

  const dateButton = page.getByRole("button", {
    name: "Reservation date, required",
  });
  await dateButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  await expectAxeClean(page, testInfo);
});

test("contact fields expose native required semantics", async ({ page }) => {
  await openSettledPage(page, "/en-US/contact");

  await expect(page.getByRole("textbox", { name: "Name" })).toHaveAttribute(
    "required",
    ""
  );
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "required",
    ""
  );
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveAttribute(
    "required",
    ""
  );
});

async function openSettledPage(page: Page, path: string) {
  await page.goto(path, { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", /^(en-US|cs-CZ)$/);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, {
    timeout: 20_000,
  });
}

async function expectAxeClean(page: Page, testInfo: TestInfo) {
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
