import { expect, type Page } from "@playwright/test";
import type { AccountSection } from "@/features/account/components/shell/account-shell";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  accountSectionLabels,
  accountSectionLandmarks,
  selectAccountSection,
} from "./account-sections";

const accountNavigationLabel = "Account navigation";
const desktopViewport = { height: 1000, width: 1440 } as const;
const mobileViewports = [
  { height: 900, width: 375 },
  { height: 900, width: 430 },
] as const;
const accountSections = [
  "reservations",
  "profile",
  "billing",
  "legal",
  "danger",
] as const satisfies readonly AccountSection[];

type AccountLayoutSnapshot = {
  readonly activeButtonLabels: readonly string[];
  readonly contentLeft: number;
  readonly contentWidth: number;
  readonly hasHorizontalOverflow: boolean;
  readonly navigationLeft: number;
  readonly navigationRight: number;
  readonly navigationWidth: number;
  readonly visibleLandmarks: readonly string[];
};

const readAccountLayout = async (
  page: Page
): Promise<AccountLayoutSnapshot> => {
  const snapshot = await page.evaluate(
    ({ landmarkSelectors, navigationLabel }) => {
      const isVisible = (element: Element | null): boolean => {
        if (element === null) return false;
        for (
          let current: Element | null = element;
          current !== null;
          current = current.parentElement
        ) {
          if (current.hasAttribute("hidden")) return false;
          const styles = window.getComputedStyle(current);
          if (styles.display === "none" || styles.visibility === "hidden") {
            return false;
          }
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const navigation = document.querySelector(
        `nav[aria-label=${JSON.stringify(navigationLabel)}]`
      );
      const aside = navigation?.closest("aside");
      const grid = aside?.parentElement;
      const content =
        aside == null || grid == null
          ? undefined
          : Array.from(grid.children).find((child) => child !== aside);
      if (!navigation || !aside || !grid || !content) return null;

      const navigationRect = navigation.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const scrollWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0
      );
      return {
        activeButtonLabels: Array.from(
          navigation.querySelectorAll('button[aria-current="page"]')
        )
          .filter(isVisible)
          .map(
            (button) => button.textContent?.replaceAll(/\s+/g, " ").trim() ?? ""
          ),
        contentLeft: contentRect.left,
        contentWidth: contentRect.width,
        hasHorizontalOverflow: scrollWidth > window.innerWidth + 1,
        navigationLeft: navigationRect.left,
        navigationRight: navigationRect.right,
        navigationWidth: navigationRect.width,
        visibleLandmarks: landmarkSelectors.filter((selector) =>
          isVisible(document.querySelector(selector))
        ),
      } satisfies AccountLayoutSnapshot;
    },
    {
      landmarkSelectors: accountSections.map(
        (section) => accountSectionLandmarks[section]
      ),
      navigationLabel: accountNavigationLabel,
    }
  );

  if (snapshot === null)
    throw new Error("Account layout navigation landmarks are missing");
  return snapshot;
};

const verifyDesktopSection = async (
  page: Page,
  section: AccountSection
): Promise<void> => {
  const snapshot = await readAccountLayout(page);
  expect(snapshot.hasHorizontalOverflow).toBe(false);
  expect(snapshot.navigationWidth).toBeGreaterThan(0);
  expect(snapshot.contentWidth).toBeGreaterThan(0);
  expect(snapshot.navigationLeft).toBeLessThan(snapshot.contentLeft);
  expect(snapshot.navigationRight).toBeLessThanOrEqual(snapshot.contentLeft);
  expect(snapshot.activeButtonLabels).toHaveLength(1);
  expect(
    snapshot.activeButtonLabels[0]?.startsWith(accountSectionLabels[section])
  ).toBe(true);
  expect(snapshot.visibleLandmarks).toEqual([accountSectionLandmarks[section]]);
};

const verifyMobileSection = async (
  page: Page,
  section: AccountSection
): Promise<void> => {
  const mobileButton = page.getByRole("button", {
    exact: false,
    name: accountSectionLabels[section],
  });
  if (!(await mobileButton.isVisible()))
    throw new Error("Account mobile section button is not visible");

  const snapshot = await readAccountLayout(page);
  const selectedSections = await page.evaluate(
    ({ navigationLabel }) =>
      Array.from(
        document
          .querySelector(`nav[aria-label=${JSON.stringify(navigationLabel)}]`)
          ?.querySelectorAll<HTMLButtonElement>(
            '[data-account-mobile-navigation] button[aria-current="page"]'
          ) ?? []
      ).map((button) => button.getAttribute("data-account-section")),
    { navigationLabel: accountNavigationLabel }
  );
  expect(snapshot.hasHorizontalOverflow).toBe(false);
  expect(snapshot.activeButtonLabels).toHaveLength(1);
  expect(
    snapshot.activeButtonLabels[0]?.startsWith(accountSectionLabels[section])
  ).toBe(true);
  expect(selectedSections).toEqual([section]);
  expect(snapshot.visibleLandmarks).toEqual([accountSectionLandmarks[section]]);
};

export async function verifyAccountLayoutNavigation(
  page: Page,
  captureSection?: (section: AccountSection) => Promise<void>
): Promise<void> {
  const originalViewport = page.viewportSize();
  if (originalViewport === null)
    throw new Error("Account layout verification requires a fixed viewport");

  try {
    await page.setViewportSize(desktopViewport);
    for (const section of accountSections) {
      await selectAccountSection(page, section);
      await page.locator(accountSectionLandmarks[section]).waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.browserAction,
      });
      await verifyDesktopSection(page, section);
      await captureSection?.(section);
    }

    for (const viewport of mobileViewports) {
      await page.setViewportSize(viewport);
      for (const section of accountSections) {
        await selectAccountSection(page, section);
        await page.locator(accountSectionLandmarks[section]).waitFor({
          state: "visible",
          timeout: workspaceE2ETimeouts.browserAction,
        });
        await verifyMobileSection(page, section);
      }
    }

    await selectAccountSection(page, "reservations");
    await page.locator(accountSectionLandmarks.reservations).waitFor({
      state: "visible",
      timeout: workspaceE2ETimeouts.browserAction,
    });
  } finally {
    await page.setViewportSize(originalViewport);
  }
}
