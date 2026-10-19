import { expect, type Locator, type Page, test } from "@playwright/test";
import { m } from "@/features/i18n";
import { enablePreviewAccess } from "../preview-access";
import {
  expectAxeClean,
  auditedLocales as locales,
  openSettledPage,
} from "./accessibility-audit";

const auditedPaths = [
  "",
  "/contact",
  "/pricing",
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

  // The calendar button beside the typed date field.
  const dateButton = page.getByRole("button", {
    name: "Reservation date: choose from the calendar",
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

// `currentStepIndex` is absent once every step is complete, as on the
// access page.
const checkoutProgressPages: readonly {
  readonly currentStepIndex?: number;
  readonly path: string;
}[] = [
  { currentStepIndex: 0, path: "/reservation/cowork" },
  { currentStepIndex: 1, path: "/reservation/cowork?step=contact" },
  { currentStepIndex: 2, path: "/checkout/pay" },
  { path: "/reservation/access/instant-navigation-missing-order" },
];

for (const locale of locales) {
  for (const { currentStepIndex, path } of checkoutProgressPages) {
    test(`checkout progress on ${locale} ${path}`, async ({ page }) => {
      await openSettledPage(page, `/${locale}${path}`);

      const stepsList = page.getByRole("list", {
        name: m.checkoutOrderStepsLabel({}, { locale }),
      });
      await expect(stepsList).toBeVisible();
      expect(await stepsList.evaluate((list) => list.tagName)).toBe("OL");

      const stepLabels = [
        m.checkoutOrderStepChooseSpace({}, { locale }),
        m.checkoutOrderStepContact({}, { locale }),
        m.checkoutOrderStepPayment({}, { locale }),
      ];
      const items = stepsList.getByRole("listitem");
      await expect(items).toHaveCount(stepLabels.length);

      const completedLabel = m.checkoutOrderStepCompleted({}, { locale });
      const completedCount = currentStepIndex ?? stepLabels.length;
      for (let index = 0; index < completedCount; index += 1) {
        const completedItem = items.nth(index);
        const badge = completedItem.locator("span").first();

        await expect(completedItem).toContainText(stepLabels[index] ?? "");
        await expect(badge).toHaveText("");
        await expect(completedItem.locator("svg.lucide-check")).toHaveCount(1);
        await expect(completedItem.locator("span.sr-only")).toHaveText(
          completedLabel
        );
        expect(await completedItem.getAttribute("aria-current")).toBeNull();
      }

      const currentItems = stepsList.locator('[aria-current="step"]');
      if (currentStepIndex === undefined) {
        await expect(currentItems).toHaveCount(0);
      } else {
        await expect(currentItems).toHaveCount(1);
        await expect(currentItems).toContainText(
          stepLabels[currentStepIndex] ?? ""
        );
        const currentItem = items.nth(currentStepIndex);
        const currentBadge = currentItem.locator("span").first();

        await expect(currentBadge).toHaveText(String(currentStepIndex + 1));
        await expect(currentItem.locator("svg.lucide-check")).toHaveCount(0);
        await expect(currentItem.locator("span.sr-only")).toHaveCount(0);
      }

      for (
        let index = completedCount + 1;
        index < stepLabels.length;
        index += 1
      ) {
        const futureItem = items.nth(index);
        const badge = futureItem.locator("span").first();

        await expect(futureItem).toContainText(stepLabels[index] ?? "");
        await expect(badge).toHaveText(String(index + 1));
        await expect(futureItem.locator("svg.lucide-check")).toHaveCount(0);
        await expect(futureItem.locator("span.sr-only")).toHaveCount(0);
        expect(await futureItem.getAttribute("aria-current")).toBeNull();
      }

      await expectCheckoutProgressLabelsFit(page, stepsList, stepLabels);
    });
  }
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
