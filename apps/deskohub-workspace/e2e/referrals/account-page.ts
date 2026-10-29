import { Effect } from "effect";
import { accountSectionLandmarks } from "../account/account-sections";
import {
  openPage,
  waitForPageCondition,
  waitForReactFormSubmit,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";

const completionTitle = "Complete your profile";
const linkedEditSubmitLabel = "Save profile";
const profileFirstNameSelector = "#account-profile-first-name";
const profilePhoneSelector = "#account-profile-phone";
const profileFormSelector = "#account-profile-form";
const profileSubmitSelector = `${profileFormSelector} button[type=submit]`;
const profileReferralCodeSelector = "#profile-referral-code";

type ReferralAccountPageConfig = Pick<
  WorkspaceE2EConfig,
  "baseUrl" | "bypassSecret" | "timeouts"
>;

/** Opens the English account page with `search`, such as a shared link's. */
export const openReferralAccount = (
  session: E2EBrowserSession,
  config: ReferralAccountPageConfig,
  search: string
): Effect.Effect<void, WorkspaceE2EError> =>
  openPage(session, config, `${config.baseUrl}/en-US/account${search}`, {
    timeoutMs: config.timeouts.browserNavigation,
  });

type ProfileCompletionFormQuery = {
  readonly completionTitle: string;
  readonly inputSelector: string;
  readonly prefilledCode: string;
};

export const toProfileCompletionFormQuery = (
  prefilledCode: string
): ProfileCompletionFormQuery => ({
  completionTitle,
  inputSelector: profileReferralCodeSelector,
  prefilledCode,
});

/** The completion form shows its referral field holding `prefilledCode`. */
export const isProfileCompletionForm = ({
  completionTitle,
  inputSelector,
  prefilledCode,
}: ProfileCompletionFormQuery) => {
  const input = document.querySelector(inputSelector);
  return (
    document.body?.innerText.includes(completionTitle) === true &&
    input instanceof HTMLInputElement &&
    input.name === "referralCode" &&
    input.value === prefilledCode
  );
};

export const waitForProfileCompletionForm = (
  session: E2EBrowserSession,
  config: ReferralAccountPageConfig,
  prefilledCode: string
): Effect.Effect<void, WorkspaceE2EError> =>
  waitForPageCondition(
    session,
    "profile completion form with its referral field",
    isProfileCompletionForm,
    toProfileCompletionFormQuery(prefilledCode),
    { timeoutMs: config.timeouts.uiTransition }
  );

export const linkedAccountViewQuery = {
  completionTitle,
  landmarkSelector: accountSectionLandmarks.reservations,
} as const;

/** The linked account view: completion is behind the customer. */
export const isLinkedAccountView = ({
  completionTitle,
  landmarkSelector,
}: typeof linkedAccountViewQuery) =>
  document.querySelector(landmarkSelector) !== null &&
  !document.body?.innerText.includes(completionTitle);

export const waitForLinkedAccount = (
  session: E2EBrowserSession,
  config: ReferralAccountPageConfig
): Effect.Effect<void, WorkspaceE2EError> =>
  waitForPageCondition(
    session,
    "linked account view",
    isLinkedAccountView,
    linkedAccountViewQuery,
    {
      timeoutMs: config.timeouts.browserAction + config.timeouts.datasource,
    }
  );

export const linkedProfileEditFormQuery = {
  submitLabel: linkedEditSubmitLabel,
  submitSelector: profileSubmitSelector,
} as const;

/** The profile form turned into the linked account's edit form. */
export const isLinkedProfileEditForm = ({
  submitLabel,
  submitSelector,
}: typeof linkedProfileEditFormQuery) => {
  const button = document.querySelector(submitSelector);
  return (
    button instanceof HTMLButtonElement &&
    button.textContent?.trim() === submitLabel
  );
};

/**
 * Completes the profile with the account's name and phone and waits for the
 * linked edit form. One browser action per former argv command, so a step
 * deadline that interrupts one starts no later action.
 */
export const completeReferralProfile = (
  session: E2EBrowserSession,
  config: ReferralAccountPageConfig,
  account: { readonly name: string; readonly phone: string }
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const timeout = config.timeouts.browserAction;
    // Fill only once React owns the form, or the native submit bypasses
    // the completion action.
    yield* waitForReactFormSubmit(
      session,
      profileFormSelector,
      [profileFirstNameSelector, profilePhoneSelector],
      { timeoutMs: timeout }
    );
    for (const [selector, value] of [
      [profileFirstNameSelector, account.name],
      [profilePhoneSelector, account.phone],
    ] as const) {
      yield* session.use("fill browser field", (page) =>
        page
          .locator(selector)
          .filter({ visible: true })
          .fill(value, { timeout })
      );
    }
    yield* session.use("click browser element", (page) =>
      page
        .locator(profileSubmitSelector)
        .filter({ visible: true })
        .click({ timeout })
    );
    yield* waitForPageCondition(
      session,
      "linked account edit form after profile completion",
      isLinkedProfileEditForm,
      linkedProfileEditFormQuery,
      { timeoutMs: config.timeouts.uiTransition }
    );
  });
