import { Effect } from "effect";
import type { AccountSection } from "@/features/account/components/shell/account-shell";
import {
  clickBrowserElement,
  evalBrowserScript,
  focusBrowserElement,
  pressBrowserKey,
  waitForBrowserCondition,
} from "../browser";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

const accountNavigationLabel = "Account navigation";
const accountMobileSectionLabel = "Account section";
const desktopBreakpoint = 768;
const accountSectionOrder = [
  "reservations",
  "profile",
  "billing",
  "legal",
  "danger",
] as const satisfies readonly AccountSection[];
const accountSectionSelectSelector = `nav[aria-label=${JSON.stringify(accountNavigationLabel)}] select`;

export const accountSectionLabels = {
  reservations: "Reservations",
  profile: "Profile & Identity",
  billing: "Billing & Invoices",
  legal: "Legal & Privacy",
  danger: "Danger zone",
} as const satisfies Readonly<Record<AccountSection, string>>;

/** Stable controls that are only visible when their owning account panel is active. */
export const accountSectionLandmarks = {
  reservations: "#account-reservations-current-title",
  profile: "[data-slot='profile-screen']",
  billing: "#account-profile-billing-kind",
  legal: "main a[href$='/privacy-policy']",
  danger: "#delete-account-trigger",
} as const satisfies Readonly<Record<AccountSection, string>>;

type AccountSectionWaitInput = {
  readonly desktop: boolean;
  readonly landmark: string;
  readonly label: string;
  readonly mobileSelectSelector: string;
  readonly navigationLabel: string;
  readonly section: AccountSection;
};

export type AccountSectionPage = {
  readonly getByRole: (
    role: "button" | "combobox",
    options?: { readonly exact?: boolean; readonly name?: string }
  ) => AccountSectionLocator;
  readonly viewportSize: () => {
    readonly height: number;
    readonly width: number;
  } | null;
  readonly waitForFunction: (
    pageFunction: (input: AccountSectionWaitInput) => boolean,
    arg: AccountSectionWaitInput,
    options: { readonly timeout: number }
  ) => Promise<unknown>;
};

type AccountSectionLocator = {
  readonly click: (options?: { readonly timeout?: number }) => Promise<void>;
  readonly isVisible: () => Promise<boolean>;
  readonly selectOption: (
    value: string,
    options?: { readonly timeout?: number }
  ) => Promise<readonly string[]>;
};

const accountSectionIsReady = ({
  desktop,
  landmark,
  label,
  mobileSelectSelector,
  navigationLabel,
  section,
}: AccountSectionWaitInput): boolean => {
  const isVisible = (element: Element): boolean => {
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

  if (desktop) {
    const selectedButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        `nav[aria-label=${JSON.stringify(navigationLabel)}] button[aria-current="page"]`
      )
    ).find((button) => {
      const primaryLabel =
        button
          .querySelector("span")
          ?.textContent?.replaceAll(/\s+/g, " ")
          .trim() ?? "";
      return primaryLabel === label;
    });
    return selectedButton !== undefined && isVisible(selectedButton);
  }

  const select =
    document.querySelector<HTMLSelectElement>(mobileSelectSelector);
  return select !== null && isVisible(select) && select.value === section;
};

const makeAccountSectionWaitInput = (
  section: AccountSection,
  desktop: boolean
): AccountSectionWaitInput => ({
  desktop,
  landmark: accountSectionLandmarks[section],
  label: accountSectionLabels[section],
  mobileSelectSelector: accountSectionSelectSelector,
  navigationLabel: accountNavigationLabel,
  section,
});

const makeAccountSectionWaitCondition = (
  section: AccountSection,
  desktop: boolean
) =>
  `(${accountSectionIsReady.toString()})(${JSON.stringify(makeAccountSectionWaitInput(section, desktop))})`;

const accountSectionButtonSelector = (section: AccountSection) =>
  `nav[aria-label=${JSON.stringify(accountNavigationLabel)}] button:has-text(${JSON.stringify(accountSectionLabels[section])})`;

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
  section: AccountSection
): Promise<void> => {
  const timeout = workspaceE2ETimeouts.browserAction;
  const label = accountSectionLabels[section];
  const desktopButton = page.getByRole("button", {
    exact: false,
    name: label,
  });
  const viewport = page.viewportSize();
  const desktop =
    viewport === null
      ? await desktopButton.isVisible()
      : viewport.width >= desktopBreakpoint;

  if (desktop) {
    await desktopButton.click({ timeout });
  } else {
    await page
      .getByRole("combobox", {
        exact: true,
        name: accountMobileSectionLabel,
      })
      .selectOption(section, { timeout });
  }

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

    if (desktop) {
      yield* clickBrowserElement(
        run,
        session,
        accountSectionButtonSelector(section),
        { timeoutMs: workspaceE2ETimeouts.browserAction }
      );
    } else {
      yield* focusBrowserElement(run, session, accountSectionSelectSelector, {
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      yield* pressBrowserKey(run, session, "Home", {
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
      const targetIndex = accountSectionOrder.indexOf(section);
      for (let index = 0; index < targetIndex; index += 1) {
        yield* pressBrowserKey(run, session, "ArrowDown", {
          timeoutMs: workspaceE2ETimeouts.browserAction,
        });
      }
      yield* pressBrowserKey(run, session, "Tab", {
        timeoutMs: workspaceE2ETimeouts.browserAction,
      });
    }

    yield* waitForBrowserCondition(
      run,
      session,
      `account ${section} section`,
      makeAccountSectionWaitCondition(section, desktop),
      { timeoutMs: workspaceE2ETimeouts.uiTransition }
    );
  });
