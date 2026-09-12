import { expect, type Page } from "@playwright/test";
import type { AccountSection } from "@/features/account/components/shell/account-shell";
import { WorkspaceE2EError, workspaceE2EError } from "../errors";
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
const accountLayoutNavigationOperation = "verify account layout navigation";

export const accountLayoutNavigationPhases = [
  "select",
  "landmark",
  "geometry",
  "capture",
] as const;

export type AccountLayoutNavigationPhase =
  (typeof accountLayoutNavigationPhases)[number];

export type AccountLayoutNavigationViewport = Readonly<{
  readonly height: number;
  readonly width: number;
}>;

type AccountLayoutNavigationKnownLandmarkSelector =
  (typeof accountSectionLandmarks)[AccountSection];

export type AccountLayoutNavigationGeometrySnapshot = Readonly<{
  readonly activeButtonCount: number;
  readonly contentLeft: number;
  readonly contentWidth: number;
  readonly hasHorizontalOverflow: boolean;
  readonly navigationLeft: number;
  readonly navigationRight: number;
  readonly navigationWidth: number;
  readonly visibleLandmarkSelectors: readonly AccountLayoutNavigationKnownLandmarkSelector[];
}>;

const knownAccountLandmarkSelectors = Object.values(accountSectionLandmarks);

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

const toSafeGeometrySnapshot = (
  snapshot: AccountLayoutSnapshot
): AccountLayoutNavigationGeometrySnapshot => {
  const numberValue = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const activeButtonCount = Array.isArray(snapshot.activeButtonLabels)
    ? Math.min(snapshot.activeButtonLabels.length, 100)
    : 0;
  const visibleLandmarkSelectors = Array.isArray(snapshot.visibleLandmarks)
    ? knownAccountLandmarkSelectors.filter((selector) =>
        snapshot.visibleLandmarks.includes(selector)
      )
    : [];

  return {
    activeButtonCount,
    contentLeft: numberValue(snapshot.contentLeft),
    contentWidth: numberValue(snapshot.contentWidth),
    hasHorizontalOverflow: snapshot.hasHorizontalOverflow === true,
    navigationLeft: numberValue(snapshot.navigationLeft),
    navigationRight: numberValue(snapshot.navigationRight),
    navigationWidth: numberValue(snapshot.navigationWidth),
    visibleLandmarkSelectors,
  };
};

const readSafeGeometrySnapshot = async (
  page: Page
): Promise<AccountLayoutNavigationGeometrySnapshot | undefined> => {
  try {
    return toSafeGeometrySnapshot(await readAccountLayout(page));
  } catch {
    return undefined;
  }
};

const sanitizeGeometrySnapshot = (
  snapshot: unknown
): AccountLayoutNavigationGeometrySnapshot | undefined => {
  const isRecord = (
    value: unknown
  ): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null;
  if (!isRecord(snapshot)) return undefined;

  const numberValue = (input: unknown): number =>
    typeof input === "number" && Number.isFinite(input) ? input : 0;
  const activeButtonCount = numberValue(snapshot.activeButtonCount);
  const visibleLandmarkValues = snapshot.visibleLandmarkSelectors;
  const visibleLandmarkSelectors = Array.isArray(visibleLandmarkValues)
    ? knownAccountLandmarkSelectors.filter((selector) =>
        visibleLandmarkValues.includes(selector)
      )
    : [];

  return {
    activeButtonCount: Math.min(
      Math.max(Math.trunc(activeButtonCount), 0),
      100
    ),
    contentLeft: numberValue(snapshot.contentLeft),
    contentWidth: numberValue(snapshot.contentWidth),
    hasHorizontalOverflow: snapshot.hasHorizontalOverflow === true,
    navigationLeft: numberValue(snapshot.navigationLeft),
    navigationRight: numberValue(snapshot.navigationRight),
    navigationWidth: numberValue(snapshot.navigationWidth),
    visibleLandmarkSelectors,
  };
};

const formatGeometrySnapshot = (snapshot: unknown): string | undefined => {
  try {
    const safeSnapshot = sanitizeGeometrySnapshot(snapshot);
    if (safeSnapshot === undefined) return undefined;
    const visibleLandmarks =
      safeSnapshot.visibleLandmarkSelectors.length === 0
        ? "none"
        : safeSnapshot.visibleLandmarkSelectors.join("|");

    return [
      `activeButtonCount=${safeSnapshot.activeButtonCount}`,
      `contentLeft=${safeSnapshot.contentLeft}`,
      `contentWidth=${safeSnapshot.contentWidth}`,
      `hasHorizontalOverflow=${safeSnapshot.hasHorizontalOverflow}`,
      `navigationLeft=${safeSnapshot.navigationLeft}`,
      `navigationRight=${safeSnapshot.navigationRight}`,
      `navigationWidth=${safeSnapshot.navigationWidth}`,
      `visibleLandmarkSelectors=${visibleLandmarks}`,
    ].join(",");
  } catch {
    return undefined;
  }
};

const formatAccountLayoutNavigationFailureMessage = (
  phase: AccountLayoutNavigationPhase,
  section: AccountSection,
  viewport: AccountLayoutNavigationViewport,
  geometrySnapshot?: AccountLayoutNavigationGeometrySnapshot
): string => {
  const safePhase = accountLayoutNavigationPhases.find(
    (candidate) => candidate === phase
  );
  const safeSection = accountSections.find(
    (candidate) => candidate === section
  );
  const safeViewportWidth =
    typeof viewport.width === "number" && Number.isFinite(viewport.width)
      ? String(viewport.width)
      : "0";
  const safeViewportHeight =
    typeof viewport.height === "number" && Number.isFinite(viewport.height)
      ? String(viewport.height)
      : "0";
  const formattedGeometry = formatGeometrySnapshot(geometrySnapshot);
  const geometry =
    formattedGeometry === undefined ? "" : `; geometry=${formattedGeometry}`;

  return `Account layout navigation failed at ${safePhase ?? "unknown"} for ${safeSection ?? "unknown"} at viewport ${safeViewportWidth}x${safeViewportHeight}${geometry}`;
};

const accountLayoutNavigationFailure = (
  phase: AccountLayoutNavigationPhase,
  section: AccountSection,
  viewport: AccountLayoutNavigationViewport,
  geometrySnapshot?: AccountLayoutNavigationGeometrySnapshot
): WorkspaceE2EError =>
  workspaceE2EError(
    formatAccountLayoutNavigationFailureMessage(
      phase,
      section,
      viewport,
      geometrySnapshot
    ),
    { operation: accountLayoutNavigationOperation }
  );

const genericAccountLayoutNavigationFailure = (): WorkspaceE2EError =>
  workspaceE2EError("verify account layout navigation failed", {
    operation: accountLayoutNavigationOperation,
  });

export const runAccountLayoutNavigationPhase = async <A>(
  phase: AccountLayoutNavigationPhase,
  section: AccountSection,
  viewport: AccountLayoutNavigationViewport,
  operation: () => Promise<A>,
  readGeometry?: () => Promise<
    AccountLayoutNavigationGeometrySnapshot | undefined
  >
): Promise<A> => {
  try {
    return await operation();
  } catch {
    let geometrySnapshot: AccountLayoutNavigationGeometrySnapshot | undefined;
    if (readGeometry) {
      try {
        geometrySnapshot = await readGeometry();
      } catch {
        geometrySnapshot = undefined;
      }
    }
    throw accountLayoutNavigationFailure(
      phase,
      section,
      viewport,
      geometrySnapshot
    );
  }
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
  let originalViewport: ReturnType<Page["viewportSize"]>;
  try {
    originalViewport = page.viewportSize();
  } catch {
    throw genericAccountLayoutNavigationFailure();
  }
  if (originalViewport === null) throw genericAccountLayoutNavigationFailure();

  let failure: unknown;
  try {
    try {
      await page.setViewportSize(desktopViewport);
    } catch {
      throw genericAccountLayoutNavigationFailure();
    }
    for (const section of accountSections) {
      await runAccountLayoutNavigationPhase(
        "select",
        section,
        desktopViewport,
        () => selectAccountSection(page, section)
      );
      await runAccountLayoutNavigationPhase(
        "landmark",
        section,
        desktopViewport,
        () =>
          page.locator(accountSectionLandmarks[section]).waitFor({
            state: "visible",
            timeout: workspaceE2ETimeouts.browserAction,
          })
      );
      await runAccountLayoutNavigationPhase(
        "geometry",
        section,
        desktopViewport,
        () => verifyDesktopSection(page, section),
        () => readSafeGeometrySnapshot(page)
      );
      await runAccountLayoutNavigationPhase(
        "capture",
        section,
        desktopViewport,
        async () => {
          await captureSection?.(section);
        }
      );
    }

    for (const viewport of mobileViewports) {
      try {
        await page.setViewportSize(viewport);
      } catch {
        throw genericAccountLayoutNavigationFailure();
      }
      for (const section of accountSections) {
        await runAccountLayoutNavigationPhase("select", section, viewport, () =>
          selectAccountSection(page, section)
        );
        await runAccountLayoutNavigationPhase(
          "landmark",
          section,
          viewport,
          () =>
            page.locator(accountSectionLandmarks[section]).waitFor({
              state: "visible",
              timeout: workspaceE2ETimeouts.browserAction,
            })
        );
        await runAccountLayoutNavigationPhase(
          "geometry",
          section,
          viewport,
          () => verifyMobileSection(page, section),
          () => readSafeGeometrySnapshot(page)
        );
      }
    }

    try {
      await selectAccountSection(page, "reservations");
      await page.locator(accountSectionLandmarks.reservations).waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.browserAction,
      });
    } catch {
      throw genericAccountLayoutNavigationFailure();
    }
  } catch (cause) {
    failure = cause;
  }

  try {
    await page.setViewportSize(originalViewport);
  } catch {
    if (failure === undefined)
      failure = genericAccountLayoutNavigationFailure();
  }

  if (failure === undefined) return;
  if (failure instanceof WorkspaceE2EError) throw failure;
  throw genericAccountLayoutNavigationFailure();
}
