import {
  type DotyposCustomerId,
  type DotyposReservationId,
  normalizePhoneNumber,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { getAccountSectionPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { localeCookieName } from "@/features/i18n/routing";
import { maskEmailAddress } from "@/shared/utils";
import {
  clickBrowserElement,
  evalBrowserScript,
  fillBrowserField,
  focusBrowserElement,
  normalizeBrowserText,
  openBrowserPage,
  pressBrowserKey,
  readBrowserText,
  readBrowserUrl,
  waitForBrowserCondition,
  waitForBrowserReactFormSubmit,
  waitForBrowserReactHandler,
  waitForBrowserText,
  waitForBrowserUrl,
  waitForInteractiveSnapshot,
} from "../browser";
import { switchLocale } from "../cases/locale";
import type { DatasourceConfig } from "../config";
import {
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import { pollUntil } from "../polling";
import {
  waitForNoRememberedReferralCode,
  waitForRememberedReferralCode,
} from "../referrals/referral-cookie";
import { addRedaction, assert, parseUrl, type Runner } from "../runtime";
import {
  workspaceE2EPollInitialIntervalMs,
  workspaceE2EPollIntervalMs,
  workspaceE2ETimeouts,
} from "../timeouts";
import {
  accountSectionLandmarks,
  selectAccountSectionInRunner,
} from "./account-sections";
import {
  assertNoAuthRows,
  countAccountPasskeys,
  findAuthUserIdByEmail,
  findLinkedDotyposCustomerId,
  readNewestSessionCreatedAt,
  removeSyntheticAccountLink,
  setAccountLocalePreference,
  setDeletionRequestedAt,
  setSessionCreatedAt,
} from "./auth-rows";
import type { WorkspaceE2EAccountCaseId } from "./catalog";
import type { WorkspaceE2EAccountConfig } from "./config";
import {
  makeWorkspaceE2EAccountRecipient,
  workspaceE2EAccountMainRecipientLabel,
  workspaceE2EReferralOwnerRecipientLabel,
} from "./config";
import {
  assertNoSyntheticCustomerProfile,
  cancelSyntheticReservation,
  createSyntheticCustomerProfile,
  createSyntheticReservation,
  expireSyntheticCustomerProfile,
  readSyntheticCustomerProfile,
} from "./fixtures";
import type { WorkspaceE2EAccountPasskeys } from "./passkeys";
import { workspaceE2EAccountProfileFixture } from "./profile-fixture";
import type { MagicLinkRateBudget } from "./rate-budget";
import {
  findWorkspaceE2EReferralReferrer,
  seedWorkspaceE2EReferralOwner,
} from "./referral-fixture";
import type { LanguagePreferenceReviewCapture } from "./review-screenshots";
import type { LanguagePreferenceReviewStage } from "./review-targets";
import type {
  WorkspaceE2EAccountCase,
  WorkspaceE2EAccountCaseCompletion,
  WorkspaceE2EAccountJournalRef,
  WorkspaceE2EAccountLifecycleHandoff,
  WorkspaceE2EAccountRequirement,
} from "./types";
import type { WorkspaceE2EPreviewLogs } from "./vercel-log-retrieval";

const acceptedTitle = "Check your inbox";
const acceptedBody =
  "If the address can receive mail, a single-use link will arrive shortly. The link works once and expires in 10 minutes.";
const sendAnotherLinkLabel = "Send another link";
const signInCodeTitle = m.accountSignInCodeTitle({}, { locale: "en-US" });
const signInCodeInvalid = m.accountSignInCodeInvalid({}, { locale: "en-US" });
const useDifferentEmailLabel = m.accountSignInCodeChangeEmail(
  {},
  { locale: "en-US" }
);
/** The resend countdown ticks every second, so text comparisons drop it. */
const signInCodeResendCooldownPattern = /Send a new email in \d+ s/g;
const callbackFailedTitle = "This link cannot be used";
const completionTitle = "Complete your profile";
const profileSaved = "Profile updated.";
const linkedEditSubmitLabel = "Save profile";
const completionReferralApplied =
  "Your referral code was applied. You’ll get 15% off your first paid booking.";
const supportTitle = "We need to verify your profile";
const deletionPendingTitle = "Account deletion is pending";
const deletionReauthLinkSent =
  "If the address can receive mail, a new link is on its way.";
const deletionReauthCodeTitle = m.accountDeletionReauthCodeTitle(
  {},
  { locale: "en-US" }
);
const czechDeletionPendingTitle = m.accountDeletionPendingTitle(
  {},
  { locale: "cs-CZ" }
);
const deletedTitle = "Your account was deleted";
const currentReservationsTitle = "Current and upcoming";
const pastReservationsTitle = "Past reservations";
const cancelledStatus = "Cancelled";
const confirmedStatus = "Confirmed";

const signInSuffix = "/auth/sign-in";
const accountSuffix = "/account";
const callbackSuffix = "/auth/callback";
/**
 * A static public page for the saved-preference redirect check. Unlike the
 * gallery it renders without provider calls, so the redirect and its review
 * capture never touch the shared Cloudinary quota.
 */
const publicPreferenceProbeSuffix = "/faq";

const signInFormSelector = "#account-sign-in-form";
const signInEmailSelector = "#account-sign-in-email";
const signInSubmitSelector = "#account-sign-in-submit";
const signInCodeSelector = "#account-sign-in-code";
const profileFirstNameSelector = "#account-profile-first-name";
const profileLastNameSelector = "#account-profile-last-name";
const profilePhoneSelector = "#account-profile-phone";
const profileEmailSelector = "#account-profile-email";
const profileSubmitSelector = "#account-profile-form button[type=submit]";
const profileReferralCodeSelector = "#profile-referral-code";
const billingKindSelector = "#account-profile-billing-kind";
const billingCompanyNameSelector = "#account-profile-billing-company-name";
const signOutSelector = "#account-sign-out";
const deleteTriggerSelector = "#delete-account-trigger";
const deleteReauthSendSelector = "#delete-account-reauth-send";
const deleteConfirmCheckboxSelector = "#confirm-account-deletion";
const deleteConfirmSelector = "#delete-account-confirm";

const billingCompanyFixture = "E2E Draft Company";
const passkeyNameFixture = "Workspace E2E passkey";

const browserTimeout = workspaceE2ETimeouts.browserAction;
const uiTransition = workspaceE2ETimeouts.uiTransition;
const providerTransition = workspaceE2ETimeouts.providerTransition;
const datasourceTimeout = workspaceE2ETimeouts.datasource;
const authDeliveryTimeout = workspaceE2ETimeouts.authDelivery;
const navigationTimeout = workspaceE2ETimeouts.browserNavigation;
const caseTimeout = workspaceE2ETimeouts.accountCase;

/**
 * One datasource-backed account page assertion after navigation: a full
 * browser command window plus a full datasource convergence window, since
 * server-rendered reservation content races a bare uiTransition budget.
 */
const accountPageLoadTimeout = browserTimeout + datasourceTimeout;

/**
 * The deployed deletion gate treats a session as stale after ten minutes;
 * back-dating by eleven makes the reauthentication branch deterministic.
 */
const staleSessionAgeMs = 11 * 60_000;

/**
 * A bounded settle after a submit that native validation must have blocked;
 * the accepted response must not appear within it.
 */
const invalidEmailSettleMs = 2_000;

export type WorkspaceE2EAccountCaseInputs = {
  /**
   * Review capture for the language case's mid-case moments. The lane
   * supplies the review wrapper's hook; without one nothing is captured.
   */
  readonly captureLanguagePreferenceReview?: LanguagePreferenceReviewCapture;
  readonly config: WorkspaceE2EAccountConfig;
  readonly datasourceConfig: DatasourceConfig;
  /**
   * The worker-scoped lane fixture owns this mutable handoff once; the case
   * factory is rebuilt for every Playwright test, so a factory-local object
   * could never carry the completed lifecycle between the account cases.
   */
  readonly lifecycleHandoff: WorkspaceE2EAccountLifecycleHandoff;
  /**
   * The worker-scoped passkey journeys, whose virtual authenticator must
   * outlive one case: the reactivation case adds it before its sign-in, and
   * the passkey cases after it use and remove it.
   */
  readonly passkeys: WorkspaceE2EAccountPasskeys;
  readonly previewLogs: WorkspaceE2EPreviewLogs;
  readonly rateBudget: MagicLinkRateBudget;
  readonly run: Runner;
  readonly session: string;
};

/**
 * Builds the serial account lifecycle lane. The cases share one browser
 * session and one synthetic identity chain, ordered so each delivered link,
 * provider fixture, and deletion transition is exercised against the exact
 * protected preview and its matching migrated Neon branch.
 */
export const makeWorkspaceE2EAccountCases = ({
  captureLanguagePreferenceReview,
  config,
  datasourceConfig,
  lifecycleHandoff,
  passkeys,
  previewLogs,
  rateBudget,
  run,
  session,
}: WorkspaceE2EAccountCaseInputs): readonly WorkspaceE2EAccountCase[] => {
  const recipient = makeWorkspaceE2EAccountRecipient(
    config,
    workspaceE2EAccountMainRecipientLabel
  );
  const acceptedRecipientTwo = makeWorkspaceE2EAccountRecipient(
    config,
    "accepted-b"
  );
  const localized = (suffix: string, locale: Locale = config.locale) =>
    `${config.baseUrl}/${locale}${suffix}`;

  const openPage = (url: string) =>
    openBrowserPage(config, run, session, url, { timeoutMs: browserTimeout });

  const waitText = (
    description: string,
    text: string,
    timeoutMs = uiTransition
  ) =>
    waitForBrowserText({
      description,
      matches: (pageText) => pageText.includes(text),
      run,
      session,
      timeoutMs,
    });

  const waitUrlContains = (description: string, expected: string) =>
    pollUntil(
      readBrowserUrl(run, session).pipe(
        Effect.map((url) => (url?.includes(expected) ? url : undefined))
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.browser,
        label: description,
        timeoutMs: uiTransition,
      }
    );

  const previewOrigin = new URL(config.baseUrl).origin;
  /** Passkeys bind to the preview's own host as their relying party. */
  const previewRpId = new URL(config.baseUrl).hostname;
  const waitPathname = (
    description: string,
    matches: (pathname: string) => boolean
  ) =>
    waitForBrowserUrl({
      description,
      matches: (url) => {
        const parsed = parseUrl(url);
        return parsed?.origin === previewOrigin && matches(parsed.pathname);
      },
      run,
      session,
      timeoutMs: navigationTimeout,
    });

  const captureLanguageReview = (stage: LanguagePreferenceReviewStage) =>
    captureLanguagePreferenceReview === undefined
      ? Effect.void
      : Effect.tryPromise({
          catch: (cause) =>
            workspaceE2EError("capture language preference review", {
              cause,
              operation: "capture language preference review",
            }),
          try: () => captureLanguagePreferenceReview(stage),
        });

  const waitDefaultReservations = (description: string) =>
    waitForBrowserCondition(
      run,
      session,
      description,
      `(() => {
        const landmark = document.querySelector(${JSON.stringify(accountSectionLandmarks.reservations)});
        return landmark !== null && landmark.closest("[hidden]") === null;
      })()`,
      { timeoutMs: uiTransition }
    );

  const withoutTrailingSlash = (url: string) =>
    url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url;

  /**
   * Signs out on the current device and proves the session is gone. The
   * sign-out button resolves its server request before assigning the bare
   * root of the page's locale, so only that exact root URL proves the logout
   * finished, and a fresh protected-account visit must then redirect the
   * anonymous browser to the sign-in form. The account URL itself must never
   * satisfy the landing wait, which is why the comparison is exact rather
   * than a substring.
   */
  const signOutAndRequireAnonymous = (pageLocale: Locale = config.locale) =>
    Effect.gen(function* () {
      yield* clickBrowserElement(run, session, signOutSelector, {
        timeoutMs: browserTimeout,
      });
      yield* pollUntil(
        readBrowserUrl(run, session).pipe(
          Effect.map((url) =>
            url !== undefined &&
            withoutTrailingSlash(url) === localized("", pageLocale)
              ? url
              : undefined
          )
        ),
        {
          intervalMs: workspaceE2EPollIntervalMs.browser,
          label: "sign-out landing on the bare locale root",
          timeoutMs: uiTransition,
        }
      );
      yield* openPage(localized(accountSuffix));
      yield* waitUrlContains(
        "anonymous account redirect after sign-out",
        signInSuffix
      );
      yield* waitSignInForm();
    });

  const readNormalizedText = () =>
    readBrowserText(run, session).pipe(Effect.map(normalizeBrowserText));

  const waitSignInForm = () =>
    waitForBrowserReactFormSubmit(
      run,
      session,
      signInFormSelector,
      [signInEmailSelector],
      { timeoutMs: browserTimeout }
    );

  /**
   * The share-link sign-in page: the anonymous account redirect lands on the
   * plain localized sign-in form, and the browser remembers the shared code
   * in its referral cookie, which carries it through the magic-link round
   * trip instead of any URL.
   */
  const waitShareLinkSignIn = Effect.fn("waitShareLinkSignIn")(function* (
    referralCode: string
  ) {
    yield* pollUntil(
      readBrowserUrl(run, session).pipe(
        Effect.map((url) => {
          if (url === undefined) return undefined;
          const current = new URL(url);
          return current.pathname === `/${config.locale}${signInSuffix}` &&
            !current.searchParams.has("ref")
            ? url
            : undefined;
        })
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.browser,
        label: "plain sign-in page after the share-link redirect",
        timeoutMs: uiTransition,
      }
    );
    yield* waitForRememberedReferralCode(
      { config, run, session },
      referralCode
    );
    yield* waitSignInForm();
  });

  const waitReferralFieldValue = (description: string, value: string) =>
    waitForBrowserCondition(
      run,
      session,
      description,
      `(() => {
          const input = document.querySelector(${JSON.stringify(profileReferralCodeSelector)});
          return input instanceof HTMLInputElement &&
            input.name === "referralCode" &&
            input.value === ${JSON.stringify(value)};
        })()`,
      { timeoutMs: uiTransition }
    );

  const requireReferralInvitation = () =>
    Effect.sync(() => {
      const invitation = lifecycleHandoff.referralInvitation;
      assert(
        invitation,
        "the share-link case did not record the referral invitation"
      );
      return invitation;
    });

  const fillAndSubmitEmail = (email: string) =>
    Effect.gen(function* () {
      yield* fillBrowserField(run, session, signInEmailSelector, email, {
        timeoutMs: browserTimeout,
      });
      yield* clickBrowserElement(run, session, signInSubmitSelector, {
        timeoutMs: browserTimeout,
      });
    });

  /** Waits until the code input of a sign-in code step takes typed digits. */
  const waitSignInCodeInput = () =>
    waitForBrowserReactHandler(run, session, signInCodeSelector, "onChange", {
      timeoutMs: browserTimeout,
    });

  /**
   * Waits for the card an accepted sign-in email leaves and reports which
   * one it is. With `login_email_code` off it is the inbox notice; with the
   * flag on the same accepted request opens the code step instead.
   */
  const waitSignInAccepted = Effect.fn("waitSignInAccepted")(function* (
    description: string
  ) {
    const pageText = yield* waitForBrowserText({
      description,
      matches: (text) =>
        text.includes(acceptedTitle) || text.includes(signInCodeTitle),
      run,
      session,
      timeoutMs: uiTransition,
    });
    if (!pageText.includes(signInCodeTitle)) {
      return "inbox" as const;
    }
    yield* waitSignInCodeInput();
    return "code" as const;
  });

  /**
   * Submits the sign-in form for one synthetic recipient. The serial lane
   * reserves every magic-link operation at case level, so this step never
   * waits on the operation budget. The emailed link signs in either way, so
   * a code step is left untouched.
   */
  const requestSignInLink = (email: string) =>
    Effect.gen(function* () {
      yield* openPage(localized(signInSuffix));
      yield* waitSignInForm();
      yield* fillAndSubmitEmail(email);
      const confirmation = yield* waitSignInAccepted(
        "generic accepted sign-in response"
      );
      if (confirmation === "inbox") {
        yield* waitText("generic accepted sign-in body", acceptedBody);
      }
    });

  /**
   * The baseline IDs prevent repeated sign-ins from matching a stale link.
   */
  const retrieveSignInLink = (
    email: string,
    observedLogEntryIds: readonly string[],
    startedAt: Date
  ) =>
    previewLogs.retrieveMagicLink({
      callbackPath: `/${config.locale}${callbackSuffix}`,
      excludeLogEntryIds: observedLogEntryIds,
      recipient: email,
      startedAt,
    });

  const observeDeliveredLogEntryIds = (email: string, startedAt: Date) =>
    previewLogs.listSyntheticLogEntryIds({
      recipient: email,
      startedAt,
    });

  const requireAuthUserId = (email: string) =>
    Effect.gen(function* () {
      const userId = yield* findAuthUserIdByEmail(email);
      assert(
        userId,
        "expected a synthetic Better Auth user for the verified recipient"
      );
      return userId;
    });

  const requireLinkedCustomerId = (userId: string) =>
    Effect.gen(function* () {
      const customerId = yield* findLinkedDotyposCustomerId(userId);
      assert(
        customerId,
        "expected a linked Dotypos customer for the synthetic account"
      );
      return customerId as DotyposCustomerId;
    });

  const recordFixtureIds = (
    journalRef: WorkspaceE2EAccountJournalRef,
    update: {
      readonly authUserIds?: readonly string[];
      readonly dotyposCustomerIds?: readonly string[];
      readonly dotyposReservationIds?: readonly string[];
    }
  ) =>
    Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("record workspace account e2e fixture", {
          cause,
          operation: "record workspace account e2e fixture",
        }),
      try: () =>
        journalRef.record({
          authUserIds: update.authUserIds ?? [],
          dotyposCustomerIds: update.dotyposCustomerIds ?? [],
          dotyposReservationIds: update.dotyposReservationIds ?? [],
        }),
    });

  const passkeysOffered = () => lifecycleHandoff.passkeySignIn === "offered";

  const requirePasskeyCount = (
    userId: string,
    expected: number,
    message: string
  ) =>
    countAccountPasskeys(userId).pipe(
      Effect.flatMap((count) =>
        Effect.sync(() => assert(count === expected, message))
      )
    );

  const readProviderProfile = (customerId: string) =>
    readSyntheticCustomerProfile(
      datasourceConfig,
      customerId as DotyposCustomerId
    ).pipe(
      Effect.timeoutOrElse({
        duration: `${datasourceTimeout} millis`,
        orElse: () =>
          workspaceE2ETimeoutError("provider profile read timed out", {
            operation: "read provider profile",
          }),
      })
    );

  const makeCase = (
    id: WorkspaceE2EAccountCaseId,
    execute: (
      context: Parameters<WorkspaceE2EAccountCase["execute"]>[0]
    ) => Effect.Effect<
      void | WorkspaceE2EAccountCaseCompletion,
      WorkspaceE2EError,
      WorkspaceE2EAccountRequirement
    >
  ): WorkspaceE2EAccountCase => ({
    execute: (context) =>
      execute(context).pipe(
        Effect.map((completion) =>
          completion === undefined ? { cleanup: Effect.void } : completion
        )
      ),
    id,
    timeoutMs: caseTimeout,
  });

  const step = <A, R>(
    id: string,
    execute: Effect.Effect<A, WorkspaceE2EError, R>,
    timeoutMs = uiTransition
  ) => ({ execute, id, timeoutMs });

  return [
    makeCase("account-anonymous-redirect", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const referralOwnerEmail = makeWorkspaceE2EAccountRecipient(
          config,
          workspaceE2EReferralOwnerRecipientLabel
        );
        const referralOwnerAccountId = customerAccountIdSchema.make(
          `account-referral-owner-${crypto.randomUUID()}`
        );
        const invitation = yield* runStep(
          step(
            "creates the synthetic referrer whose share link the account follows",
            Effect.gen(function* () {
              yield* recordFixtureIds(journalRef, {
                authUserIds: [referralOwnerAccountId],
              });
              const customerId = yield* createSyntheticCustomerProfile(
                datasourceConfig,
                { email: referralOwnerEmail, firstName: "Referral Owner" }
              );
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [customerId],
              });
              const owner = yield* seedWorkspaceE2EReferralOwner({
                accountId: referralOwnerAccountId,
                dotyposCustomerId: customerId,
                email: referralOwnerEmail,
                name: "Synthetic Referral Owner",
              });
              addRedaction(owner.code, true);
              return { code: owner.code, referrerCustomerId: customerId };
            }),
            datasourceTimeout
          )
        );
        lifecycleHandoff.referralInvitation = invitation;
        yield* runStep(
          step(
            "remembers an anonymous locale-free share link and redirects to sign-in",
            Effect.gen(function* () {
              yield* waitForNoRememberedReferralCode({ config, run, session });
              yield* openPage(
                `${config.baseUrl}${accountSuffix}?ref=${invitation.code}`
              );
              yield* waitShareLinkSignIn(invitation.code);
            })
          )
        );
      })
    ),
    makeCase("account-sign-in-form", ({ runStep }) =>
      Effect.gen(function* () {
        const invitation = yield* runStep(
          step(
            "requires the share-link sign-in handoff",
            requireReferralInvitation()
          )
        );
        lifecycleHandoff.passkeySignIn = yield* runStep(
          step(
            "records whether the sign-in form offers passkeys",
            Effect.gen(function* () {
              yield* waitShareLinkSignIn(invitation.code);
              return yield* passkeys.readSignInOffer;
            })
          )
        );
        yield* runStep(
          step(
            "rejects an invalid email without requesting a link",
            Effect.gen(function* () {
              // Native validation blocks the submit, so the share-link form
              // stays loaded for the first accepted request.
              yield* waitShareLinkSignIn(invitation.code);
              yield* fillAndSubmitEmail("not-an-email");
              const validation = yield* evalBrowserScript(
                "assert native validation blocked the invalid email",
                run,
                session,
                `(() => {
                    const input = document.querySelector(${JSON.stringify(signInEmailSelector)});
                    return JSON.stringify({
                      blocked: input instanceof HTMLInputElement && input.validationMessage !== "",
                    });
                  })()`,
                { timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsed = JSON.parse(validation) as { blocked: boolean };
              assert(
                parsed.blocked,
                "the browser accepted an invalid email without native validation"
              );
              yield* Effect.sleep(invalidEmailSettleMs);
              const pageText = yield* readNormalizedText();
              assert(
                !pageText.includes(acceptedTitle) &&
                  !pageText.includes(signInCodeTitle),
                "an invalid email produced the accepted sign-in response"
              );
            })
          )
        );
        const firstAccepted = yield* rateBudget.run(
          "send",
          runStep(
            step(
              "accepts a first unknown email generically from the share-link form",
              Effect.gen(function* () {
                yield* waitShareLinkSignIn(invitation.code);
                const startedAt = new Date();
                lifecycleHandoff.firstAcceptedRequestedAt = startedAt;
                yield* fillAndSubmitEmail(recipient);
                const confirmation = yield* waitSignInAccepted(
                  "first generic accepted response"
                );
                lifecycleHandoff.signInConfirmation = confirmation;
                return { confirmation, text: yield* readNormalizedText() };
              })
            )
          )
        );
        const secondAccepted = yield* rateBudget.run(
          "send",
          runStep(
            step(
              "accepts a second unknown email with an identical response",
              Effect.gen(function* () {
                // The code step offers a different email instead of another link.
                const restartLabel =
                  firstAccepted.confirmation === "code"
                    ? useDifferentEmailLabel
                    : sendAnotherLinkLabel;
                yield* clickBrowserElement(
                  run,
                  session,
                  `button:has-text("${restartLabel}")`,
                  { timeoutMs: browserTimeout }
                );
                yield* waitSignInForm();
                lifecycleHandoff.secondAcceptedRequestedAt = new Date();
                yield* fillAndSubmitEmail(acceptedRecipientTwo);
                const confirmation = yield* waitSignInAccepted(
                  "second generic accepted response"
                );
                return { confirmation, text: yield* readNormalizedText() };
              })
            )
          )
        );
        yield* runStep(
          step(
            "renders both accepted responses identically",
            Effect.sync(() => {
              const comparable = (text: string) =>
                text.replaceAll(signInCodeResendCooldownPattern, "");
              assert(
                firstAccepted.confirmation === secondAccepted.confirmation &&
                  comparable(firstAccepted.text) ===
                    comparable(secondAccepted.text),
                "the accepted response differs between unknown emails"
              );
              // Both synthetic recipients mask to the same address.
              const genericBody =
                firstAccepted.confirmation === "code"
                  ? m.accountSignInCodeBody(
                      { email: maskEmailAddress(recipient) },
                      { locale: "en-US" }
                    )
                  : acceptedBody;
              assert(
                firstAccepted.text.includes(genericBody),
                "the accepted response lost its generic body"
              );
            })
          )
        );
      })
    ),
    makeCase(
      "account-sign-in-code",
      Effect.fn("accountSignInCode")(function* ({ journalRef, runStep }) {
        const requestedAt = yield* runStep(
          step(
            "requires the second unknown email's code step",
            Effect.sync(() => {
              assert(
                lifecycleHandoff.signInConfirmation === "code",
                "the sign-in form did not open the code step"
              );
              const requestedAt = lifecycleHandoff.secondAcceptedRequestedAt;
              assert(
                requestedAt,
                "the sign-in form did not record the second request"
              );
              return requestedAt;
            })
          )
        );
        const { code } = yield* runStep(
          step(
            "retrieves the delivered sign-in code",
            previewLogs.retrieveSignInEmail({
              callbackPath: `/${config.locale}${callbackSuffix}`,
              excludeLogEntryIds: [],
              recipient: acceptedRecipientTwo,
              startedAt: requestedAt,
            }),
            authDeliveryTimeout
          )
        );
        yield* runStep(
          step(
            "rejects a wrong code and keeps the code step",
            Effect.gen(function* () {
              yield* waitSignInCodeInput();
              yield* fillBrowserField(
                run,
                session,
                signInCodeSelector,
                code === "000000" ? "111111" : "000000",
                { timeoutMs: browserTimeout }
              );
              yield* waitText("wrong code status", signInCodeInvalid);
              yield* waitForBrowserCondition(
                run,
                session,
                "emptied code input after a wrong code",
                `(() => {
                  const input = document.querySelector(${JSON.stringify(signInCodeSelector)});
                  return input instanceof HTMLInputElement && !input.disabled && input.value === "";
                })()`,
                { timeoutMs: uiTransition }
              );
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "signs in with the emailed code into the completion state",
            Effect.gen(function* () {
              yield* fillBrowserField(run, session, signInCodeSelector, code, {
                timeoutMs: browserTimeout,
              });
              yield* waitPathname(
                "account landing after the code sign-in",
                (pathname) => pathname === `/${config.locale}${accountSuffix}`
              );
              yield* waitText(
                "completion state after the code sign-in",
                completionTitle
              );
              const userId = yield* requireAuthUserId(acceptedRecipientTwo);
              yield* recordFixtureIds(journalRef, { authUserIds: [userId] });
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "signs the code account out before the main link sign-in",
            signOutAndRequireAnonymous(),
            navigationTimeout
          )
        );
      })
    ),
    makeCase("account-magic-link-delivery", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const firstRequest = yield* runStep(
          step(
            "requires the first accepted main request handoff",
            Effect.gen(function* () {
              const requestedAt = lifecycleHandoff.firstAcceptedRequestedAt;
              assert(
                requestedAt,
                "the sign-in form did not record the first main request"
              );
              const invitation = yield* requireReferralInvitation();
              return { invitation, requestedAt };
            })
          )
        );
        yield* runStep(
          step(
            "leaves Dotypos untouched before verification",
            assertNoSyntheticCustomerProfile(datasourceConfig, recipient).pipe(
              Effect.timeoutOrElse({
                duration: `${datasourceTimeout} millis`,
                orElse: () =>
                  workspaceE2ETimeoutError(
                    "Dotypos pre-verification read timed out",
                    { operation: "Dotypos pre-verification read" }
                  ),
              })
            ),
            datasourceTimeout
          )
        );
        const link = yield* runStep(
          step(
            "retrieves the delivered single-use link",
            retrieveSignInLink(recipient, [], firstRequest.requestedAt),
            authDeliveryTimeout
          )
        );
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "consumes the link into the completion state with the share code",
              Effect.gen(function* () {
                yield* openPage(link);
                yield* waitText(
                  "completion state after verification",
                  completionTitle
                );
                yield* waitUrlContains(
                  "account URL after verification",
                  accountSuffix
                );
                yield* waitReferralFieldValue(
                  "completion referral field prefilled through sign-in",
                  firstRequest.invitation.code
                );
                const userId = yield* requireAuthUserId(recipient);
                yield* recordFixtureIds(journalRef, { authUserIds: [userId] });
              }),
              providerTransition
            )
          )
        );
      })
    ),
    makeCase("account-profile-completion", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const invitation = yield* runStep(
          step(
            "requires the share-link referral handoff",
            requireReferralInvitation()
          )
        );
        yield* runStep(
          step(
            "keeps the completion login email input read-only",
            Effect.gen(function* () {
              yield* waitText("completion page", completionTitle);
              const result = yield* evalBrowserScript(
                "assert the completion login email is read-only",
                run,
                session,
                `(() => {
                    const input = document.querySelector(${JSON.stringify(profileEmailSelector)});
                    return JSON.stringify({
                      readOnly: input instanceof HTMLInputElement && input.readOnly,
                      matches: input instanceof HTMLInputElement && input.value === ${JSON.stringify(recipient)},
                    });
                  })()`,
                { timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsed = JSON.parse(result) as {
                matches: boolean;
                readOnly: boolean;
              };
              assert(
                parsed.readOnly,
                "the completion login email input is editable"
              );
              assert(
                parsed.matches,
                "the completion login email input shows a different address"
              );
            })
          )
        );
        yield* runStep(
          step(
            "completes the profile with the share code and a required first name",
            Effect.gen(function* () {
              yield* waitText("completion page", completionTitle);
              yield* waitReferralFieldValue(
                "completion referral field still holding the share code",
                invitation.code
              );
              yield* fillBrowserField(
                run,
                session,
                profileFirstNameSelector,
                workspaceE2EAccountProfileFixture.firstName,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(run, session, profileSubmitSelector, {
                timeoutMs: browserTimeout,
              });
              // The completion feedback is transient: the successful action
              // intentionally refreshes into the linked edit view, replacing
              // it. The durable contract is the edit form's submit control,
              // whose accessible name only the linked edit view renders.
              yield* waitForBrowserCondition(
                run,
                session,
                "linked account edit form with its Save profile submit control",
                `(() => {
                    const button = document.querySelector(${JSON.stringify(profileSubmitSelector)});
                    return button instanceof HTMLButtonElement &&
                      button.type === "submit" &&
                      button.textContent?.trim() === ${JSON.stringify(linkedEditSubmitLabel)};
                  })()`,
                { timeoutMs: uiTransition }
              );
              // The outcome shows on the linked account until dismissed, and
              // the recorded referral uses up the remembered code.
              yield* waitText(
                "applied share-link referral notice on the linked account",
                completionReferralApplied
              );
              yield* waitForNoRememberedReferralCode({ config, run, session });
            })
          )
        );
        const customerId = yield* runStep(
          step(
            "links the completed profile to the synthetic customer",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              const linked = yield* requireLinkedCustomerId(userId);
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [linked],
              });
              return linked;
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "records the share-link referral submitted with the completed profile",
            pollUntil(
              findWorkspaceE2EReferralReferrer(customerId).pipe(
                Effect.map((referrer) =>
                  referrer === invitation.referrerCustomerId
                    ? referrer
                    : undefined
                )
              ),
              {
                initialIntervalMs: workspaceE2EPollInitialIntervalMs.database,
                intervalMs: workspaceE2EPollIntervalMs.datasource,
                label: "share-link referral recorded by profile completion",
                timeoutMs: datasourceTimeout,
              }
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "keeps the linked login email display read-only",
            Effect.gen(function* () {
              yield* selectAccountSectionInRunner(run, session, "profile");
              const result = yield* evalBrowserScript(
                "assert the linked login email display is read-only",
                run,
                session,
                `(() => {
                    const profile = document.querySelector(${JSON.stringify(accountSectionLandmarks.profile)});
                    const emailField = profile instanceof HTMLElement
                      ? Array.from(profile.querySelectorAll("fieldset")).find((field) =>
                          field.textContent?.includes(${JSON.stringify(recipient)})
                        )
                      : undefined;
                    return JSON.stringify({
                      editable: emailField?.querySelector("input, textarea, select") !== null,
                      matches: emailField?.textContent?.includes(${JSON.stringify(recipient)}) === true,
                    });
                  })()`,
                { timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsed = JSON.parse(result) as {
                editable: boolean;
                matches: boolean;
              };
              assert(
                parsed.matches,
                "the linked login email display shows a different address"
              );
              assert(
                !parsed.editable,
                "the linked login email display exposes an editable control"
              );
            })
          )
        );
        yield* runStep(
          step(
            "persists optional profile and billing fields to the provider profile",
            Effect.gen(function* () {
              yield* selectAccountSectionInRunner(run, session, "profile");
              yield* fillBrowserField(
                run,
                session,
                profileLastNameSelector,
                workspaceE2EAccountProfileFixture.lastName,
                { timeoutMs: browserTimeout }
              );
              yield* fillBrowserField(
                run,
                session,
                profilePhoneSelector,
                workspaceE2EAccountProfileFixture.phone,
                { timeoutMs: browserTimeout }
              );
              yield* selectAccountSectionInRunner(run, session, "billing");
              yield* focusBrowserElement(run, session, billingKindSelector, {
                timeoutMs: browserTimeout,
              });
              yield* pressBrowserKey(run, session, "End", {
                timeoutMs: browserTimeout,
              });
              yield* pressBrowserKey(run, session, "Tab", {
                timeoutMs: browserTimeout,
              });
              yield* waitForBrowserCondition(
                run,
                session,
                "business billing kind",
                `(() => document.querySelector(${JSON.stringify(billingKindSelector)})?.value === "business")()`,
                { timeoutMs: uiTransition }
              );
              yield* fillBrowserField(
                run,
                session,
                billingCompanyNameSelector,
                billingCompanyFixture,
                { timeoutMs: browserTimeout }
              );
              yield* selectAccountSectionInRunner(run, session, "profile");
              const drafts = yield* evalBrowserScript(
                "assert profile and billing drafts survived section navigation",
                run,
                session,
                `(() => {
                    const firstName = document.querySelector(${JSON.stringify(profileFirstNameSelector)});
                    const lastName = document.querySelector(${JSON.stringify(profileLastNameSelector)});
                    const phone = document.querySelector(${JSON.stringify(profilePhoneSelector)});
                    const companyName = document.querySelector(${JSON.stringify(billingCompanyNameSelector)});
                    return JSON.stringify({
                      profilePreserved:
                        firstName instanceof HTMLInputElement &&
                        lastName instanceof HTMLInputElement &&
                        phone instanceof HTMLInputElement &&
                        firstName.value === ${JSON.stringify(workspaceE2EAccountProfileFixture.firstName)} &&
                        lastName.value === ${JSON.stringify(workspaceE2EAccountProfileFixture.lastName)} &&
                        phone.value === ${JSON.stringify(workspaceE2EAccountProfileFixture.phone)},
                      billingPreserved:
                        companyName instanceof HTMLInputElement &&
                        companyName.value === ${JSON.stringify(billingCompanyFixture)},
                    });
                  })()`,
                { timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsedDrafts = JSON.parse(drafts) as {
                billingPreserved: boolean;
                profilePreserved: boolean;
              };
              assert(
                parsedDrafts.profilePreserved,
                "profile drafts changed across section navigation"
              );
              assert(
                parsedDrafts.billingPreserved,
                "billing drafts changed across section navigation"
              );
              yield* clickBrowserElement(run, session, profileSubmitSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitText("profile update saved", profileSaved);
              const customer = yield* readProviderProfile(customerId);
              assert(
                customer.lastName ===
                  workspaceE2EAccountProfileFixture.lastName,
                "the optional last name did not reach the provider profile"
              );
              assert(
                normalizePhoneNumber(customer.phone) ===
                  normalizePhoneNumber(workspaceE2EAccountProfileFixture.phone),
                "the optional phone did not reach the provider profile"
              );
              assert(
                customer.companyName === billingCompanyFixture,
                "the billing draft did not reach the provider profile"
              );
            }),
            datasourceTimeout
          )
        );
      })
    ),
    makeCase("account-reservation-transitions", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const customerId = yield* runStep(
          step(
            "reads the linked synthetic customer",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              return yield* requireLinkedCustomerId(userId);
            }),
            datasourceTimeout
          )
        );
        const reservations = yield* runStep(
          step(
            "creates far-future synthetic provider reservations",
            Effect.gen(function* () {
              const first = yield* createSyntheticReservation(
                datasourceConfig,
                {
                  customerId,
                }
              );
              const second = yield* createSyntheticReservation(
                datasourceConfig,
                {
                  customerId,
                }
              );
              const reservationIds = [first.reservationId, second.reservationId]
                .filter((value) => value !== undefined)
                .map((value) => value as string);
              yield* recordFixtureIds(journalRef, {
                dotyposReservationIds: reservationIds,
              });
              return [first, second];
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "shows the confirmed reservations in the current group",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              // One aria-snapshot poll samples the interactive tree for both
              // assertions; body innerText missed content the sanitized
              // snapshot already showed in the hosted context.
              yield* waitForInteractiveSnapshot({
                description: "current reservations group with a confirmed card",
                matches: (snapshot) =>
                  snapshot.includes(currentReservationsTitle) &&
                  snapshot.includes(confirmedStatus),
                run,
                session,
                timeoutMs: datasourceTimeout,
              });
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "cancels the second synthetic reservation",
            Effect.gen(function* () {
              const second = reservations[1]?.reservationId;
              assert(second, "second synthetic reservation id missing");
              yield* cancelSyntheticReservation(
                datasourceConfig,
                second as DotyposReservationId
              );
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "moves the cancelled reservation to the past group",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitForInteractiveSnapshot({
                description: "past reservations group with a cancelled card",
                matches: (snapshot) =>
                  snapshot.includes(pastReservationsTitle) &&
                  snapshot.includes(cancelledStatus),
                run,
                session,
                timeoutMs: datasourceTimeout,
              });
            }),
            accountPageLoadTimeout
          )
        );
      })
    ),
    makeCase("account-deletion-marker-reauth", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const userId = yield* runStep(
          step(
            "reads the synthetic account identity",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              const linked = yield* requireLinkedCustomerId(userId);
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [linked],
              });
              return { linked, userId };
            }),
            datasourceTimeout
          )
        );
        const startedAt = new Date();
        yield* runStep(
          step(
            "shows the durable deletion marker state",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* selectAccountSectionInRunner(run, session, "danger");
              yield* setDeletionRequestedAt(userId.userId, new Date());
              yield* setSessionCreatedAt(
                userId.userId,
                new Date(Date.now() - staleSessionAgeMs)
              );
              yield* openPage(localized(accountSuffix));
              yield* waitText("deletion pending state", deletionPendingTitle);
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "asks for reauthentication behind the stale-session gate",
            Effect.gen(function* () {
              yield* clickBrowserElement(run, session, deleteTriggerSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitForBrowserCondition(
                run,
                session,
                "deletion confirmation dialog",
                `(() => document.querySelector(${JSON.stringify(deleteConfirmSelector)}) !== null)()`,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(
                run,
                session,
                deleteConfirmCheckboxSelector,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(run, session, deleteConfirmSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitForBrowserCondition(
                run,
                session,
                "reauthentication dialog",
                `(() => document.querySelector(${JSON.stringify(deleteReauthSendSelector)}) !== null)()`,
                { timeoutMs: browserTimeout }
              );
            })
          )
        );
        const observedLogEntryIds = yield* runStep(
          step(
            "records the delivered log baseline",
            observeDeliveredLogEntryIds(recipient, startedAt),
            providerTransition
          )
        );
        yield* rateBudget.run(
          "send",
          runStep(
            step(
              "sends the reauthentication link",
              Effect.gen(function* () {
                yield* clickBrowserElement(
                  run,
                  session,
                  deleteReauthSendSelector,
                  { timeoutMs: browserTimeout }
                );
                // With sign-in codes on, the dialog opens its code step
                // instead. The emailed link still signs in, and the session
                // lifecycle case consumes it.
                const pageText = yield* waitForBrowserText({
                  description: "reauthentication email accepted",
                  matches: (text) =>
                    text.includes(deletionReauthLinkSent) ||
                    text.includes(deletionReauthCodeTitle),
                  run,
                  session,
                  timeoutMs: uiTransition,
                });
                if (pageText.includes(deletionReauthCodeTitle)) {
                  yield* waitSignInCodeInput();
                }
              })
            )
          )
        );
        const reauthenticationLink = yield* runStep(
          step(
            "retrieves the delivered reauthentication link",
            retrieveSignInLink(recipient, observedLogEntryIds, startedAt),
            authDeliveryTimeout
          )
        );
        lifecycleHandoff.reauthentication = {
          link: reauthenticationLink,
          userId: userId.userId,
          linkedCustomerId: userId.linked,
        };
      })
    ),
    makeCase("account-session-lifecycle", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const reauthentication = yield* runStep(
          step(
            "requires the reauthentication handoff from the marker case",
            Effect.sync(() => {
              const handoff = lifecycleHandoff.reauthentication;
              assert(
                handoff,
                "the deletion marker case did not complete the reauthentication handoff"
              );
              return handoff;
            })
          )
        );
        yield* runStep(
          step(
            "opens the pending account before signing out",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitText(
                "deletion pending state before sign-out",
                deletionPendingTitle
              );
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "signs out on the current device before consuming reauthentication",
            signOutAndRequireAnonymous(),
            navigationTimeout
          )
        );
        // A deletion-pending account keeps its saved preference but rejects
        // every save, so a fixture gives it Čeština. The reauthentication
        // link carries the English callback of the page that sent it, and
        // the sign-in must still land on the saved Czech site.
        yield* runStep(
          step(
            "saves Čeština as the pending account's preference",
            setAccountLocalePreference(reauthentication.userId, "cs-CZ"),
            datasourceTimeout
          )
        );
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "signs the same account back in onto the saved Czech site",
              Effect.gen(function* () {
                yield* openPage(reauthentication.link);
                yield* waitPathname(
                  "Czech account landing after the en-US reauthentication link",
                  (pathname) => pathname === `/cs-CZ${accountSuffix}`
                );
                yield* waitText(
                  "Czech deletion pending state after reauthentication",
                  czechDeletionPendingTitle
                );
                const userId = yield* requireAuthUserId(recipient);
                assert(
                  userId === reauthentication.userId,
                  "the reauthentication session used a different Better Auth id"
                );
                const linked = yield* requireLinkedCustomerId(userId);
                assert(
                  linked === reauthentication.linkedCustomerId,
                  "the reauthentication session lost the durable Dotypos link"
                );
              }),
              providerTransition
            )
          )
        );
        yield* runStep(
          step(
            "restores English (US) before completing the deletion",
            Effect.gen(function* () {
              yield* setAccountLocalePreference(
                reauthentication.userId,
                "en-US"
              );
              yield* openPage(localized(accountSuffix));
              yield* waitPathname(
                "English pending account after restoring the preference",
                (pathname) => pathname === `/en-US${accountSuffix}`
              );
              yield* waitText(
                "deletion pending state after restoring English",
                deletionPendingTitle
              );
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "completes the deletion on retry behind the destructive confirmation",
            Effect.gen(function* () {
              yield* clickBrowserElement(run, session, deleteTriggerSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitForBrowserCondition(
                run,
                session,
                "deletion confirmation dialog",
                `(() => document.querySelector(${JSON.stringify(deleteConfirmSelector)}) !== null)()`,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(
                run,
                session,
                deleteConfirmCheckboxSelector,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(run, session, deleteConfirmSelector, {
                timeoutMs: browserTimeout,
              });
              yield* waitText("deleted page", deletedTitle, providerTransition);
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "expires the provider profile first and removes every identity row",
            Effect.gen(function* () {
              const customer = yield* readProviderProfile(
                reauthentication.linkedCustomerId
              );
              assert(
                customer.expireDate != null &&
                  new Date(customer.expireDate).getTime() <= Date.now(),
                "the provider profile was not expired by the deletion"
              );
              assert(
                customer.deleted !== true,
                "the provider profile was permanently deleted"
              );
              yield* assertNoAuthRows(reauthentication.userId);
              const link = yield* findLinkedDotyposCustomerId(
                reauthentication.userId
              );
              assert(
                link === undefined,
                "the customer account link survived identity removal"
              );
              lifecycleHandoff.deletedUserId = reauthentication.userId;
              lifecycleHandoff.retainedCustomerId =
                reauthentication.linkedCustomerId;
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "requires anonymous access after the completed deletion",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitUrlContains(
                "anonymous account redirect after deletion",
                signInSuffix
              );
              yield* waitSignInForm();
            })
          )
        );
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "rejects the already-consumed reauthentication link",
              Effect.gen(function* () {
                yield* openPage(reauthentication.link);
                const replayedUserId = yield* findAuthUserIdByEmail(recipient);
                if (replayedUserId) {
                  yield* recordFixtureIds(journalRef, {
                    authUserIds: [replayedUserId],
                  });
                }
                yield* waitText(
                  "replayed reauthentication failure state",
                  callbackFailedTitle
                );
              }),
              providerTransition
            )
          )
        );
      })
    ),
    makeCase("account-deletion-and-reactivation", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        yield* runStep(
          step(
            "requires the completed deletion handoff from the marker case",
            Effect.sync(() => {
              assert(
                lifecycleHandoff.deletedUserId != null &&
                  lifecycleHandoff.retainedCustomerId != null,
                "the account session case did not complete the deletion handoff"
              );
            })
          )
        );
        const startedAt = new Date();
        const observedLogEntryIds = yield* runStep(
          step(
            "records the delivered log baseline",
            observeDeliveredLogEntryIds(recipient, startedAt),
            providerTransition
          )
        );
        yield* rateBudget.run(
          "send",
          runStep(
            step(
              "requests the reactivation sign-in link",
              requestSignInLink(recipient),
              navigationTimeout
            )
          )
        );
        const link = yield* runStep(
          step(
            "retrieves the reactivation link",
            retrieveSignInLink(recipient, observedLogEntryIds, startedAt),
            authDeliveryTimeout
          )
        );
        // With passkeys on, the authenticator is present when the sign-in
        // lands, so the account page offers its post-sign-in prompt the way it
        // does on a passkey-capable browser.
        if (passkeysOffered()) {
          yield* runStep(
            step(
              "adds the virtual passkey authenticator before the reactivation sign-in",
              passkeys.installAuthenticator,
              browserTimeout
            )
          );
        }
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "reactivates the retained profile under a new Better Auth identity",
              Effect.gen(function* () {
                yield* openPage(link);
                yield* waitDefaultReservations(
                  "reactivated linked account reservations"
                );
                const newUserId = yield* requireAuthUserId(recipient);
                assert(
                  newUserId !== lifecycleHandoff.deletedUserId,
                  "the reactivated identity reused the deleted Better Auth id"
                );
                const linked = yield* requireLinkedCustomerId(newUserId);
                assert(
                  linked === lifecycleHandoff.retainedCustomerId,
                  "the reactivated identity claimed a different Dotypos customer"
                );
                const customer = yield* readProviderProfile(linked);
                assert(
                  customer.expireDate == null,
                  "the retained Dotypos profile was not reactivated"
                );
                yield* recordFixtureIds(journalRef, {
                  authUserIds: [newUserId],
                });
              }),
              providerTransition
            )
          )
        );
        if (passkeysOffered()) {
          yield* runStep(
            step(
              "creates a passkey from the post-sign-in prompt",
              Effect.gen(function* () {
                yield* passkeys.createFromPrompt;
                const credentials =
                  yield* passkeys.readAuthenticatorCredentials;
                assert(
                  credentials.length === 1 &&
                    credentials[0]?.isResidentCredential === true &&
                    credentials[0].rpId === previewRpId,
                  "the prompt passkey is not one discoverable credential for the preview host"
                );
                yield* requirePasskeyCount(
                  yield* requireAuthUserId(recipient),
                  1,
                  "the prompt passkey was not saved to the reactivated account"
                );
              }),
              providerTransition
            )
          );
        }
        yield* runStep(
          step(
            "keeps the retained reservation history across reactivation",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitForInteractiveSnapshot({
                description:
                  "retained past reservations group with a cancelled card",
                matches: (snapshot) =>
                  snapshot.includes(pastReservationsTitle) &&
                  snapshot.includes(cancelledStatus),
                run,
                session,
                timeoutMs: datasourceTimeout,
              });
            }),
            accountPageLoadTimeout
          )
        );
      })
    ),
    makeCase("account-passkey-sign-in", ({ runStep }) =>
      Effect.gen(function* () {
        const userId = yield* runStep(
          step(
            "requires the reactivated account's prompt passkey",
            Effect.gen(function* () {
              assert(
                passkeysOffered(),
                "the sign-in form did not offer passkeys"
              );
              const userId = yield* requireAuthUserId(recipient);
              yield* requirePasskeyCount(
                userId,
                1,
                "the reactivated account holds no prompt passkey"
              );
              return userId;
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "signs out before the passkey sign-in",
            signOutAndRequireAnonymous(),
            navigationTimeout
          )
        );
        const sessionBeforeSignIn = yield* runStep(
          step(
            "reads the account's newest session before the passkey sign-in",
            readNewestSessionCreatedAt(userId),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "signs the same account in with the passkey button",
            Effect.gen(function* () {
              yield* passkeys.signIn;
              yield* waitDefaultReservations(
                "linked account reservations after the passkey sign-in"
              );
              const newest = yield* readNewestSessionCreatedAt(userId);
              assert(
                newest !== undefined &&
                  (sessionBeforeSignIn === undefined ||
                    newest.getTime() > sessionBeforeSignIn.getTime()),
                "the passkey sign-in opened no new session for the account"
              );
            }),
            providerTransition
          )
        );
      })
    ),
    makeCase("account-passkey-management", ({ runStep }) =>
      Effect.gen(function* () {
        const userId = yield* runStep(
          step(
            "reads the passkey account identity",
            requireAuthUserId(recipient),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "renames the passkey in Sign-in & security",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* passkeys.renameOnly(passkeyNameFixture);
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "deletes the last passkey behind its email sign-in note",
            Effect.gen(function* () {
              yield* passkeys.deleteOnly(passkeyNameFixture);
              yield* requirePasskeyCount(
                userId,
                0,
                "the deleted passkey is still saved"
              );
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "creates a passkey from Sign-in & security on the fresh session",
            Effect.gen(function* () {
              yield* passkeys.createFromSettings;
              yield* requirePasskeyCount(
                userId,
                1,
                "the settings passkey was not saved to the account"
              );
            }),
            providerTransition
          )
        );
        const staleSessionCreatedAt = new Date(Date.now() - staleSessionAgeMs);
        yield* runStep(
          step(
            "confirms the account deletion with the passkey behind the stale-session gate",
            Effect.gen(function* () {
              yield* setSessionCreatedAt(userId, staleSessionCreatedAt);
              yield* openPage(localized(accountSuffix));
              yield* passkeys.confirmDeletionWithPasskey;
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "keeps the same active account on a fresh passkey session",
            Effect.gen(function* () {
              const newest = yield* readNewestSessionCreatedAt(userId);
              assert(
                newest !== undefined &&
                  newest.getTime() > staleSessionCreatedAt.getTime(),
                "the passkey confirmation opened no fresh session for the account"
              );
              yield* openPage(localized(accountSuffix));
              yield* waitDefaultReservations(
                "active linked account after the passkey confirmation"
              );
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "removes the virtual passkey authenticator",
            passkeys.removeAuthenticator,
            browserTimeout
          )
        );
      })
    ),
    makeCase("account-locale-preference", ({ runStep }) =>
      Effect.gen(function* () {
        const languageTriggerSelector = '[data-slot="select-trigger"]';
        const languageOptionCsSelector = '[role="option"]:has-text("Čeština")';
        const czechProfileUrl = new URL(
          getAccountSectionPath("cs-CZ", "profile"),
          config.baseUrl
        ).toString();
        const czechLanguageLabel = m.accountProfileScreenLanguageLabel(
          {},
          { locale: "cs-CZ" }
        );
        const czechFaqTitle = m.faqPageTitle({}, { locale: "cs-CZ" });

        /**
         * Waits until the profile's language control is labelled with the
         * given text. It reads the label through the control's `labels`
         * and compares `textContent`, so CSS text-transform on the label
         * (it renders uppercase) cannot hide the match the way rendered
         * page text would.
         */
        const waitLanguageControlLabel = (description: string, label: string) =>
          waitForBrowserCondition(
            run,
            session,
            `${description} language control label`,
            `(() => {
                const expected = ${JSON.stringify(label)};
                return Array.from(
                  document.querySelectorAll(${JSON.stringify(`${accountSectionLandmarks.profile} ${languageTriggerSelector}`)})
                ).some((control) =>
                  Array.from(control.labels ?? []).some(
                    (labelElement) => labelElement.textContent?.trim() === expected
                  )
                );
              })()`,
            { timeoutMs: uiTransition }
          );

        /** Waits for the page's main heading by its text content. */
        const waitPageHeading = (description: string, heading: string) =>
          waitForBrowserCondition(
            run,
            session,
            `${description} heading`,
            `Array.from(document.querySelectorAll("h1")).some(
              (element) => element.textContent?.trim() === ${JSON.stringify(heading)}
            )`,
            { timeoutMs: uiTransition }
          );

        /**
         * Waits until the selected option, read from the open listbox, is
         * the given language. The option labels name each language in its
         * own language, so the check reads the same on every site locale.
         */
        const requireSelectedLanguage = (
          optionLabel: string,
          description: string
        ) =>
          Effect.gen(function* () {
            yield* clickBrowserElement(run, session, languageTriggerSelector, {
              timeoutMs: browserTimeout,
            });
            yield* waitForBrowserCondition(
              run,
              session,
              description,
              `(() => {
                  const selected = document.querySelector('[role="option"][aria-selected="true"]');
                  return selected !== null &&
                    selected.textContent?.includes(${JSON.stringify(optionLabel)}) === true;
                })()`,
              { timeoutMs: uiTransition }
            );
            yield* pressBrowserKey(run, session, "Escape", {
              timeoutMs: browserTimeout,
            });
          });

        /**
         * Opens the Czech profile by its section path. The account
         * navigation labels are English-only fixtures, so the profile is
         * ready once its hydrated panel is visible and renders the Czech
         * language label.
         */
        const openCzechProfile = (description: string) =>
          Effect.gen(function* () {
            yield* openPage(czechProfileUrl);
            yield* waitForBrowserCondition(
              run,
              session,
              `${description} panel`,
              `(() => {
                  const panel = document.querySelector(${JSON.stringify(accountSectionLandmarks.profile)});
                  return panel !== null &&
                    panel.closest("[hidden]") === null &&
                    Object.keys(panel).some((key) => key.startsWith("__reactProps$"));
                })()`,
              { timeoutMs: uiTransition }
            );
            yield* waitLanguageControlLabel(description, czechLanguageLabel);
          });

        // The case reuses the session the reactivation sign-in opened: the
        // lane's magic-link ledger has no room for another sign-in, and a
        // new link here would wait out the full rate-limit quiet window.
        // The session-lifecycle reauthentication proves that a sign-in from
        // an English callback lands on the saved Czech site.
        yield* runStep(
          step(
            "opens the English profile of the reactivated account",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              // The reactivated account was created under en-US, so its
              // saved preference keeps the English account page.
              yield* waitPathname(
                "English account of the reactivated account",
                (pathname) => pathname === `/en-US${accountSuffix}`
              );
              yield* waitDefaultReservations("reactivated signed-in account");
              yield* selectAccountSectionInRunner(run, session, "profile");
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "chooses Čeština, which saves it and moves the site to Czech",
            Effect.gen(function* () {
              // The English account shows English (US), the page locale.
              // Choosing Čeština saves the preference through the shared
              // locale switch, which then moves the document to Czech.
              yield* waitForBrowserReactHandler(
                run,
                session,
                `${accountSectionLandmarks.profile} ${languageTriggerSelector}`,
                "onPointerDown",
                { timeoutMs: uiTransition }
              );
              yield* clickBrowserElement(
                run,
                session,
                languageTriggerSelector,
                { timeoutMs: browserTimeout }
              );
              yield* clickBrowserElement(
                run,
                session,
                languageOptionCsSelector,
                { timeoutMs: browserTimeout }
              );
              yield* waitPathname(
                "Czech account after choosing Čeština",
                (pathname) => pathname.startsWith(`/cs-CZ${accountSuffix}`)
              );
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "shows Čeština selected on the Czech profile",
            Effect.gen(function* () {
              yield* openCzechProfile("Czech profile after the save");
              yield* requireSelectedLanguage(
                "Čeština",
                "saved Čeština option selected"
              );
              yield* captureLanguageReview("czech-profile");
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "redirects a conflicting en-US URL and cookie to the saved Czech locale",
            Effect.gen(function* () {
              yield* evalBrowserScript(
                "overwrite the locale cookie with en-US",
                run,
                session,
                `document.cookie = ${JSON.stringify(`${localeCookieName}=en-US; path=/`)}`,
                { logOutput: false, timeoutMs: browserTimeout }
              );
              yield* openPage(localized(publicPreferenceProbeSuffix));
              yield* waitPathname(
                "saved-preference redirect to the Czech page",
                (pathname) =>
                  pathname === `/cs-CZ${publicPreferenceProbeSuffix}`
              );
              yield* waitPageHeading(
                "Czech page after the redirect",
                czechFaqTitle
              );
              const cookie = yield* evalBrowserScript(
                "read the locale cookie after the redirect",
                run,
                session,
                `JSON.stringify({
                  czech: document.cookie.split("; ").includes(${JSON.stringify(`${localeCookieName}=cs-CZ`)}),
                })`,
                { logOutput: false, timeoutMs: browserTimeout }
              ).pipe(Effect.map((command) => command.stdout));
              const parsed = JSON.parse(cookie) as { czech: boolean };
              assert(
                parsed.czech,
                "the preference redirect did not move the locale cookie to cs-CZ"
              );
              yield* captureLanguageReview("preference-redirect");
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "keeps Čeština selected on the Czech profile after the redirect",
            Effect.gen(function* () {
              yield* openCzechProfile("Czech profile after the redirect");
              yield* requireSelectedLanguage(
                "Čeština",
                "kept Čeština option selected"
              );
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "switches to English through the header language switcher",
            switchLocale(run, session, "en-US", config.timeouts),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "redirects a Czech account URL to the switched English preference",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix, "cs-CZ"));
              yield* waitPathname(
                "switched-preference redirect to the English account",
                (pathname) => pathname === `/en-US${accountSuffix}`
              );
              yield* waitDefaultReservations(
                "English account after the switch"
              );
              yield* captureLanguageReview("switcher-saved");
            }),
            providerTransition
          )
        );
        // Later serial cases expect the English site, so the case ends on
        // the English profile with English (US) saved.
        yield* runStep(
          step(
            "shows English (US) as the saved language after the switch",
            Effect.gen(function* () {
              yield* selectAccountSectionInRunner(run, session, "profile");
              yield* requireSelectedLanguage(
                "English (US)",
                "switched English (US) option selected"
              );
            }),
            providerTransition
          )
        );
      })
    ),
    makeCase("account-linking-variants", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        const mainIdentity = yield* runStep(
          step(
            "reads the reactivated main identity",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              const customerId = yield* requireLinkedCustomerId(userId);
              assert(
                userId !== lifecycleHandoff.deletedUserId,
                "the linking variants reused the deleted Better Auth id"
              );
              assert(
                customerId === lifecycleHandoff.retainedCustomerId,
                "the linking variants lost the retained Dotypos customer"
              );
              assert(
                journalRef.journal.authUserIds.includes(userId),
                "the reactivated main Better Auth user was not journaled"
              );
              assert(
                journalRef.journal.dotyposCustomerIds.includes(customerId),
                "the retained Dotypos customer was not journaled"
              );
              const customer = yield* readProviderProfile(customerId);
              assert(
                customer.expireDate == null && customer.deleted !== true,
                "the retained Dotypos profile is not active"
              );
              return { customerId, userId };
            }),
            datasourceTimeout
          )
        );

        yield* runStep(
          step(
            "navigates to public contact before the active unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "removes the active main account link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "links the active provider profile without completion",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitDefaultReservations(
                "directly linked account reservations"
              );
              const userId = yield* requireAuthUserId(recipient);
              assert(
                userId === mainIdentity.userId,
                "the active resolver changed the Better Auth id"
              );
              const linked = yield* requireLinkedCustomerId(userId);
              assert(
                linked === mainIdentity.customerId,
                "the active provider profile did not link to the main account"
              );
            }),
            providerTransition
          )
        );

        yield* runStep(
          step(
            "navigates to public contact before the expired unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "removes the expired main account link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "expires the retained provider profile after unlinking",
            expireSyntheticCustomerProfile(
              datasourceConfig,
              mainIdentity.customerId
            ).pipe(
              Effect.timeoutOrElse({
                duration: `${datasourceTimeout} millis`,
                orElse: () =>
                  workspaceE2ETimeoutError(
                    "provider profile expiration timed out",
                    { operation: "expire provider profile" }
                  ),
              })
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "reactivates the expired provider profile on linking",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitDefaultReservations(
                "linked expired account reservations"
              );
              const userId = yield* requireAuthUserId(recipient);
              assert(
                userId === mainIdentity.userId,
                "the expired resolver changed the Better Auth id"
              );
              const linked = yield* requireLinkedCustomerId(userId);
              assert(
                linked === mainIdentity.customerId,
                "the expired provider profile did not link to the main account"
              );
              const customer = yield* readProviderProfile(linked);
              assert(
                customer.expireDate == null,
                "the expired provider profile was not reactivated"
              );
            }),
            providerTransition
          )
        );

        yield* runStep(
          step(
            "navigates to public contact before the ambiguous unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "removes the ambiguous main account link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "creates one additional ambiguous provider profile",
            Effect.gen(function* () {
              const duplicateCustomerId = yield* createSyntheticCustomerProfile(
                datasourceConfig,
                {
                  email: recipient,
                  firstName: "E2E Support Duplicate",
                }
              );
              yield* recordFixtureIds(journalRef, {
                dotyposCustomerIds: [duplicateCustomerId],
              });
            }),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "requires support for an ambiguous provider profile",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitText("support-required state", supportTitle);
              const userId = yield* requireAuthUserId(recipient);
              assert(
                userId === mainIdentity.userId,
                "the ambiguous resolver changed the Better Auth id"
              );
              const claimed = yield* findLinkedDotyposCustomerId(userId);
              assert(
                claimed === undefined,
                "an ambiguous provider match claimed a link"
              );
            }),
            providerTransition
          )
        );
      })
    ),
  ];
};
