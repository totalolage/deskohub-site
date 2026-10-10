import type { Page } from "@playwright/test";
import { Effect } from "effect";
import type { AccountSection } from "@/features/account/components/shell/account-shell";
import {
  clickBrowserElement,
  evalBrowserScript,
  waitForBrowserCondition,
} from "../browser";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import { waitForReactClickHandler } from "../react-handlers";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

const accountNavigationLabel = "Account navigation";
const desktopBreakpoint = 768;
const accountMobileNavigationSelector = `nav[aria-label=${JSON.stringify(accountNavigationLabel)}] [data-account-mobile-navigation]`;

export const accountSectionLabels = {
  reservations: "Reservations",
  profile: "Profile & Identity",
  billing: "Billing & Invoices",
  legal: "Legal & Privacy",
  danger: "Danger zone",
} as const satisfies Readonly<Record<AccountSection, string>>;

/**
 * Stable controls that are only visible when their owning account panel is
 * active. The reservations landmark anchors on the past panel because it
 * renders unconditionally, even when the current group is empty.
 */
export const accountSectionLandmarks = {
  reservations: "#account-reservations-past-title",
  profile: "[data-screen='profile-screen']",
  billing: "#account-profile-billing-kind",
  legal: "main a[href$='/privacy-policy']",
  danger: "#delete-account-trigger",
} as const satisfies Readonly<Record<AccountSection, string>>;

type AccountSectionWaitInput = {
  readonly desktop: boolean | null;
  readonly landmark: string;
  readonly label: string;
  readonly mobileNavigationSelector: string;
  readonly navigationLabel: string;
  readonly section: AccountSection;
};

export type AccountSectionPage = Pick<
  Page,
  "getByRole" | "viewportSize" | "waitForFunction"
>;

export type AccountSectionSelectionStage =
  | "button-handler-wait"
  | "panel-hydration-wait"
  | "native-button-click"
  | "selected-landmark-wait";

const accountSectionIsReady = ({
  desktop,
  landmark,
  label,
  mobileNavigationSelector,
  navigationLabel,
  section,
}: AccountSectionWaitInput): boolean => {
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
    return true;
  };

  const panel = document.querySelector(landmark);
  if (panel === null || !isVisible(panel)) return false;

  const responsiveDesktop =
    desktop === null
      ? !isVisible(document.querySelector(mobileNavigationSelector))
      : desktop;

  if (responsiveDesktop) {
    const selectedButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        `nav[aria-label=${JSON.stringify(navigationLabel)}] button[aria-current="page"]`
      )
    ).find((button) => {
      if (!isVisible(button)) return false;
      const primaryLabel =
        button
          .querySelector("span")
          ?.textContent?.replaceAll(/\s+/g, " ")
          .trim() ?? "";
      return primaryLabel === label;
    });
    return selectedButton !== undefined && isVisible(selectedButton);
  }

  const selectedButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      `${mobileNavigationSelector} button[data-account-section=${JSON.stringify(section)}][aria-current="page"]`
    )
  ).filter(isVisible);
  return (
    selectedButtons.length === 1 &&
    selectedButtons[0]?.textContent?.replaceAll(/\s+/g, " ").trim() === label
  );
};

const makeAccountSectionWaitInput = (
  section: AccountSection,
  desktop: boolean | null
): AccountSectionWaitInput => ({
  desktop,
  landmark: accountSectionLandmarks[section],
  label: accountSectionLabels[section],
  mobileNavigationSelector: accountMobileNavigationSelector,
  navigationLabel: accountNavigationLabel,
  section,
});

const makeAccountSectionWaitCondition = (
  section: AccountSection,
  desktop: boolean | null
) =>
  `(${accountSectionIsReady.toString()})(${JSON.stringify(makeAccountSectionWaitInput(section, desktop))})`;

/**
 * After a document load the account content streams in its own Suspense
 * boundary. Clicking a section before React reveals and hydrates that boundary
 * makes React client-render a second copy of the panel next to the hidden
 * server copy. Every panel except legal is always rendered, so its landmark
 * carries React props only once the content boundary is hydrated.
 */
const accountSectionPanelIsHydrated = (landmark: string): boolean => {
  const panel = document.querySelector(landmark);
  return (
    panel !== null &&
    Object.keys(panel).some((key) => key.startsWith("__reactProps$"))
  );
};

/**
 * Always-rendered hydration anchors inside each panel. Billing shares the
 * profile screen, whose container is a plain element rather than a form
 * control. Legal renders only once active, so it has no anchor.
 */
const accountSectionHydrationAnchors: Readonly<
  Partial<Record<AccountSection, string>>
> = {
  reservations: accountSectionLandmarks.reservations,
  profile: accountSectionLandmarks.profile,
  billing: accountSectionLandmarks.profile,
  danger: accountSectionLandmarks.danger,
};

const accountSectionButtonSelector = (section: AccountSection) =>
  `nav[aria-label=${JSON.stringify(accountNavigationLabel)}] button:not([data-account-section]):has-text(${JSON.stringify(accountSectionLabels[section])})`;

const accountMobileSectionButtonSelector = (section: AccountSection) =>
  `${accountMobileNavigationSelector} button[data-account-section=${JSON.stringify(section)}]`;

const readDesktopMode = (
  run: Runner,
  session: string
): Effect.Effect<boolean, WorkspaceE2EError> =>
  evalBrowserScript(
    "read account navigation viewport mode",
    run,
    session,
    `window.matchMedia("(min-width: ${desktopBreakpoint}px)").matches`,
    { logOutput: false, timeoutMs: workspaceE2ETimeouts.browserAction }
  ).pipe(
    Effect.flatMap((result) =>
      tryWorkspaceE2ESync("parse account navigation viewport mode", () => {
        const value = result.stdout.trim();
        if (value !== "true" && value !== "false") {
          throw new Error("account navigation viewport mode was not boolean");
        }
        return value === "true";
      })
    )
  );

export const selectAccountSection = async (
  page: AccountSectionPage,
  section: AccountSection,
  onStage?: (stage: AccountSectionSelectionStage) => void
): Promise<void> => {
  const timeout = workspaceE2ETimeouts.browserAction;
  const label = accountSectionLabels[section];
  const sectionButton = page.getByRole("button", {
    exact: false,
    name: label,
  });
  const viewport = page.viewportSize();
  const desktop =
    viewport === null ? null : viewport.width >= desktopBreakpoint;

  onStage?.("button-handler-wait");
  await waitForReactClickHandler(page, sectionButton);

  const hydrationAnchor = accountSectionHydrationAnchors[section];
  if (hydrationAnchor !== undefined) {
    onStage?.("panel-hydration-wait");
    await page.waitForFunction(accountSectionPanelIsHydrated, hydrationAnchor, {
      timeout: workspaceE2ETimeouts.uiTransition,
    });
  }

  onStage?.("native-button-click");
  await sectionButton.click({ timeout });

  onStage?.("selected-landmark-wait");
  await page.waitForFunction(
    accountSectionIsReady,
    makeAccountSectionWaitInput(section, desktop),
    { timeout: workspaceE2ETimeouts.uiTransition }
  );
};

export const selectAccountSectionInRunner = (
  run: Runner,
  session: string,
  section: AccountSection
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const desktop = yield* readDesktopMode(run, session);

    const hydrationAnchor = accountSectionHydrationAnchors[section];
    if (hydrationAnchor !== undefined) {
      yield* waitForBrowserCondition(
        run,
        session,
        `account ${section} panel hydration`,
        `(${accountSectionPanelIsHydrated.toString()})(${JSON.stringify(hydrationAnchor)})`,
        { timeoutMs: workspaceE2ETimeouts.uiTransition }
      );
    }

    if (desktop) {
      yield* clickBrowserElement(
        run,
        session,
        accountSectionButtonSelector(section),
        { timeoutMs: workspaceE2ETimeouts.browserAction }
      );
    } else {
      yield* clickBrowserElement(
        run,
        session,
        accountMobileSectionButtonSelector(section),
        {
          timeoutMs: workspaceE2ETimeouts.browserAction,
        }
      );
    }

    yield* waitForBrowserCondition(
      run,
      session,
      `account ${section} section`,
      makeAccountSectionWaitCondition(section, desktop),
      { timeoutMs: workspaceE2ETimeouts.uiTransition }
    );
  });
