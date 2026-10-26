import { normalizePhoneNumber } from "@deskohub/dotypos";
import { expect, type Page } from "@playwright/test";
import {
  type AccountSection,
  accountSectionLabel,
} from "@/features/account/sections";
import {
  type WorkspaceE2EProfileNavigationDiagnosticCode,
  workspaceE2EError,
} from "../errors";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type AccountSectionSelectionStage,
  accountSectionLandmarks,
  selectAccountSection,
} from "./account-sections";

const homePath = "/en-US";
const accountPath = "/en-US/account";
const profileFormSelector = "#account-profile-form";
const profileFirstNameSelector = "#account-profile-first-name";
const profileLastNameSelector = "#account-profile-last-name";
const profilePhoneSelector = "#account-profile-phone";
const billingKindSelector = "#account-profile-billing-kind";
const billingCompanyNameSelector = "#account-profile-billing-company-name";
const profileSubmitSelector = "#account-profile-submit";
const unavailableHeading = "Customer accounts are temporarily unavailable";
const persistedProfileSelectionDiagnostics: Readonly<
  Record<
    AccountSectionSelectionStage,
    WorkspaceE2EProfileNavigationDiagnosticCode
  >
> = {
  "link-handler-wait": "account_profile_persisted_profile_handler_wait_failed",
  "panel-hydration-wait":
    "account_profile_persisted_profile_panel_hydration_wait_failed",
  "native-link-click": "account_profile_persisted_profile_click_failed",
  "selected-landmark-wait":
    "account_profile_persisted_profile_landmark_wait_failed",
};

type ProfileNavigationFailureKind =
  | "timeout"
  | "strict-mode-violation"
  | "error";

/**
 * Closed, value-free summary of a Playwright failure. The raw error can carry
 * private profile values, so only its kind leaves this module.
 */
const classifyProfileNavigationFailure = (
  cause: unknown
): ProfileNavigationFailureKind => {
  if (!(cause instanceof Error)) return "error";
  if (cause.name === "TimeoutError") return "timeout";
  return cause.message.includes("strict mode violation")
    ? "strict-mode-violation"
    : "error";
};

export function triggerProfileHistoryBack(page: Page): Promise<void> {
  return page.evaluate(() => {
    window.history.back();
  });
}

export async function verifyProfileNavigation(
  page: Page,
  baseUrl: string
): Promise<void> {
  let diagnosticCode: WorkspaceE2EProfileNavigationDiagnosticCode =
    "account_profile_baseline_failed";
  let selectionStage: AccountSectionSelectionStage | undefined;
  const selectSection = async (
    section: AccountSection,
    onSelectionStage?: (stage: AccountSectionSelectionStage) => void
  ): Promise<void> => {
    await selectAccountSection(page, section, (stage) => {
      selectionStage = stage;
      onSelectionStage?.(stage);
    });
    selectionStage = undefined;
  };

  try {
    const homeUrl = new URL(homePath, baseUrl).toString();
    const accountUrl = new URL(accountPath, baseUrl).toString();
    // A section switch records its section in the account pathname.
    const accountSectionUrl = (section: AccountSection) =>
      `${accountUrl}/${section}`;
    const profileForm = page.locator(profileFormSelector);
    const firstName = page.locator(profileFirstNameSelector);
    const header = page.getByRole("banner");
    const homeLink = header.getByRole("link", {
      exact: true,
      name: "Deskohub Workspace",
    });
    const accountLink = header.getByRole("link", {
      exact: true,
      name: "Account",
    });

    const selectProfileSection = async (
      onSelectionStage?: (stage: AccountSectionSelectionStage) => void
    ): Promise<void> => {
      await selectSection("profile", onSelectionStage);
      if (onSelectionStage) {
        diagnosticCode =
          "account_profile_persisted_profile_form_visibility_failed";
      }
      await expect(profileForm).toBeVisible({
        timeout: workspaceE2ETimeouts.browserAction,
      });
    };

    await selectProfileSection();
    const originalProfile = {
      firstName: await firstName.inputValue({
        timeout: workspaceE2ETimeouts.browserAction,
      }),
      lastName: await page.locator(profileLastNameSelector).inputValue({
        timeout: workspaceE2ETimeouts.browserAction,
      }),
      phone: await page.locator(profilePhoneSelector).inputValue({
        timeout: workspaceE2ETimeouts.browserAction,
      }),
    };
    const canonicalOriginalPhone = normalizePhoneNumber(originalProfile.phone);
    if (canonicalOriginalPhone === null)
      throw new Error("profile phone is not a valid canonical phone number");
    await selectSection("billing");
    await expect(page.locator(accountSectionLandmarks.billing)).toBeVisible({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 2,
        name: accountSectionLabel("billing", "en-US"),
      })
    ).toBeVisible({ timeout: workspaceE2ETimeouts.browserAction });
    const originalBilling = {
      companyName: await page.locator(billingCompanyNameSelector).inputValue({
        timeout: workspaceE2ETimeouts.browserAction,
      }),
      kind: await page.locator(billingKindSelector).inputValue({
        timeout: workspaceE2ETimeouts.browserAction,
      }),
    };
    const draftFirstName = `${originalProfile.firstName} draft`.slice(0, 100);
    await selectProfileSection();

    diagnosticCode = "account_profile_clean_navigation_failed";
    await Promise.all([
      page.waitForURL(homeUrl, {
        timeout: workspaceE2ETimeouts.browserNavigation,
      }),
      homeLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
    ]);

    await expect(accountLink).toBeVisible({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(accountLink).toHaveAttribute("href", accountPath, {
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await Promise.all([
      page.waitForURL(accountUrl, {
        timeout: workspaceE2ETimeouts.browserNavigation,
      }),
      accountLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
    ]);
    await selectProfileSection();
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 1,
        name: unavailableHeading,
      })
    ).toHaveCount(0, { timeout: workspaceE2ETimeouts.browserAction });

    diagnosticCode = "account_profile_draft_retention_failed";
    await firstName.fill(draftFirstName, {
      timeout: workspaceE2ETimeouts.browserAction,
    });

    await selectSection("billing");
    await expect(page.locator(accountSectionLandmarks.billing)).toBeVisible({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 2,
        name: accountSectionLabel("billing", "en-US"),
      })
    ).toBeVisible({ timeout: workspaceE2ETimeouts.browserAction });
    await selectProfileSection();
    await expect(firstName).toHaveValue(draftFirstName, {
      timeout: workspaceE2ETimeouts.browserAction,
    });

    diagnosticCode = "account_profile_hidden_billing_validation_failed";
    await selectSection("billing");
    await expect(page.locator(accountSectionLandmarks.billing)).toBeVisible({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await page.locator(billingCompanyNameSelector).fill("", {
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await selectProfileSection();
    await page.locator(profileSubmitSelector).click({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(page.locator(accountSectionLandmarks.billing)).toBeVisible({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(page.locator(billingCompanyNameSelector)).toHaveValue("", {
      timeout: workspaceE2ETimeouts.browserAction,
    });
    const hiddenBillingValidationMessage = await page
      .locator(billingCompanyNameSelector)
      .evaluate((input) => {
        if (!(input instanceof HTMLInputElement)) {
          throw new Error("billing company name control is not an input");
        }
        return input.validationMessage;
      });
    expect(hiddenBillingValidationMessage).not.toBe("");
    await page
      .locator(billingCompanyNameSelector)
      .fill(originalBilling.companyName, {
        timeout: workspaceE2ETimeouts.browserAction,
      });
    await selectProfileSection();
    await expect(firstName).toHaveValue(draftFirstName, {
      timeout: workspaceE2ETimeouts.browserAction,
    });

    // The profile form remains mounted while its profile panel is hidden.
    diagnosticCode = "account_profile_header_dismissal_failed";
    await selectSection("billing");
    const headerClickDialogPromise = page.waitForEvent("dialog", {
      timeout: workspaceE2ETimeouts.browserAction,
    });
    const headerClickPromise = homeLink.click({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    const headerClickDialog = await headerClickDialogPromise;
    expect(headerClickDialog.type()).toBe("confirm");
    await headerClickDialog.dismiss();
    await headerClickPromise;
    await expect(page).toHaveURL(accountSectionUrl("billing"), {
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await selectProfileSection();
    await expect(firstName).toHaveValue(draftFirstName, {
      timeout: workspaceE2ETimeouts.browserAction,
    });

    diagnosticCode = "account_profile_history_dismissal_failed";
    const backDialogPromise = page.waitForEvent("dialog", {
      timeout: workspaceE2ETimeouts.browserAction,
    });
    const backTriggerPromise = triggerProfileHistoryBack(page);
    const backDialog = await backDialogPromise;
    expect(backDialog.type()).toBe("confirm");
    await backDialog.dismiss();
    await backTriggerPromise;
    await expect(page).toHaveURL(accountSectionUrl("profile"), {
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await selectProfileSection();
    await expect(firstName).toHaveValue(draftFirstName, {
      timeout: workspaceE2ETimeouts.browserAction,
    });

    diagnosticCode = "account_profile_discard_confirmation_failed";
    const leaveDialogPromise = page.waitForEvent("dialog", {
      timeout: workspaceE2ETimeouts.browserAction,
    });
    const leaveClickPromise = homeLink.click({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    const leaveDialog = await leaveDialogPromise;
    expect(leaveDialog.type()).toBe("confirm");
    await leaveDialog.accept();
    await leaveClickPromise;
    await expect(page).toHaveURL(homeUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    });

    diagnosticCode = "account_profile_persisted_document_reload_failed";
    await page.goto(accountUrl, {
      waitUntil: "load",
      timeout: workspaceE2ETimeouts.browserNavigation,
    });

    diagnosticCode = "account_profile_persisted_profile_navigation_failed";
    await selectProfileSection((stage) => {
      diagnosticCode = persistedProfileSelectionDiagnostics[stage];
    });

    diagnosticCode = "account_profile_persisted_first_name_restore_failed";
    await expect(firstName).toHaveValue(originalProfile.firstName, {
      timeout: workspaceE2ETimeouts.browserAction,
    });

    diagnosticCode = "account_profile_persisted_last_name_restore_failed";
    await expect(page.locator(profileLastNameSelector)).toHaveValue(
      originalProfile.lastName,
      { timeout: workspaceE2ETimeouts.browserAction }
    );

    diagnosticCode = "account_profile_persisted_phone_restore_failed";
    await expect(page.locator(profilePhoneSelector)).toHaveValue(
      canonicalOriginalPhone,
      { timeout: workspaceE2ETimeouts.browserAction }
    );

    diagnosticCode = "account_profile_persisted_billing_navigation_failed";
    await selectSection("billing");

    diagnosticCode = "account_profile_persisted_billing_kind_restore_failed";
    await expect(page.locator(billingKindSelector)).toHaveValue(
      originalBilling.kind,
      { timeout: workspaceE2ETimeouts.browserAction }
    );

    diagnosticCode = "account_profile_persisted_billing_company_restore_failed";
    await expect(page.locator(billingCompanyNameSelector)).toHaveValue(
      originalBilling.companyName,
      { timeout: workspaceE2ETimeouts.browserAction }
    );

    diagnosticCode =
      "account_profile_persisted_return_profile_navigation_failed";
    await selectProfileSection();

    diagnosticCode =
      "account_profile_persisted_unavailable_heading_expectation_failed";
    await expect(
      page.getByRole("heading", {
        exact: true,
        level: 1,
        name: unavailableHeading,
      })
    ).toHaveCount(0, { timeout: workspaceE2ETimeouts.browserAction });
  } catch (cause) {
    const failureKind = classifyProfileNavigationFailure(cause);
    throw workspaceE2EError(
      selectionStage === undefined
        ? `Profile navigation verification failed (${failureKind})`
        : `Profile navigation verification failed at section selection stage ${selectionStage} (${failureKind})`,
      {
        diagnosticCode,
        operation: "verify profile navigation and unsaved changes",
      }
    );
  }
}
