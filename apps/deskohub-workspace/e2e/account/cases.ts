import {
  type DotyposCustomerId,
  type DotyposReservationId,
  normalizePhoneNumber,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  getAccountSectionPath,
  getAccountSignInPath,
} from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import { getReservationStartPath } from "@/features/reservation/routes";
import { maskEmailAddress } from "@/shared/utils";
import { normalizeBrowserText } from "../browser";
import type { DatasourceConfig } from "../config";
import {
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import { pollUntil } from "../polling";
import { addRedaction, assert, parseUrl } from "../runtime";
import {
  workspaceE2EPollInitialIntervalMs,
  workspaceE2EPollIntervalMs,
  workspaceE2ETimeouts,
} from "../timeouts";
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
  requireSyntheticCustomerProfile,
} from "./fixtures";
import type {
  WorkspaceE2EAccountBrowser,
  WorkspaceE2EAccountLaneBrowser,
} from "./lane-browser";
import type { WorkspaceE2EAccountPasskeys } from "./passkeys";
import { workspaceE2EAccountProfileFixture } from "./profile-fixture";
import type { MagicLinkRateBudget } from "./rate-budget";
import {
  findWorkspaceE2EReferralReferrer,
  seedWorkspaceE2EReferralOwner,
} from "./referral-fixture";
import type { LanguagePreferenceReviewCapture } from "./review-screenshots";
import type {
  LanguagePreferenceReviewStage,
  SignInHandoffReviewCapture,
  SignInHandoffReviewStage,
} from "./review-targets";
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

const coworkSelectionTier = "open-space";

/** A cowork selection a sign-in returns to, with the locale it is in. */
export type WorkspaceE2ESignInReturn = {
  readonly locale: Locale;
  readonly returnTo: string;
};

/**
 * The selections the lane's sign-ins return to: the lane browser's first
 * link for the main recipient, and the link the assistant's browser requests
 * in Czech for the reactivation.
 */
export type WorkspaceE2ESignInReturns = {
  readonly assistant: WorkspaceE2ESignInReturn;
  readonly sameBrowser: WorkspaceE2ESignInReturn;
};

/**
 * Open space with no coffee on a day 120 days out, like the lane's other
 * reservation dates, outside the checkout date range.
 */
const makeCoworkSelection = (
  locale: Locale,
  now: number
): WorkspaceE2ESignInReturn => ({
  locale,
  returnTo: getReservationStartPath(
    locale,
    "cowork",
    new URLSearchParams({
      entryTier: coworkSelectionTier,
      date: new Date(now + 120 * 24 * 60 * 60_000).toISOString().slice(0, 10),
      coffee: "false",
    })
  ),
});

/**
 * The lane builds the selections once per worker: the sign-in form case
 * requests a link the delivery case consumes, and the callback handoff holds
 * expect the same return targets the cases request.
 */
export const makeWorkspaceE2ESignInReturns = (
  now = Date.now()
): WorkspaceE2ESignInReturns => ({
  assistant: makeCoworkSelection("cs-CZ", now),
  sameBrowser: makeCoworkSelection("en-US", now),
});

export type WorkspaceE2EAccountCaseInputs = {
  /**
   * Review capture for the language case's mid-case moments. The lane
   * supplies the review wrapper's hook; without one nothing is captured.
   */
  readonly captureLanguagePreferenceReview?: LanguagePreferenceReviewCapture;
  /**
   * Review capture for the assistant's browser in the cross-browser sign-in.
   * The lane supplies it; without one nothing is captured.
   */
  readonly captureSignInHandoffReview?: SignInHandoffReviewCapture;
  readonly config: WorkspaceE2EAccountConfig;
  readonly datasourceConfig: DatasourceConfig;
  /**
   * The steps that drive the lane's browser session directly: section
   * selection and the remembered referral code.
   */
  readonly laneBrowser: WorkspaceE2EAccountLaneBrowser;
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
  readonly signInReturns: WorkspaceE2ESignInReturns;
};

/**
 * Builds the serial account lifecycle lane. The cases share one browser
 * session and one synthetic identity chain, ordered so each delivered link,
 * provider fixture, and deletion transition is exercised against the exact
 * protected preview and its matching migrated Neon branch.
 */
export const makeWorkspaceE2EAccountCases = ({
  captureLanguagePreferenceReview,
  captureSignInHandoffReview,
  config,
  datasourceConfig,
  laneBrowser,
  lifecycleHandoff,
  passkeys,
  previewLogs,
  rateBudget,
  signInReturns,
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

  const previewOrigin = new URL(config.baseUrl).origin;
  /** Passkeys bind to the preview's own host as their relying party. */
  const previewRpId = new URL(config.baseUrl).hostname;

  /**
   * The page steps of one browser. The lane drives its own browser through
   * them, and the reactivation case also drives a second, anonymous browser:
   * the one a customer's assistant books in.
   */
  const makeBrowserSteps = (browser: WorkspaceE2EAccountBrowser) => {
    const openPage = (url: string) => browser.open(url);

    const waitText = (
      description: string,
      text: string,
      timeoutMs = uiTransition
    ) =>
      browser.waitForText(
        description,
        (pageText) => pageText.includes(text),
        timeoutMs
      );

    const waitUrlContains = (description: string, expected: string) =>
      pollUntil(
        browser.readUrl.pipe(
          Effect.map((url) => (url?.includes(expected) ? url : undefined))
        ),
        {
          intervalMs: workspaceE2EPollIntervalMs.browser,
          label: description,
          timeoutMs: uiTransition,
        }
      );

    const waitPathname = (
      description: string,
      matches: (pathname: string) => boolean
    ) =>
      browser.waitForUrl(
        description,
        (url) => {
          const parsed = parseUrl(url);
          return parsed?.origin === previewOrigin && matches(parsed.pathname);
        },
        navigationTimeout
      );

    /**
     * Waits until a sign-in leaves the browser on exactly the path and query
     * it returns to, so a selection carried in the query survived the
     * callback.
     */
    const waitReturnLanding = (description: string, returnTo: string) =>
      browser.waitForUrl(
        description,
        (url) => {
          const parsed = parseUrl(url);
          return (
            parsed?.origin === previewOrigin &&
            `${parsed.pathname}${parsed.search}` === returnTo
          );
        },
        navigationTimeout
      );

    /** Waits until a cowork page shows the selection its URL carries. */
    const waitCoworkSelection = (description: string) =>
      browser.waitForCoworkSelection(description, coworkSelectionTier);

    const readNormalizedText = () =>
      browser.readText.pipe(Effect.map(normalizeBrowserText));

    const waitSignInForm = () => browser.waitForSignInForm;

    const fillAndSubmitEmail = (email: string) =>
      browser.submitSignInEmail(email);

    /** Waits until the code input of a sign-in code step takes typed digits. */
    const waitSignInCodeInput = () => browser.waitForSignInCodeInput;

    /**
     * Waits for the card an accepted sign-in email leaves and reports which
     * one it is. With `login_email_code` off it is the inbox notice; with the
     * flag on the same accepted request opens the code step instead.
     */
    const waitSignInAccepted = Effect.fn("waitSignInAccepted")(function* (
      description: string,
      locale: Locale = config.locale
    ) {
      const inboxTitle = m.accountSignInAcceptedTitle({}, { locale });
      const codeTitle = m.accountSignInCodeTitle({}, { locale });
      const pageText = yield* browser.waitForText(
        description,
        (text) => text.includes(inboxTitle) || text.includes(codeTitle),
        uiTransition
      );
      if (!pageText.includes(codeTitle)) {
        return "inbox" as const;
      }
      yield* waitSignInCodeInput();
      return "code" as const;
    });

    return {
      fillAndSubmitEmail,
      openPage,
      readNormalizedText,
      waitCoworkSelection,
      waitPathname,
      waitReturnLanding,
      waitSignInAccepted,
      waitSignInCodeInput,
      waitSignInForm,
      waitText,
      waitUrlContains,
    };
  };

  const {
    fillAndSubmitEmail,
    openPage,
    readNormalizedText,
    waitCoworkSelection,
    waitPathname,
    waitReturnLanding,
    waitSignInAccepted,
    waitSignInCodeInput,
    waitSignInForm,
    waitText,
    waitUrlContains,
  } = makeBrowserSteps(laneBrowser);

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

  const waitDefaultReservations = laneBrowser.waitForReservationsPanel;

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
      yield* laneBrowser.signOut;
      yield* pollUntil(
        laneBrowser.readUrl.pipe(
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
      laneBrowser.readUrl.pipe(
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
    yield* laneBrowser.waitForRememberedReferralCode(referralCode);
    yield* waitSignInForm();
  });

  const waitReferralFieldValue = laneBrowser.waitForReferralFieldValue;

  const requireReferralInvitation = () =>
    Effect.sync(() => {
      const invitation = lifecycleHandoff.referralInvitation;
      assert(
        invitation,
        "the share-link case did not record the referral invitation"
      );
      return invitation;
    });

  /**
   * The accepted card says which browser the sign-in continues in, because a
   * link signs in only the browser that opens it. The inbox notice keeps the
   * selection in this browser and tells an assistant's customer to take over
   * the assistant's browser; the code step offers typing or reading out the
   * code instead of the same-browser line.
   */
  const assertSignInHandoffCopy = (
    text: string,
    confirmation: "code" | "inbox",
    locale: Locale
  ) => {
    const sameBrowser = m.accountSignInAcceptedSameBrowser({}, { locale });
    const codeAssistant = m.accountSignInCodeAssistantHint({}, { locale });
    assert(
      text.includes(m.accountSignInAssistantBrowserHint({}, { locale })),
      "the accepted sign-in card lost its assistant browser hint"
    );
    if (confirmation === "inbox") {
      assert(
        text.includes(sameBrowser) && !text.includes(codeAssistant),
        "the inbox notice does not keep the sign-in in this browser"
      );
    } else {
      assert(
        text.includes(codeAssistant) && !text.includes(sameBrowser),
        "the code step does not offer the code to the booking browser"
      );
    }
  };

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

  const captureHandoffReview = (stage: SignInHandoffReviewStage) =>
    captureSignInHandoffReview === undefined
      ? Effect.void
      : Effect.tryPromise({
          catch: (cause) =>
            workspaceE2EError("capture sign-in handoff review", {
              cause,
              operation: "capture sign-in handoff review",
            }),
          try: () => captureSignInHandoffReview(stage),
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
    requireSyntheticCustomerProfile(
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
            "create-synthetic-referrer",
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
            "remember-anonymous-share-link",
            Effect.gen(function* () {
              yield* laneBrowser.waitForNoRememberedReferralCode;
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
            "require-share-link-sign-in-handoff",
            requireReferralInvitation()
          )
        );
        lifecycleHandoff.passkeySignIn = yield* runStep(
          step(
            "record-passkey-sign-in-offer",
            Effect.gen(function* () {
              yield* waitShareLinkSignIn(invitation.code);
              return yield* passkeys.readSignInOffer;
            })
          )
        );
        yield* runStep(
          step(
            "reject-invalid-email",
            Effect.gen(function* () {
              // Native validation blocks the submit, so the share-link form
              // stays loaded for the first accepted request.
              yield* waitShareLinkSignIn(invitation.code);
              yield* fillAndSubmitEmail("not-an-email");
              assert(
                yield* laneBrowser.readSignInEmailBlocked,
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
        // The main recipient's link returns to a cowork selection, the way
        // a sign-in started from a reservation does; the referral cookie
        // carries the shared code alongside.
        const { returnTo: selection } = signInReturns.sameBrowser;
        yield* runStep(
          step(
            "open-sign-in-from-cowork-selection",
            Effect.gen(function* () {
              yield* openPage(`${config.baseUrl}${selection}`);
              yield* waitCoworkSelection("cowork selection before the sign-in");
              yield* openPage(
                `${config.baseUrl}${getAccountSignInPath(config.locale, selection)}`
              );
              yield* laneBrowser.waitForRememberedReferralCode(invitation.code);
              yield* waitSignInForm();
            }),
            accountPageLoadTimeout
          )
        );
        const firstAccepted = yield* rateBudget.run(
          "send",
          runStep(
            step(
              "accept-first-unknown-email",
              Effect.gen(function* () {
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
              "accept-second-unknown-email",
              Effect.gen(function* () {
                // The code step offers a different email instead of another link.
                const restartLabel =
                  firstAccepted.confirmation === "code"
                    ? useDifferentEmailLabel
                    : sendAnotherLinkLabel;
                yield* laneBrowser.restartSignIn(restartLabel);
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
            "assert-identical-accepted-responses",
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
              assertSignInHandoffCopy(
                firstAccepted.text,
                firstAccepted.confirmation,
                config.locale
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
            "require-second-email-code-step",
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
            "retrieve-sign-in-code",
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
            "reject-wrong-sign-in-code",
            Effect.gen(function* () {
              yield* waitSignInCodeInput();
              yield* laneBrowser.enterSignInCode(
                code === "000000" ? "111111" : "000000"
              );
              yield* waitText("wrong code status", signInCodeInvalid);
              yield* laneBrowser.waitForEmptiedSignInCode;
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "sign-in-with-emailed-code",
            Effect.gen(function* () {
              yield* laneBrowser.enterSignInCode(code);
              // The code signs in from the selection's sign-in, so it returns
              // there; the completion state is on the account page.
              yield* waitReturnLanding(
                "cowork selection after the code sign-in",
                signInReturns.sameBrowser.returnTo
              );
              yield* openPage(localized(accountSuffix));
              yield* waitPathname(
                "account after the code sign-in",
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
            "sign-out-code-account",
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
            "require-first-accepted-request-handoff",
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
            "assert-dotypos-untouched-before-verification",
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
            "retrieve-magic-link",
            retrieveSignInLink(recipient, [], firstRequest.requestedAt),
            authDeliveryTimeout
          )
        );
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "consume-magic-link-onto-selection",
              Effect.gen(function* () {
                // The lane wraps this case in the callback handoff hold,
                // which proves the signed-in callback's returning copy
                // before the callback leaves for the selection.
                yield* openPage(link);
                yield* waitReturnLanding(
                  "cowork selection after the link",
                  signInReturns.sameBrowser.returnTo
                );
                yield* waitCoworkSelection(
                  "cowork selection kept after the link"
                );
                assert(
                  yield* laneBrowser.readSessionMatches(recipient),
                  "the selection is not signed in as the main recipient"
                );
                // The completion state and every later case continue on the
                // account page.
                yield* openPage(localized(accountSuffix));
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
            "require-share-link-referral-handoff",
            requireReferralInvitation()
          )
        );
        yield* runStep(
          step(
            "assert-completion-login-email-read-only",
            Effect.gen(function* () {
              yield* waitText("completion page", completionTitle);
              const parsed =
                yield* laneBrowser.readCompletionLoginEmail(recipient);
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
            "complete-profile-with-share-code",
            Effect.gen(function* () {
              yield* waitText("completion page", completionTitle);
              yield* waitReferralFieldValue(
                "completion referral field still holding the share code",
                invitation.code
              );
              yield* laneBrowser.fillProfileField(
                "firstName",
                workspaceE2EAccountProfileFixture.firstName
              );
              yield* laneBrowser.saveProfile;
              // The completion feedback is transient: the successful action
              // intentionally refreshes into the linked edit view, replacing
              // it. The durable contract is the edit form's submit control,
              // whose accessible name only the linked edit view renders.
              yield* laneBrowser.waitForLinkedProfileForm(
                linkedEditSubmitLabel
              );
              // The outcome shows on the linked account until dismissed, and
              // the recorded referral uses up the remembered code.
              yield* waitText(
                "applied share-link referral notice on the linked account",
                completionReferralApplied
              );
              yield* laneBrowser.waitForNoRememberedReferralCode;
            })
          )
        );
        const customerId = yield* runStep(
          step(
            "assert-profile-linked-to-synthetic-customer",
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
            "assert-share-link-referral-recorded",
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
            "assert-linked-login-email-read-only",
            Effect.gen(function* () {
              yield* laneBrowser.selectSection("profile");
              const parsed = yield* laneBrowser.readLinkedLoginEmail(recipient);
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
            "persist-optional-profile-and-billing-fields",
            Effect.gen(function* () {
              yield* laneBrowser.selectSection("profile");
              yield* laneBrowser.fillProfileField(
                "lastName",
                workspaceE2EAccountProfileFixture.lastName
              );
              yield* laneBrowser.fillProfileField(
                "phone",
                workspaceE2EAccountProfileFixture.phone
              );
              yield* laneBrowser.selectSection("billing");
              yield* laneBrowser.chooseBusinessBilling;
              yield* laneBrowser.fillProfileField(
                "billingCompanyName",
                billingCompanyFixture
              );
              yield* laneBrowser.selectSection("profile");
              const parsedDrafts = yield* laneBrowser.readProfileDrafts({
                billingCompanyName: billingCompanyFixture,
                firstName: workspaceE2EAccountProfileFixture.firstName,
                lastName: workspaceE2EAccountProfileFixture.lastName,
                phone: workspaceE2EAccountProfileFixture.phone,
              });
              assert(
                parsedDrafts.profilePreserved,
                "profile drafts changed across section navigation"
              );
              assert(
                parsedDrafts.billingPreserved,
                "billing drafts changed across section navigation"
              );
              yield* laneBrowser.saveProfile;
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
            "read-linked-synthetic-customer",
            Effect.gen(function* () {
              const userId = yield* requireAuthUserId(recipient);
              return yield* requireLinkedCustomerId(userId);
            }),
            datasourceTimeout
          )
        );
        const reservations = yield* runStep(
          step(
            "create-far-future-reservations",
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
            "assert-current-reservations",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              // One aria-snapshot poll samples the interactive tree for both
              // assertions; body innerText missed content the sanitized
              // snapshot already showed in the hosted context.
              yield* laneBrowser.waitForSnapshot(
                "current reservations group with a confirmed card",
                (snapshot) =>
                  snapshot.includes(currentReservationsTitle) &&
                  snapshot.includes(confirmedStatus),
                datasourceTimeout
              );
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "cancel-second-reservation",
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
            "assert-cancelled-reservation-in-past-group",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* laneBrowser.waitForSnapshot(
                "past reservations group with a cancelled card",
                (snapshot) =>
                  snapshot.includes(pastReservationsTitle) &&
                  snapshot.includes(cancelledStatus),
                datasourceTimeout
              );
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
            "read-account-identity",
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
            "assert-deletion-marker-state",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* laneBrowser.selectSection("danger");
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
            "request-reauthentication-at-stale-session-gate",
            Effect.gen(function* () {
              yield* laneBrowser.confirmAccountDeletion;
              yield* laneBrowser.waitForReauthenticationDialog;
            })
          )
        );
        const observedLogEntryIds = yield* runStep(
          step(
            "record-delivered-log-baseline",
            observeDeliveredLogEntryIds(recipient, startedAt),
            providerTransition
          )
        );
        yield* rateBudget.run(
          "send",
          runStep(
            step(
              "send-reauthentication-link",
              Effect.gen(function* () {
                yield* laneBrowser.sendReauthenticationLink;
                // With sign-in codes on, the dialog opens its code step
                // instead. The emailed link still signs in, and the session
                // lifecycle case consumes it.
                const pageText = yield* laneBrowser.waitForText(
                  "reauthentication email accepted",
                  (text) =>
                    text.includes(deletionReauthLinkSent) ||
                    text.includes(deletionReauthCodeTitle),
                  uiTransition
                );
                if (pageText.includes(deletionReauthCodeTitle)) {
                  yield* waitSignInCodeInput();
                }
              })
            )
          )
        );
        const reauthenticationLink = yield* runStep(
          step(
            "retrieve-reauthentication-link",
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
    makeCase("account-session-lifecycle", ({ runStep }) =>
      Effect.gen(function* () {
        const reauthentication = yield* runStep(
          step(
            "require-reauthentication-handoff",
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
            "open-pending-account",
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
            "sign-out-before-reauthentication",
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
            "save-czech-preference",
            setAccountLocalePreference(reauthentication.userId, "cs-CZ"),
            datasourceTimeout
          )
        );
        yield* rateBudget.run(
          "verify",
          runStep(
            step(
              "sign-in-onto-saved-czech-site",
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
            "restore-english-before-deletion",
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
            "complete-deletion-on-retry",
            Effect.gen(function* () {
              yield* laneBrowser.confirmAccountDeletion;
              yield* waitText("deleted page", deletedTitle, providerTransition);
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "assert-deletion-removed-profile-and-identity-rows",
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
            "assert-anonymous-after-deletion",
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
      })
    ),
    makeCase("account-deletion-and-reactivation", ({ journalRef, runStep }) =>
      Effect.gen(function* () {
        yield* runStep(
          step(
            "require-completed-deletion-handoff",
            Effect.sync(() => {
              assert(
                lifecycleHandoff.deletedUserId != null &&
                  lifecycleHandoff.retainedCustomerId != null,
                "the account session case did not complete the deletion handoff"
              );
            })
          )
        );
        // With passkeys on, the authenticator is present when the sign-in
        // lands, so the account page offers its post-sign-in prompt the way it
        // does on a passkey-capable browser. It joins the lane page before
        // the requesting browser opens a second one.
        if (passkeysOffered()) {
          yield* runStep(
            step(
              "add-virtual-passkey-authenticator",
              passkeys.installAuthenticator,
              browserTimeout
            )
          );
        }
        // The customer's assistant books in its own browser and requests the
        // link there, in Czech, from a cowork selection; the customer opens
        // the link in the lane browser. The link signs in only the browser
        // that opens it, which must finish on the same selection.
        const assistant = makeBrowserSteps(laneBrowser.assistant);
        const { locale: handoffLocale, returnTo } = signInReturns.assistant;
        const reactivatedUserId = yield* Effect.gen(function* () {
          yield* runStep(
            step(
              "open-czech-selection-in-assistant-browser",
              Effect.gen(function* () {
                yield* assistant.openPage(`${config.baseUrl}${returnTo}`);
                yield* assistant.waitCoworkSelection(
                  "cowork selection before the sign-in"
                );
              }),
              accountPageLoadTimeout
            )
          );
          const startedAt = new Date();
          const observedLogEntryIds = yield* runStep(
            step(
              "record-delivered-log-baseline",
              observeDeliveredLogEntryIds(recipient, startedAt),
              providerTransition
            )
          );
          yield* rateBudget.run(
            "send",
            runStep(
              step(
                "request-reactivation-link",
                Effect.gen(function* () {
                  yield* assistant.openPage(
                    `${config.baseUrl}${getAccountSignInPath(handoffLocale, returnTo)}`
                  );
                  yield* assistant.waitSignInForm();
                  yield* assistant.fillAndSubmitEmail(recipient);
                  const confirmation = yield* assistant.waitSignInAccepted(
                    "Czech accepted sign-in response",
                    handoffLocale
                  );
                  assertSignInHandoffCopy(
                    yield* assistant.readNormalizedText(),
                    confirmation,
                    handoffLocale
                  );
                  yield* captureHandoffReview("sign-in-accepted");
                }),
                navigationTimeout
              )
            )
          );
          const link = yield* runStep(
            step(
              "retrieve-reactivation-link",
              previewLogs.retrieveMagicLink({
                callbackPath: `/${handoffLocale}${callbackSuffix}`,
                excludeLogEntryIds: observedLogEntryIds,
                recipient,
                startedAt,
              }),
              authDeliveryTimeout
            )
          );
          const userId = yield* rateBudget.run(
            "verify",
            runStep(
              step(
                "reactivate-retained-profile",
                Effect.gen(function* () {
                  // The lane wraps this case in the callback handoff hold,
                  // which proves the signed-in callback copy before the
                  // callback leaves for the selection.
                  yield* openPage(link);
                  yield* waitReturnLanding(
                    "cowork selection after the sign-in",
                    returnTo
                  );
                  yield* waitCoworkSelection(
                    "cowork selection kept after the sign-in"
                  );
                  assert(
                    yield* laneBrowser.readSessionMatches(recipient),
                    "the selection is not signed in as the reactivated recipient"
                  );
                  const newUserId = yield* requireAuthUserId(recipient);
                  assert(
                    newUserId !== lifecycleHandoff.deletedUserId,
                    "the reactivated identity reused the deleted Better Auth id"
                  );
                  yield* recordFixtureIds(journalRef, {
                    authUserIds: [newUserId],
                  });
                  return newUserId;
                }),
                providerTransition
              )
            )
          );
          // The assistant's tab still holds its pending request, so the
          // sign-in page the anonymous account redirect lands on shows it
          // again instead of the email form.
          yield* runStep(
            step(
              "assert-assistant-browser-signed-out",
              Effect.gen(function* () {
                yield* assistant.openPage(
                  localized(accountSuffix, handoffLocale)
                );
                yield* assistant.waitUrlContains(
                  "anonymous account redirect in the assistant's browser",
                  signInSuffix
                );
                yield* assistant.waitSignInAccepted(
                  "pending request after the anonymous account redirect",
                  handoffLocale
                );
              })
            )
          );
          yield* rateBudget.run(
            "verify",
            runStep(
              step(
                "reject-consumed-reactivation-link",
                Effect.gen(function* () {
                  yield* assistant.openPage(link);
                  yield* assistant.waitText(
                    "replayed link failure state",
                    m.accountCallbackFailedTitle({}, { locale: handoffLocale })
                  );
                  yield* assistant.waitText(
                    "replayed link failure body",
                    m.accountCallbackFailedBody({}, { locale: handoffLocale })
                  );
                  const replayedUserId =
                    yield* findAuthUserIdByEmail(recipient);
                  assert(
                    replayedUserId === userId,
                    "the replayed link changed the reactivated identity"
                  );
                  yield* captureHandoffReview("callback-failed");
                }),
                providerTransition
              )
            )
          );
          yield* runStep(
            step(
              "request-new-link-with-selection-return",
              Effect.gen(function* () {
                yield* laneBrowser.assistant.requestNewLinkAfterFailedCallback(
                  handoffLocale
                );
                yield* assistant.waitPathname(
                  "sign-in after the failed link",
                  (pathname) => pathname === `/${handoffLocale}${signInSuffix}`
                );
                yield* pollUntil(
                  laneBrowser.assistant.readUrl.pipe(
                    Effect.map((url) =>
                      url !== undefined &&
                      new URL(url).searchParams.get("returnTo") === returnTo
                        ? url
                        : undefined
                    )
                  ),
                  {
                    intervalMs: workspaceE2EPollIntervalMs.browser,
                    label: "sign-in return target after the failed link",
                    timeoutMs: uiTransition,
                  }
                );
                // The same return target restores the pending request.
                yield* assistant.waitSignInAccepted(
                  "pending request on the sign-in for the selection",
                  handoffLocale
                );
              })
            )
          );
          return userId;
        }).pipe(Effect.ensuring(laneBrowser.assistant.close));
        // The Czech callback saved Czech as the new account's preference;
        // the later cases read the account in English, as an English
        // reactivation would have saved it.
        yield* runStep(
          step(
            "restore-english-preference",
            setAccountLocalePreference(reactivatedUserId, "en-US"),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "open-reactivated-account-in-english",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* waitPathname(
                "English account after the reactivation",
                (pathname) => pathname === `/${config.locale}${accountSuffix}`
              );
              yield* waitDefaultReservations(
                "reactivated linked account reservations"
              );
              // Reservation pages only read an existing link, so this first
              // account page claims the retained profile. It also takes the
              // one post-sign-in passkey offer the next step accepts.
              const linked = yield* requireLinkedCustomerId(reactivatedUserId);
              assert(
                linked === lifecycleHandoff.retainedCustomerId,
                "the reactivated identity claimed a different Dotypos customer"
              );
              const customer = yield* readProviderProfile(linked);
              assert(
                customer.expireDate == null,
                "the retained Dotypos profile was not reactivated"
              );
            }),
            accountPageLoadTimeout
          )
        );
        if (passkeysOffered()) {
          yield* runStep(
            step(
              "create-passkey-from-prompt",
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
            "assert-retained-reservation-history",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* laneBrowser.waitForSnapshot(
                "retained past reservations group with a cancelled card",
                (snapshot) =>
                  snapshot.includes(pastReservationsTitle) &&
                  snapshot.includes(cancelledStatus),
                datasourceTimeout
              );
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
            "require-prompt-passkey",
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
            "sign-out-before-passkey-sign-in",
            signOutAndRequireAnonymous(),
            navigationTimeout
          )
        );
        const sessionBeforeSignIn = yield* runStep(
          step(
            "read-newest-session",
            readNewestSessionCreatedAt(userId),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "sign-in-with-passkey",
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
            "read-passkey-account-identity",
            requireAuthUserId(recipient),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "rename-passkey",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              yield* passkeys.renameOnly(passkeyNameFixture);
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "delete-last-passkey",
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
            "create-passkey-from-security-section",
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
            "confirm-deletion-with-passkey",
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
            "assert-active-account-on-fresh-passkey-session",
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
            "remove-virtual-passkey-authenticator",
            passkeys.removeAuthenticator,
            browserTimeout
          )
        );
      })
    ),
    makeCase("account-locale-preference", ({ runStep }) =>
      Effect.gen(function* () {
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
         * Waits until the selected option, read from the open listbox, is
         * the locale's language. The option labels name each language in
         * its own language, so the check reads the same on every site
         * locale.
         */
        const requireSelectedLanguage = (locale: Locale, description: string) =>
          Effect.gen(function* () {
            yield* laneBrowser.openLanguageList;
            yield* laneBrowser.waitForSelectedLanguage(description, locale);
            // An Escape can land before the listbox listens for it, and an
            // open listbox swallows the next step's header click.
            yield* pollUntil(
              laneBrowser.dismissLanguageList.pipe(
                Effect.map((closed) => (closed ? true : undefined))
              ),
              {
                intervalMs: workspaceE2EPollIntervalMs.browser,
                label: "language list to close",
                timeoutMs: uiTransition,
              }
            );
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
            yield* laneBrowser.waitForProfilePanel(description);
            yield* laneBrowser.waitForLanguageControlLabel(
              description,
              czechLanguageLabel
            );
          });

        // The case reuses the session the reactivation sign-in opened: the
        // lane's magic-link ledger has no room for another sign-in, and a
        // new link here would wait out the full rate-limit quiet window.
        // The session-lifecycle reauthentication proves that a sign-in from
        // an English callback lands on the saved Czech site.
        yield* runStep(
          step(
            "open-english-profile",
            Effect.gen(function* () {
              yield* openPage(localized(accountSuffix));
              // The reactivated account was created under en-US, so its
              // saved preference keeps the English account page.
              yield* waitPathname(
                "English account of the reactivated account",
                (pathname) => pathname === `/en-US${accountSuffix}`
              );
              yield* waitDefaultReservations("reactivated signed-in account");
              yield* laneBrowser.selectSection("profile");
            }),
            accountPageLoadTimeout
          )
        );
        yield* runStep(
          step(
            "choose-czech-language",
            Effect.gen(function* () {
              // The English account shows English (US), the page locale.
              // Choosing Čeština saves the preference through the shared
              // locale switch, which then moves the document to Czech.
              yield* laneBrowser.chooseLanguage("cs-CZ");
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
            "assert-czech-selected",
            Effect.gen(function* () {
              yield* openCzechProfile("Czech profile after the save");
              yield* requireSelectedLanguage(
                "cs-CZ",
                "saved Čeština option selected"
              );
              yield* captureLanguageReview("czech-profile");
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "redirect-conflicting-locale-to-czech",
            Effect.gen(function* () {
              yield* laneBrowser.setLocaleCookie("en-US");
              yield* openPage(localized(publicPreferenceProbeSuffix));
              yield* waitPathname(
                "saved-preference redirect to the Czech page",
                (pathname) =>
                  pathname === `/cs-CZ${publicPreferenceProbeSuffix}`
              );
              yield* laneBrowser.waitForPageHeading(
                "Czech page after the redirect",
                czechFaqTitle
              );
              assert(
                yield* laneBrowser.hasLocaleCookie("cs-CZ"),
                "the preference redirect did not move the locale cookie to cs-CZ"
              );
              yield* captureLanguageReview("preference-redirect");
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "assert-czech-selected-after-redirect",
            Effect.gen(function* () {
              yield* openCzechProfile("Czech profile after the redirect");
              yield* requireSelectedLanguage(
                "cs-CZ",
                "kept Čeština option selected"
              );
            }),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "switch-to-english-in-header",
            laneBrowser.switchLocale("en-US"),
            providerTransition
          )
        );
        yield* runStep(
          step(
            "redirect-czech-url-to-english",
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
            "assert-english-saved-after-switch",
            Effect.gen(function* () {
              yield* laneBrowser.selectSection("profile");
              yield* requireSelectedLanguage(
                "en-US",
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
            "read-reactivated-main-identity",
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
            "open-contact-before-active-unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "remove-active-account-link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "link-active-provider-profile",
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
            "open-contact-before-expired-unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "remove-expired-account-link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "expire-retained-provider-profile",
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
            "reactivate-expired-provider-profile",
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
            "open-contact-before-ambiguous-unlink",
            openPage(localized("/contact")),
            navigationTimeout
          )
        );
        yield* runStep(
          step(
            "remove-ambiguous-account-link",
            removeSyntheticAccountLink(
              mainIdentity.userId,
              mainIdentity.customerId
            ),
            datasourceTimeout
          )
        );
        yield* runStep(
          step(
            "create-ambiguous-provider-profile",
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
            "require-support-for-ambiguous-profile",
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
