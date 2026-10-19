import { errors, expect, type Page } from "@playwright/test";
import { Effect } from "effect";
import { type Locale, m } from "@/features/i18n";
import { escapeRegExp } from "@/shared/utils/escape-regexp";
import {
  describeBrowserFailure,
  type WorkspaceE2EAccountPasskeyDiagnosticCode,
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import { waitForReactClickHandler } from "../react-handlers";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  addVirtualAuthenticator,
  ModalCeremonyNotAlone,
  type PageVirtualAuthenticator,
  type VirtualAuthenticatorCredential,
} from "../virtual-authenticator";
import { selectAccountSection } from "./account-sections";
import type { WorkspaceE2EPasskeySignInOffer } from "./types";

const signInEmailSelector = "#account-sign-in-email";
const signInPasskeySelector = "#account-sign-in-passkey";
const promptCreateSelector = "#passkey-prompt-create";
const passkeyRowSelector =
  'ul[aria-labelledby="account-security-passkeys-title"] li[data-passkey-id]';
const securityStatusSelector = "#account-security-status";
const addPasskeySelector = "#account-security-add-passkey:visible";
const addPasskeyCreateSelector = "#add-passkey-create";
const addPasskeyReauthSendSelector = "#add-passkey-reauth-send";
const renameInputSelector = "#rename-passkey-name";
const renameSaveSelector = "#rename-passkey-save";
const deletePasskeyConfirmSelector = "#delete-passkey-confirm";
const deleteAccountTriggerSelector = "#delete-account-trigger";
const deleteAccountCheckboxSelector = "#confirm-account-deletion";
const deleteAccountConfirmSelector = "#delete-account-confirm";
const deleteAccountReauthPasskeySelector = "#delete-account-reauth-passkey";

const browserTimeout = workspaceE2ETimeouts.browserAction;
const uiTransition = workspaceE2ETimeouts.uiTransition;
const providerTransition = workspaceE2ETimeouts.providerTransition;
const navigationTimeout = workspaceE2ETimeouts.browserNavigation;

/**
 * The passkey journeys of the serial account lane, driven on the lane's one
 * page with a Chromium virtual platform authenticator. The lane owns one
 * instance for the whole worker, so the authenticator added before the
 * reactivation sign-in still serves the passkey cases after it.
 */
export type WorkspaceE2EAccountPasskeys = {
  /**
   * Reads whether the hydrated sign-in form offers passkeys: with
   * `login_passkeys` on, its email field asks for passkey autofill and the
   * passkey button follows the form.
   */
  readonly readSignInOffer: Effect.Effect<
    WorkspaceE2EPasskeySignInOffer,
    WorkspaceE2EError
  >;
  /** Adds the virtual authenticator to the lane page once. */
  readonly installAuthenticator: Effect.Effect<void, WorkspaceE2EError>;
  readonly readAuthenticatorCredentials: Effect.Effect<
    readonly VirtualAuthenticatorCredential[],
    WorkspaceE2EError
  >;
  /** Removes the virtual authenticator; a no-op when none is installed. */
  readonly removeAuthenticator: Effect.Effect<void, WorkspaceE2EError>;
  /** Creates a passkey from the post-sign-in prompt on the account page. */
  readonly createFromPrompt: Effect.Effect<void, WorkspaceE2EError>;
  /**
   * Signs in with the passkey button from the hydrated sign-in form, which
   * also has to settle the form's pending autofill request, and waits for
   * the account page.
   */
  readonly signIn: Effect.Effect<void, WorkspaceE2EError>;
  /** Renames the account's only passkey in Sign-in & security. */
  readonly renameOnly: (name: string) => Effect.Effect<void, WorkspaceE2EError>;
  /** Deletes the account's only passkey, named `name`, after confirmation. */
  readonly deleteOnly: (name: string) => Effect.Effect<void, WorkspaceE2EError>;
  /** Creates a passkey from Sign-in & security on a fresh session. */
  readonly createFromSettings: Effect.Effect<void, WorkspaceE2EError>;
  /**
   * Asks to delete the account behind the stale-session gate, confirms it
   * is the customer with the passkey, and closes the dialog at the returned
   * confirmation step, leaving the account in place.
   */
  readonly confirmDeletionWithPasskey: Effect.Effect<void, WorkspaceE2EError>;
};

/** A failure whose message is fixed text, safe for runner output. */
class PasskeyJourneyFailure extends Error {}

export const makeWorkspaceE2EAccountPasskeys = ({
  baseUrl,
  getPage,
  locale,
}: {
  readonly baseUrl: string;
  /** The lane's one page; throws when the lane has more or none. */
  readonly getPage: () => Page;
  readonly locale: Locale;
}): WorkspaceE2EAccountPasskeys => {
  const origin = new URL(baseUrl).origin;
  const accountPathname = `/${locale}/account`;
  const createdStatus = m.accountPasskeyCreated({}, { locale });
  const renamedStatus = m.accountPasskeyRenamed({}, { locale });
  const deletedStatus = m.accountPasskeyDeleted({}, { locale });
  const deleteLastBody = m.accountPasskeyDeleteLastBody({}, { locale });
  // The default name comes from the authenticator, so the rename control is
  // matched by its label with any name.
  const [renameLabelStart = "", renameLabelEnd = ""] = m
    .accountSecurityPasskeyRenameLabel({ name: "\u0000" }, { locale })
    .split("\u0000");
  const renameLabelPattern = new RegExp(
    `^${escapeRegExp(renameLabelStart)}.+${escapeRegExp(renameLabelEnd)}$`
  );
  let authenticator: PageVirtualAuthenticator | undefined;

  const operation = <A>(
    diagnosticCode: WorkspaceE2EAccountPasskeyDiagnosticCode,
    description: string,
    body: (page: Page) => Promise<A>
  ): Effect.Effect<A, WorkspaceE2EError> =>
    Effect.tryPromise({
      // Playwright causes can carry the preview URL, so only fixed text, the
      // closed diagnostic code, and a redacted first line leave this
      // boundary.
      catch: (cause) =>
        cause instanceof errors.TimeoutError
          ? workspaceE2ETimeoutError(`${description} timed out`, {
              diagnosticCode,
              operation: description,
            })
          : workspaceE2EError(
              `${description} failed: ${
                cause instanceof PasskeyJourneyFailure
                  ? cause.message
                  : describeBrowserFailure(cause)
              }`,
              { diagnosticCode, operation: description }
            ),
      try: () => {
        let page: Page;
        try {
          page = getPage();
        } catch {
          throw new PasskeyJourneyFailure("the lane has no single page");
        }
        return body(page);
      },
    });

  const clickHydrated = async (
    page: Page,
    selector: string,
    timeout = browserTimeout
  ) => {
    const control = page.locator(selector);
    await control.waitFor({ state: "visible", timeout });
    await waitForReactClickHandler(page, control);
    await control.click({ timeout: browserTimeout });
  };

  const openSecuritySection = async (page: Page) => {
    await selectAccountSection(page, "security");
  };

  const passkeyRows = (page: Page) => page.locator(passkeyRowSelector);

  const waitPasskeyRowCount = async (page: Page, count: number) => {
    await expect(passkeyRows(page)).toHaveCount(count, {
      timeout: uiTransition,
    });
  };

  const waitSecurityStatus = async (page: Page, text: string) => {
    await page
      .locator(securityStatusSelector)
      .filter({ hasText: text })
      .waitFor({ state: "attached", timeout: providerTransition });
  };

  const requireAuthenticator = () => {
    if (authenticator === undefined) {
      throw new PasskeyJourneyFailure("no virtual authenticator is installed");
    }
    return authenticator;
  };

  /** Runs a ceremony the customer starts, with the authenticator answering. */
  const answerCeremony = <A>(ceremony: () => Promise<A>) =>
    requireAuthenticator().answerCeremony(ceremony);

  return {
    readSignInOffer: operation(
      "account_passkey_sign_in_offer_failed",
      "read the sign-in passkey offer",
      async (page) => {
        const autocomplete = await page
          .locator(signInEmailSelector)
          .getAttribute("autocomplete", { timeout: browserTimeout });
        if (!(autocomplete ?? "").split(/\s+/).includes("webauthn")) {
          return "absent";
        }
        await page
          .locator(signInPasskeySelector)
          .waitFor({ state: "visible", timeout: uiTransition });
        return "offered";
      }
    ),
    installAuthenticator: operation(
      "account_passkey_authenticator_failed",
      "add the virtual passkey authenticator",
      async (page) => {
        authenticator ??= await addVirtualAuthenticator(page);
      }
    ),
    readAuthenticatorCredentials: operation(
      "account_passkey_authenticator_failed",
      "read the virtual authenticator credentials",
      async () => requireAuthenticator().readCredentials()
    ),
    removeAuthenticator: operation(
      "account_passkey_authenticator_failed",
      "remove the virtual passkey authenticator",
      async () => {
        const installed = authenticator;
        authenticator = undefined;
        await installed?.remove();
      }
    ),
    createFromPrompt: operation(
      "account_passkey_prompt_failed",
      "create a passkey from the post-sign-in prompt",
      async (page) => {
        await answerCeremony(async () => {
          await clickHydrated(page, promptCreateSelector, uiTransition);
          // The prompt closes itself once the passkey is saved.
          await page
            .locator(promptCreateSelector)
            .waitFor({ state: "hidden", timeout: providerTransition });
        });
      }
    ),
    signIn: operation(
      "account_passkey_sign_in_failed",
      "sign in with the passkey button",
      async (page) => {
        // Presence answers every autofill request the form starts during the
        // ceremony and signs the customer in without the button, but leaves
        // one already pending. So the step waits for the form's request, and
        // the click has to cancel it. The form starts another after a failed
        // button ceremony, so the authenticator also checks that only the
        // button's request signed in.
        const installed = requireAuthenticator();
        await installed.waitForConditionalRequest(uiTransition);
        await installed
          .answerModalCeremony(async () => {
            await clickHydrated(page, signInPasskeySelector, uiTransition);
            await page.waitForURL(
              (url) =>
                url.origin === origin && url.pathname === accountPathname,
              { timeout: navigationTimeout }
            );
          })
          .catch((cause: unknown) => {
            throw cause instanceof ModalCeremonyNotAlone
              ? new PasskeyJourneyFailure(cause.message)
              : cause;
          });
      }
    ),
    renameOnly: (name) =>
      operation(
        "account_passkey_rename_failed",
        "rename the passkey in Sign-in & security",
        async (page) => {
          await openSecuritySection(page);
          await waitPasskeyRowCount(page, 1);
          await passkeyRows(page)
            .getByRole("button", { name: renameLabelPattern })
            .click({ timeout: browserTimeout });
          const input = page.locator(renameInputSelector);
          await input.waitFor({ state: "visible", timeout: uiTransition });
          await input.fill(name, { timeout: browserTimeout });
          await page
            .locator(renameSaveSelector)
            .click({ timeout: browserTimeout });
          await waitSecurityStatus(page, renamedStatus);
          await expect(passkeyRows(page).filter({ hasText: name })).toHaveCount(
            1,
            { timeout: uiTransition }
          );
        }
      ),
    deleteOnly: (name) =>
      operation(
        "account_passkey_delete_failed",
        "delete the last passkey in Sign-in & security",
        async (page) => {
          await openSecuritySection(page);
          await waitPasskeyRowCount(page, 1);
          await passkeyRows(page)
            .getByRole("button", {
              exact: true,
              name: m.accountSecurityPasskeyDeleteLabel({ name }, { locale }),
            })
            .click({ timeout: browserTimeout });
          const confirm = page.locator(deletePasskeyConfirmSelector);
          await confirm.waitFor({ state: "visible", timeout: uiTransition });
          // The last passkey's dialog says email sign-in keeps working.
          await page
            .getByRole("dialog")
            .filter({ hasText: deleteLastBody })
            .waitFor({ state: "visible", timeout: browserTimeout });
          await confirm.click({ timeout: browserTimeout });
          await waitSecurityStatus(page, deletedStatus);
          await waitPasskeyRowCount(page, 0);
        }
      ),
    createFromSettings: operation(
      "account_passkey_settings_create_failed",
      "create a passkey from Sign-in & security",
      async (page) => {
        await openSecuritySection(page);
        await answerCeremony(async () => {
          await clickHydrated(page, addPasskeySelector);
          const create = page.locator(addPasskeyCreateSelector);
          const reauthenticate = page.locator(addPasskeyReauthSendSelector);
          const created = page
            .locator(securityStatusSelector)
            .filter({ hasText: createdStatus });
          await create
            .or(reauthenticate)
            .or(created)
            .first()
            .waitFor({ state: "attached", timeout: uiTransition });
          if (await reauthenticate.isVisible()) {
            throw new PasskeyJourneyFailure(
              "the fresh passkey session was asked to reauthenticate"
            );
          }
          if (await create.isVisible()) {
            await waitForReactClickHandler(page, create);
            await create.click({ timeout: browserTimeout });
          }
          await waitSecurityStatus(page, createdStatus);
        });
        await waitPasskeyRowCount(page, 1);
      }
    ),
    confirmDeletionWithPasskey: operation(
      "account_passkey_deletion_reauth_failed",
      "confirm account deletion with a passkey",
      async (page) => {
        await selectAccountSection(page, "danger");
        await clickHydrated(page, deleteAccountTriggerSelector);
        await page
          .locator(deleteAccountCheckboxSelector)
          .click({ timeout: browserTimeout });
        await page
          .locator(deleteAccountConfirmSelector)
          .click({ timeout: browserTimeout });
        await answerCeremony(async () => {
          await clickHydrated(
            page,
            deleteAccountReauthPasskeySelector,
            providerTransition
          );
          // A confirmed passkey returns the dialog to its destructive
          // confirmation, which the customer has to confirm again.
          await page
            .locator(deleteAccountReauthPasskeySelector)
            .waitFor({ state: "detached", timeout: providerTransition });
        });
        const confirm = page.locator(deleteAccountConfirmSelector);
        await confirm.waitFor({ state: "visible", timeout: uiTransition });
        await page.keyboard.press("Escape");
        await confirm.waitFor({ state: "hidden", timeout: uiTransition });
      }
    ),
  };
};
