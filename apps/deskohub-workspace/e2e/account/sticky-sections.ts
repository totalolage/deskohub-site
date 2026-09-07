import { expect, type Page } from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";
import { captureAccountReview } from "./review-screenshots";

const accountProfileFormSelector = "#account-profile-form";
const billingDetailsSelector = `${accountProfileFormSelector} details`;
const billingKindSelector = "#account-profile-billing-kind";
const stickySectionsSelector = '[data-slot="sticky-section"]';
const desktopViewport = { height: 900, width: 1440 } as const;
const stickyInsetExtra = 24;

const billingKinds = ["hidden", "personal", "business"] as const;
type BillingKind = (typeof billingKinds)[number];

type ScrollPosition = {
  readonly left: number;
  readonly top: number;
};

type StickyLayout = {
  readonly gridDocumentHeight: number;
  readonly gridDocumentTop: number;
  readonly headerHeight: number;
  readonly leftHeight: number;
  readonly leftTop: number;
  readonly rightBottomDocument: number;
  readonly rightHeight: number;
  readonly rightTop: number;
};

const isBillingKind = (value: string): value is BillingKind =>
  billingKinds.some((kind) => kind === value);

export async function selectAccountBillingKind(
  page: Page,
  kind: BillingKind
): Promise<void> {
  const timeout = workspaceE2ETimeouts.browserAction;
  await page.waitForFunction(
    () => {
      const element = document.querySelector("#account-profile-billing-kind");
      const reactPropsKey =
        element === null
          ? undefined
          : Object.keys(element).find((key) => key.startsWith("__reactProps$"));
      const reactProps =
        element === null || reactPropsKey === undefined
          ? undefined
          : Reflect.get(element, reactPropsKey);
      return (
        typeof reactProps === "object" &&
        reactProps !== null &&
        typeof Reflect.get(reactProps, "onChange") === "function"
      );
    },
    undefined,
    { timeout }
  );
  await page.locator(billingKindSelector).selectOption(kind, { timeout });
}

export async function verifyStickyAccountSections(
  page: Page,
  baseUrl: string
): Promise<void> {
  const timeout = workspaceE2ETimeouts.browserAction;
  const originalViewport = page.viewportSize();
  if (originalViewport === null)
    throw new Error("Sticky account verification requires a fixed viewport");
  const storedViewport = { ...originalViewport };
  const originalScroll = await page.evaluate<ScrollPosition>(() => ({
    left: window.scrollX,
    top: window.scrollY,
  }));

  const profileForm = page.locator(accountProfileFormSelector);
  const billingDetails = page.locator(billingDetailsSelector);
  const billingSummary = billingDetails.locator("summary");
  const billingKind = page.locator(billingKindSelector);
  const stickySections = page.locator(stickySectionsSelector);
  const readDetailsOpen = (): Promise<boolean> =>
    billingDetails.evaluate((details) => (details as HTMLDetailsElement).open);

  await expect(profileForm).toBeVisible({ timeout });
  await expect(billingDetails).toHaveCount(1, { timeout });
  await expect(billingKind).toHaveCount(1, { timeout });

  const originalDetailsOpen = await readDetailsOpen();
  const originalBillingKindValue = await billingKind.inputValue({ timeout });
  if (!isBillingKind(originalBillingKindValue))
    throw new Error(
      "Sticky account verification found an unsupported billing kind"
    );
  const originalBillingKind = originalBillingKindValue;

  const readStickyLayout = (): Promise<StickyLayout | null> =>
    page.evaluate(() => {
      const sections = Array.from(
        document.querySelectorAll<HTMLElement>('[data-slot="sticky-section"]')
      );
      const leftSection = sections[0];
      const rightSection = sections[1];
      const grid = leftSection?.parentElement;
      const header = document.querySelector<HTMLElement>("body > header");
      if (!leftSection || !rightSection || !grid || !header) return null;

      const gridRect = grid.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const leftRect = leftSection.getBoundingClientRect();
      const rightRect = rightSection.getBoundingClientRect();
      return {
        gridDocumentHeight: gridRect.height,
        gridDocumentTop: gridRect.top + window.scrollY,
        headerHeight: headerRect.height,
        leftHeight: leftRect.height,
        leftTop: leftRect.top,
        rightBottomDocument: rightRect.bottom + window.scrollY,
        rightHeight: rightRect.height,
        rightTop: rightRect.top,
      };
    });

  const waitForScroll = async (top: number): Promise<void> => {
    await page.evaluate((scrollTop) => {
      window.scrollTo({ left: 0, top: scrollTop, behavior: "instant" });
    }, top);
    await page.waitForFunction(
      (expectedTop) => Math.abs(window.scrollY - expectedTop) <= 1,
      top,
      { timeout }
    );
  };

  let operationFailed = false;
  let operationCause: unknown;
  let restorationFailed = false;
  let restorationCause: unknown;
  const recordRestorationFailure = (cause: unknown) => {
    if (restorationFailed) return;
    restorationFailed = true;
    restorationCause = cause;
  };

  try {
    await page.setViewportSize(desktopViewport);

    const detailsOpen = await readDetailsOpen();
    if (!detailsOpen) {
      await billingSummary.click({ timeout });
    }
    await expect(billingDetails).toHaveAttribute("open", "", { timeout });

    await selectAccountBillingKind(page, "business");
    await expect(billingKind).toHaveValue("business", { timeout });

    await expect(stickySections).toHaveCount(2, { timeout });
    await page.waitForFunction(
      () => {
        const sections = Array.from(
          document.querySelectorAll<HTMLElement>('[data-slot="sticky-section"]')
        );
        return (
          sections.length === 2 &&
          sections.every((section) => {
            const cssHeight = Number.parseFloat(
              section.style.getPropertyValue("--sticky-section-height")
            );
            const measuredHeight = section.getBoundingClientRect().height;
            return (
              Number.isFinite(cssHeight) &&
              Math.abs(cssHeight - measuredHeight) <= 1
            );
          })
        );
      },
      undefined,
      { timeout }
    );

    const originalGrid = await readStickyLayout();
    if (!originalGrid)
      throw new Error("Sticky account verification landmarks are missing");

    expect(originalGrid.gridDocumentHeight).toBeGreaterThan(0);
    expect(originalGrid.headerHeight).toBeGreaterThan(0);
    expect(
      originalGrid.leftHeight,
      "the business profile must make the left sticky section substantially taller"
    ).toBeGreaterThan(originalGrid.rightHeight + 200);

    const stickyInset = originalGrid.headerHeight + stickyInsetExtra;
    const firstScrollTop = originalGrid.gridDocumentTop + 100;
    const middleScrollTop = originalGrid.gridDocumentTop + 200;

    await waitForScroll(firstScrollTop);
    const firstScrolledLayout = await readStickyLayout();
    if (!firstScrolledLayout)
      throw new Error("Sticky account verification landmarks disappeared");
    expect(
      Math.abs(firstScrolledLayout.rightTop - stickyInset),
      "the short right section did not pin below the site header"
    ).toBeLessThanOrEqual(1);

    await waitForScroll(middleScrollTop);
    const middleScrolledLayout = await readStickyLayout();
    if (!middleScrolledLayout)
      throw new Error("Sticky account verification landmarks disappeared");
    expect(
      Math.abs(middleScrolledLayout.rightTop - stickyInset),
      "the short right section did not remain pinned below the site header"
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(middleScrolledLayout.rightTop - firstScrolledLayout.rightTop),
      "the short right section moved while pinned"
    ).toBeLessThanOrEqual(1);
    expect(
      middleScrolledLayout.leftTop,
      "the tall left section did not continue moving"
    ).toBeLessThan(firstScrolledLayout.leftTop);

    const gridBottom =
      originalGrid.gridDocumentTop + originalGrid.gridDocumentHeight;
    const maximumScrollTop = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    );
    await waitForScroll(Math.min(gridBottom + 100, maximumScrollTop));
    const parentEndLayout = await readStickyLayout();
    if (!parentEndLayout)
      throw new Error("Sticky account verification landmarks disappeared");
    expect(
      parentEndLayout.rightBottomDocument,
      "the short right section escaped its grid parent"
    ).toBeLessThanOrEqual(gridBottom + 1);
    expect(
      parentEndLayout.rightTop,
      "the short right section did not release at the grid parent end"
    ).toBeLessThan(stickyInset);

    await waitForScroll(middleScrollTop);
    await captureAccountReview(page, baseUrl, "linked-sticky-desktop");
  } catch (cause) {
    operationFailed = true;
    operationCause = cause;
  } finally {
    try {
      const detailsOpen = await readDetailsOpen();
      if (!detailsOpen) await billingSummary.click({ timeout });
    } catch (cause) {
      recordRestorationFailure(cause);
    }

    try {
      await selectAccountBillingKind(page, originalBillingKind);
    } catch (cause) {
      recordRestorationFailure(cause);
    }

    try {
      const detailsOpen = await readDetailsOpen();
      if (detailsOpen !== originalDetailsOpen)
        await billingSummary.click({ timeout });
    } catch (cause) {
      recordRestorationFailure(cause);
    }

    try {
      await page.setViewportSize(storedViewport);
    } catch (cause) {
      recordRestorationFailure(cause);
    }

    try {
      await page.evaluate((scrollPosition) => {
        window.scrollTo({
          left: scrollPosition.left,
          top: scrollPosition.top,
          behavior: "instant",
        });
      }, originalScroll);
    } catch (cause) {
      recordRestorationFailure(cause);
    }
  }

  if (operationFailed) throw operationCause;
  if (restorationFailed) throw restorationCause;
}
