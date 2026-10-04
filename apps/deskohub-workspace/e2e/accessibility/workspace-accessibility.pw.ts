import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import { m } from "@/features/i18n";
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

const checkoutProgressPages = [
  {
    currentStepLabel: m.checkoutOrderStepReservation,
    currentStepIndex: 1,
    path: "/reservation/cowork",
  },
  {
    currentStepLabel: m.checkoutOrderStepPayment,
    currentStepIndex: 2,
    path: "/checkout/pay",
  },
  {
    currentStepLabel: m.checkoutOrderStepAccess,
    currentStepIndex: 3,
    path: "/reservation/access/instant-navigation-missing-order",
  },
] as const;

for (const locale of locales) {
  for (const {
    currentStepLabel,
    currentStepIndex,
    path,
  } of checkoutProgressPages) {
    test(`checkout progress on ${locale} ${path}`, async ({ page }) => {
      await openSettledPage(page, `/${locale}${path}`);

      const stepsList = page.getByRole("list", {
        name: m.checkoutOrderStepsLabel({}, { locale }),
      });
      await expect(stepsList).toBeVisible();
      expect(await stepsList.evaluate((list) => list.tagName)).toBe("OL");

      const items = stepsList.getByRole("listitem");
      await expect(items).toHaveCount(4);

      const chooseSpaceLabel = m.checkoutOrderStepChooseSpace({}, { locale });
      const completedLabel = m.checkoutOrderStepCompleted({}, { locale });
      const stepLabels = [
        chooseSpaceLabel,
        m.checkoutOrderStepReservation({}, { locale }),
        m.checkoutOrderStepPayment({}, { locale }),
        m.checkoutOrderStepAccess({}, { locale }),
      ];
      const chooseSpaceItem = items.nth(0);
      const completedBadgeClass = await chooseSpaceItem
        .locator("span")
        .first()
        .getAttribute("class");

      await expect(chooseSpaceItem).toContainText(chooseSpaceLabel);
      await expect(chooseSpaceItem.locator("span.sr-only")).toHaveText(
        completedLabel
      );
      await expect(chooseSpaceItem.locator("svg.lucide-check")).toHaveCount(1);
      expect(await chooseSpaceItem.getAttribute("aria-current")).toBeNull();
      await expect(chooseSpaceItem.getByRole("link")).toHaveCount(0);
      await expect(stepsList.getByText("1", { exact: true })).toHaveCount(0);

      for (let index = 0; index < currentStepIndex; index += 1) {
        const completedItem = items.nth(index);
        const badge = completedItem.locator("span").first();

        await expect(completedItem).toContainText(stepLabels[index] ?? "");
        await expect(badge).toHaveClass(/bg-aquamarine-green/);
        await expect(badge).toHaveClass(/text-aquamarine-ink/);
        expect(await badge.getAttribute("class")).toBe(completedBadgeClass);
        await expect(badge).toHaveText("");
        await expect(completedItem.locator("svg.lucide-check")).toHaveCount(1);
        await expect(completedItem.locator("span.sr-only")).toHaveText(
          completedLabel
        );
        expect(await completedItem.getAttribute("aria-current")).toBeNull();
      }

      const currentItems = stepsList.locator('[aria-current="step"]');
      await expect(currentItems).toHaveCount(1);
      await expect(currentItems).toContainText(
        currentStepLabel({}, { locale })
      );
      const currentItem = items.nth(currentStepIndex);
      const currentBadge = currentItem.locator("span").first();

      await expect(currentBadge).toHaveText(String(currentStepIndex + 1));
      await expect(currentBadge).toHaveClass(/bg-burned-orange/);
      await expect(currentItem.locator("svg.lucide-check")).toHaveCount(0);
      await expect(currentItem.locator("span.sr-only")).toHaveCount(0);

      for (let index = currentStepIndex + 1; index < 4; index += 1) {
        const futureItem = items.nth(index);
        const badge = futureItem.locator("span").first();

        await expect(futureItem).toContainText(stepLabels[index] ?? "");
        await expect(badge).toHaveText(String(index + 1));
        await expect(badge).toHaveClass(/border-white\/18/);
        await expect(badge).toHaveClass(/text-white\/64/);
        await expect(futureItem.locator("svg.lucide-check")).toHaveCount(0);
        await expect(futureItem.locator("span.sr-only")).toHaveCount(0);
        expect(await futureItem.getAttribute("aria-current")).toBeNull();
      }

      await expectCheckoutProgressLabelsFit(page, stepsList, stepLabels);
    });
  }
}

async function openSettledPage(page: Page, path: string) {
  await page.goto(path, { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("lang", /^(en-US|cs-CZ)$/);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, {
    timeout: 20_000,
  });
}

async function expectCheckoutProgressLabelsFit(
  page: Page,
  stepsList: Locator,
  labels: readonly string[]
) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const issues = await stepsList.evaluate((list, expectedLabels) => {
    const tolerance = 1;
    const labelSet = new Set(expectedLabels);
    const listRect = list.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const foundIssues: string[] = [];

    if (
      listRect.left < -tolerance ||
      listRect.right > viewportWidth + tolerance
    ) {
      foundIssues.push(
        `progress list overflows the viewport (left=${listRect.left}, right=${listRect.right}, viewportWidth=${viewportWidth})`
      );
    }
    if (
      list instanceof HTMLElement &&
      list.scrollWidth > list.clientWidth + tolerance
    ) {
      foundIssues.push(
        `progress list content overflows (scrollWidth=${list.scrollWidth}, clientWidth=${list.clientWidth})`
      );
    }

    for (const item of Array.from(list.querySelectorAll(":scope > li"))) {
      const card = item.firstElementChild;
      if (!(card instanceof HTMLElement)) {
        foundIssues.push("progress step card is missing");
        continue;
      }
      const cardRect = card.getBoundingClientRect();
      if (
        cardRect.left < listRect.left - tolerance ||
        cardRect.right > listRect.right + tolerance ||
        cardRect.top < listRect.top - tolerance ||
        cardRect.bottom > listRect.bottom + tolerance
      ) {
        foundIssues.push("progress step card overflows the progress list");
      }
      if (card.scrollWidth > card.clientWidth + tolerance) {
        foundIssues.push("progress step card content overflows its box");
      }

      const label = Array.from(card.querySelectorAll("span")).find(
        (span) =>
          !span.classList.contains("sr-only") &&
          labelSet.has(span.textContent?.trim() ?? "")
      );
      if (!(label instanceof HTMLElement)) {
        foundIssues.push("progress step label is missing");
        continue;
      }
      const labelText = label.textContent?.trim() ?? "";
      const labelRect = label.getBoundingClientRect();
      if (label.scrollWidth > label.clientWidth + tolerance) {
        foundIssues.push(
          `label "${labelText}" content overflows its box (scrollWidth=${label.scrollWidth}, clientWidth=${label.clientWidth})`
        );
      }
      if (
        labelRect.left < cardRect.left - tolerance ||
        labelRect.right > cardRect.right + tolerance ||
        labelRect.top < cardRect.top - tolerance ||
        labelRect.bottom > cardRect.bottom + tolerance
      ) {
        foundIssues.push(`label "${labelText}" overflows its progress card`);
      }
      if (
        labelRect.left < listRect.left - tolerance ||
        labelRect.right > listRect.right + tolerance ||
        labelRect.top < listRect.top - tolerance ||
        labelRect.bottom > listRect.bottom + tolerance
      ) {
        foundIssues.push(`label "${labelText}" overflows the progress list`);
      }
      if (
        labelRect.left < -tolerance ||
        labelRect.right > viewportWidth + tolerance
      ) {
        foundIssues.push(`label "${labelText}" overflows the viewport`);
      }
    }

    return foundIssues;
  }, labels);

  expect(issues, issues.join("\n")).toEqual([]);
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
