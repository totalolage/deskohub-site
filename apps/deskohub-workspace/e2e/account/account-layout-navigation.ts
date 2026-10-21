import type { Page } from "@playwright/test";
import type { AccountSection } from "@/features/account/sections";
import {
  isWorkspaceE2EDiagnosticCode,
  WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  accountSectionLandmarks,
  flagGatedAccountSections,
  isAccountSectionOffered,
  selectAccountSection,
} from "./account-sections";
import type { AccountReviewDestination } from "./review-screenshots";

const desktopViewport = { height: 1000, width: 1440 } as const;
const mobileViewport = { height: 900, width: 375 } as const;
const accountSections = [
  "profile",
  "reservations",
  "referrals",
  "security",
  "assistants",
  "billing",
  "legal",
  "danger",
] as const satisfies readonly AccountSection[];
// One switch per layout proves the authenticated, server-rendered sections
// still respond on the deployed bundle; AccountShell's browser acceptance test
// owns the per-section geometry. The mobile switch returns to reservations so
// later steps start from the default section.
const desktopSentinelSection: AccountSection = "profile";
const mobileSentinelSection: AccountSection = "reservations";
const accountLayoutNavigationOperation = "verify account layout navigation";

export const accountLayoutNavigationPhases = [
  "select",
  "landmark",
  "capture",
] as const;

export type AccountLayoutNavigationPhase =
  (typeof accountLayoutNavigationPhases)[number];

export type AccountLayoutNavigationViewport = Readonly<{
  readonly height: number;
  readonly width: number;
}>;

const formatAccountLayoutNavigationFailureMessage = (
  phase: AccountLayoutNavigationPhase,
  section: AccountSection,
  viewport: AccountLayoutNavigationViewport
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

  return `Account layout navigation failed at ${safePhase ?? "unknown"} for ${safeSection ?? "unknown"} at viewport ${safeViewportWidth}x${safeViewportHeight}`;
};

const accountLayoutNavigationFailure = (
  phase: AccountLayoutNavigationPhase,
  section: AccountSection,
  viewport: AccountLayoutNavigationViewport
): WorkspaceE2EError => {
  const diagnosticCode = `account_layout_${phase}_${section}_failed`;
  return workspaceE2EError(
    formatAccountLayoutNavigationFailureMessage(phase, section, viewport),
    {
      ...(isWorkspaceE2EDiagnosticCode(diagnosticCode)
        ? { diagnosticCode }
        : {}),
      operation: accountLayoutNavigationOperation,
    }
  );
};

const genericAccountLayoutNavigationFailure = (): WorkspaceE2EError =>
  workspaceE2EError("verify account layout navigation failed", {
    operation: accountLayoutNavigationOperation,
  });

export const runAccountLayoutNavigationPhase = async <A>(
  phase: AccountLayoutNavigationPhase,
  section: AccountSection,
  viewport: AccountLayoutNavigationViewport,
  operation: () => Promise<A>
): Promise<A> => {
  try {
    return await operation();
  } catch {
    throw accountLayoutNavigationFailure(phase, section, viewport);
  }
};

const switchAccountSection = async (
  page: Page,
  section: AccountSection,
  viewport: AccountLayoutNavigationViewport
): Promise<void> => {
  await runAccountLayoutNavigationPhase("select", section, viewport, () =>
    selectAccountSection(page, section)
  );
  await runAccountLayoutNavigationPhase("landmark", section, viewport, () =>
    page.locator(accountSectionLandmarks[section]).waitFor({
      state: "visible",
      timeout: workspaceE2ETimeouts.browserAction,
    })
  );
};

const setLayoutViewport = async (
  page: Page,
  viewport: AccountLayoutNavigationViewport
): Promise<void> => {
  try {
    await page.setViewportSize(viewport);
  } catch {
    throw genericAccountLayoutNavigationFailure();
  }
};

/**
 * Switches one account section on desktop and one on mobile. `captureSection`
 * runs only in opted-in review runs, which visit every desktop section so each
 * one is captured.
 */
export async function verifyAccountLayoutNavigation(
  page: Page,
  captureSection: ((section: AccountSection) => Promise<void>) | undefined,
  review: Pick<AccountReviewDestination, "screenshots">
): Promise<void> {
  const capture = review.screenshots ? captureSection : undefined;
  let originalViewport: ReturnType<Page["viewportSize"]>;
  try {
    originalViewport = page.viewportSize();
  } catch {
    throw genericAccountLayoutNavigationFailure();
  }
  if (originalViewport === null) throw genericAccountLayoutNavigationFailure();

  let failure: unknown;
  try {
    await setLayoutViewport(page, desktopViewport);
    const desktopSections: readonly AccountSection[] =
      capture === undefined ? [desktopSentinelSection] : accountSections;
    for (const section of desktopSections) {
      if (
        flagGatedAccountSections.includes(section) &&
        !(await isAccountSectionOffered(page, section))
      )
        continue;
      await switchAccountSection(page, section, desktopViewport);
      if (capture !== undefined) {
        await runAccountLayoutNavigationPhase(
          "capture",
          section,
          desktopViewport,
          () => capture(section)
        );
      }
    }

    await setLayoutViewport(page, mobileViewport);
    await switchAccountSection(page, mobileSentinelSection, mobileViewport);
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
