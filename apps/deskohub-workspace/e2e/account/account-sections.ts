import type { Page } from "@playwright/test";
import { Effect } from "effect";
import type { AccountSection } from "@/features/account/sections";
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
const accountSectionDataAttribute = "data-account-section";
const accountMobileNavigationSelector = `nav[aria-label=${JSON.stringify(accountNavigationLabel)}] [data-account-mobile-navigation]`;

export const accountSectionLabels = {
  reservations: "Reservations",
  referrals: "Referrals",
  profile: "Profile & Identity",
  security: "Sign-in & security",
  assistants: "Connected assistants",
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
  referrals: "[data-screen='referrals-screen']",
  profile: "[data-screen='profile-screen']",
  security: "#account-security-passkeys-title",
  assistants: "#account-assistants-title",
  billing: "#account-profile-billing-kind",
  legal: "main a[href$='/privacy-policy']",
  danger: "#delete-account-trigger",
} as const satisfies Readonly<Record<AccountSection, string>>;

type AccountSectionWaitInput = {
  readonly accountSectionDataAttribute: string;
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
  | "link-handler-wait"
  | "panel-hydration-wait"
  | "native-link-click"
  | "selected-landmark-wait";

const accountSectionIsReady = ({
  accountSectionDataAttribute,
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
    const selectedLink = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        `nav[aria-label=${JSON.stringify(navigationLabel)}] a[aria-current="page"]`
      )
    ).find((link) => {
      if (!isVisible(link)) return false;
      const primaryLabel =
        link
          .querySelector("span")
          ?.textContent?.replaceAll(/\s+/g, " ")
          .trim() ?? "";
      return primaryLabel === label;
    });
    return selectedLink !== undefined && isVisible(selectedLink);
  }

  const selectedLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      `${mobileNavigationSelector} a[${accountSectionDataAttribute}=${JSON.stringify(section)}][aria-current="page"]`
    )
  ).filter(isVisible);
  return (
    selectedLinks.length === 1 &&
    selectedLinks[0]?.textContent?.replaceAll(/\s+/g, " ").trim() === label
  );
};

/**
 * The navigation copy the selected-section check compares. It defaults to the
 * English labels; a page in another locale passes its own.
 */
export type AccountSectionCopy = {
  readonly label: string;
  readonly navigationLabel: string;
};

const makeAccountSectionWaitInput = (
  section: AccountSection,
  desktop: boolean | null,
  copy?: AccountSectionCopy
): AccountSectionWaitInput => {
  const navigationLabel = copy?.navigationLabel ?? accountNavigationLabel;
  return {
    accountSectionDataAttribute,
    desktop,
    landmark: accountSectionLandmarks[section],
    label: copy?.label ?? accountSectionLabels[section],
    mobileNavigationSelector: `nav[aria-label=${JSON.stringify(navigationLabel)}] [data-account-mobile-navigation]`,
    navigationLabel,
    section,
  };
};

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
  referrals: accountSectionLandmarks.referrals,
  profile: accountSectionLandmarks.profile,
  security: accountSectionLandmarks.security,
  assistants: accountSectionLandmarks.assistants,
  billing: accountSectionLandmarks.profile,
  danger: accountSectionLandmarks.danger,
};

const accountSectionLinkSelector = (section: AccountSection) =>
  `nav[aria-label=${JSON.stringify(accountNavigationLabel)}] a:not([data-account-section]):has-text(${JSON.stringify(accountSectionLabels[section])})`;

const accountMobileSectionLinkSelector = (section: AccountSection) =>
  `${accountMobileNavigationSelector} a[${accountSectionDataAttribute}=${JSON.stringify(section)}]`;

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

/**
 * Sections the account navigation shows only while their feature flag is on:
 * "Sign-in & security" follows `login_passkeys`.
 */
export const flagGatedAccountSections: readonly AccountSection[] = ["security"];

/**
 * Whether the hydrated desktop account navigation offers the section. A
 * caller that walks every section skips a flag-gated one that is hidden.
 */
export const isAccountSectionOffered = (
  page: Pick<Page, "evaluate">,
  section: AccountSection
): Promise<boolean> =>
  page.evaluate(
    ({ label, navigationLabel }) =>
      Array.from(
        document.querySelectorAll(
          `nav[aria-label=${JSON.stringify(navigationLabel)}] a:not([data-account-section])`
        )
      ).some((link) => link.textContent?.includes(label) === true),
    {
      label: accountSectionLabels[section],
      navigationLabel: accountNavigationLabel,
    }
  );

export const selectAccountSection = async (
  page: AccountSectionPage,
  section: AccountSection,
  onStage?: (stage: AccountSectionSelectionStage) => void
): Promise<void> => {
  const timeout = workspaceE2ETimeouts.browserAction;
  const label = accountSectionLabels[section];
  const sectionLink = page.getByRole("link", {
    exact: false,
    name: label,
  });

  onStage?.("link-handler-wait");
  await waitForReactClickHandler(page, sectionLink);

  const hydrationAnchor = accountSectionHydrationAnchors[section];
  if (hydrationAnchor !== undefined) {
    onStage?.("panel-hydration-wait");
    await page.waitForFunction(accountSectionPanelIsHydrated, hydrationAnchor, {
      timeout: workspaceE2ETimeouts.uiTransition,
    });
  }

  onStage?.("native-link-click");
  await sectionLink.click({ timeout });

  onStage?.("selected-landmark-wait");
  await waitForSelectedAccountSection(page, section);
};

/**
 * Waits until `section` is the selected account section with its panel
 * visible, without selecting it.
 */
export const waitForSelectedAccountSection = async (
  page: AccountSectionPage,
  section: AccountSection,
  copy?: AccountSectionCopy
): Promise<void> => {
  const viewport = page.viewportSize();
  const desktop =
    viewport === null ? null : viewport.width >= desktopBreakpoint;
  await page.waitForFunction(
    accountSectionIsReady,
    makeAccountSectionWaitInput(section, desktop, copy),
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
        accountSectionLinkSelector(section),
        { timeoutMs: workspaceE2ETimeouts.browserAction }
      );
    } else {
      yield* clickBrowserElement(
        run,
        session,
        accountMobileSectionLinkSelector(section),
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
