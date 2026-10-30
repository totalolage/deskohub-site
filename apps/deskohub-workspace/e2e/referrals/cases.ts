import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { Page } from "@playwright/test";
import { Effect } from "effect";
import { getAccountSectionPath } from "@/features/account/routes";
import { m } from "@/features/i18n";
import { formatReferralInvitationDiscount } from "@/features/referrals/client";
import { formatMoney } from "@/shared/money/money";
import { accountSectionLandmarks } from "../account/account-sections";
import { findLinkedDotyposCustomerId } from "../account/auth-rows";
import {
  findWorkspaceE2EReferralInvitationClaimState,
  findWorkspaceE2EReferralReferrer,
  makeUnusableReferralCode,
  seedWorkspaceE2EReferralInvitee,
  seedWorkspaceE2EReferrerSavings,
} from "../account/referral-fixture";
import {
  verifyReferralScreenIgnoresShareLink,
  waitForReferralStats,
} from "../account/referral-review";
import {
  type AccountReviewTarget,
  captureAccountReview,
} from "../account/review-screenshots";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import { openPage, waitForPageText } from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import { assertDisplayedDiscounts } from "../cases/discounts";
import {
  type DatasourceConfig,
  getConfig,
  getDatasourceConfig,
  type WorkspaceE2EConfig,
} from "../config";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { discountCodeFixtures } from "../integrations/discount-fixtures";
import type { WorkspaceE2EReferralCaseId } from "../playwright-checkout/case-catalog";
import { pollUntil } from "../polling";
import { waitForReactClickHandler } from "../react-handlers";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { assert, browserSessionFor, type Runner } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type { CheckoutFlowState, WorkspaceE2ECase } from "../types";
import {
  completeReferralProfile,
  openReferralAccount,
  waitForLinkedAccount,
  waitForProfileCompletionForm,
} from "./account-page";
import {
  captureReferralCheckoutOnCasePage,
  onReferralCasePage,
} from "./case-page";
import {
  applyCodeAndReadFreshPayUrl,
  assertOrdinaryCodeSlotAvailable,
  assertReferralConfirmationCleared,
  assertReferrerDiscountMatchesRemainingSubtotal,
  assertShareLinkReferralApplied,
  bindCheckoutContact,
  captureReviewStep,
  getReferralDiscountExpectations,
  ordinaryCodeAppliedMessage,
  referralAppliedMessage,
  referralVoucherAdjustment,
  rejectReferralCode,
  startPayPage,
} from "./checkout";
import {
  makeWorkspaceE2EReferralIdentities,
  type WorkspaceE2EReferralAccount,
  type WorkspaceE2EReferralIdentities,
  type WorkspaceE2EReferralLinkedAccount,
} from "./identities";
import {
  waitForNoRememberedReferralCode,
  waitForRememberedReferralCode,
} from "./referral-cookie";

const ordinaryCodeAdjustment = {
  kind: "percentage",
  basisPoints: 1000,
} as const;
/** The referrer's seeded paid booking saved 20 CZK of a 200 CZK subtotal. */
const referrerSavings = { subtotal: 20_000, value: 2_000 } as const;

type ReferralCaseContext = {
  /** The case's browser session, the context `session` names for `run`. */
  readonly browserSession: E2EBrowserSession;
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly identities: WorkspaceE2EReferralIdentities;
  /** The argv runner, for the checkout helpers still on argv commands. */
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly screenshots: boolean;
  readonly session: string;
};

/**
 * Binds one planned referral-lane case to its own seeded synthetic
 * identities. Each case signs its browser session in through a seeded Better
 * Auth session, so no case sends or verifies a magic link.
 */
export const bindWorkspaceE2EReferralCase = ({
  environment,
  runId,
  testCase,
}: {
  readonly environment: WorkspaceE2EEnvironment;
  readonly runId: WorkspaceE2ERunId;
  readonly testCase: WorkspaceE2ECase;
}): WorkspaceE2ECase => {
  const caseId = testCase.id as WorkspaceE2EReferralCaseId;
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const secret = resolveWorkspaceE2ESessionSigningSecret(environment);
  const screenshots = environment.WORKSPACE_E2E_REVIEW_SCREENSHOTS === "true";
  const identities = makeWorkspaceE2EReferralIdentities({
    baseUrl: config.baseUrl,
    caseId,
    datasourceConfig,
    runId,
    secret,
  });
  // Each checkout books for the case's own seeded customer, so its planned
  // state carries that run-scoped contact before the journal records it.
  const customerLabel = referralCheckoutCustomerLabels[caseId];
  const checkoutStates = customerLabel
    ? testCase.checkoutStates.map((state) => ({
        ...state,
        data: bindCheckoutContact(
          state.data,
          identities.describe(customerLabel as never)
        ),
      }))
    : testCase.checkoutStates;
  const execute = referralCaseExecutors[caseId];
  if (!execute) throw new Error(`Unknown referral case ${caseId}`);
  return {
    ...testCase,
    checkoutStates,
    execute: ({ run, runStep, session }) =>
      Effect.gen(function* () {
        // Each case's own context starts without a remembered shared link.
        const browserSession = yield* runStep({
          execute: Effect.tap(browserSessionFor(run, session), (opened) =>
            waitForNoRememberedReferralCode({ config, session: opened })
          ),
          id: "assert-no-remembered-referral-code",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* execute(
          {
            browserSession,
            config,
            datasourceConfig,
            identities,
            run,
            runStep,
            screenshots,
            session,
          },
          checkoutStates
        );
      }),
  };
};

/** What the referral cookie waits read: the case's browser session. */
const referralCookieContext = ({
  browserSession,
  config,
}: ReferralCaseContext) => ({ config, session: browserSession });

const referralCheckoutCustomerLabels: Partial<
  Record<WorkspaceE2EReferralCaseId, string>
> = {
  "referral-checkout-code-entry": "rce-customer",
  "referral-profile-completion-checkout": "rpc-customer",
  "referral-share-link-checkout": "rsl-customer",
};

type ReferralCaseExecutor = (
  context: ReferralCaseContext,
  checkoutStates: readonly CheckoutFlowState[]
) => Effect.Effect<
  void,
  WorkspaceE2EError,
  import("../integrations/database.service").E2EDatabase
>;

const pageStep = (
  context: ReferralCaseContext,
  id: string,
  timeoutMs: number,
  operation: (page: Page) => Promise<void>
) =>
  context.runStep({
    execute: onReferralCasePage(context.browserSession, id, operation),
    id,
    timeoutMs,
  });

const requireLinkedCustomer = (
  context: ReferralCaseContext,
  account: WorkspaceE2EReferralAccount
) =>
  pollUntil(
    findLinkedDotyposCustomerId(account.accountId).pipe(
      Effect.map((customerId) => customerId as DotyposCustomerId | undefined)
    ),
    {
      initialIntervalMs: workspaceE2EPollIntervalMs.browser,
      intervalMs: workspaceE2EPollIntervalMs.datasource,
      label: "synthetic account customer link",
      timeoutMs: context.config.timeouts.datasource,
    }
  ).pipe(
    Effect.tap((customerId) => context.identities.journalCustomer(customerId))
  );

const waitForReferrer = (
  context: ReferralCaseContext,
  invited: DotyposCustomerId,
  referrer: DotyposCustomerId
) =>
  pollUntil(
    findWorkspaceE2EReferralReferrer(invited).pipe(
      Effect.map((recorded) => (recorded === referrer ? recorded : undefined))
    ),
    {
      initialIntervalMs: workspaceE2EPollIntervalMs.browser,
      intervalMs: workspaceE2EPollIntervalMs.datasource,
      label: "recorded referral attribution",
      timeoutMs: context.config.timeouts.datasource,
    }
  );

const assertReferrer = (
  invited: DotyposCustomerId,
  expected: DotyposCustomerId | undefined,
  message: string
) =>
  findWorkspaceE2EReferralReferrer(invited).pipe(
    Effect.flatMap((recorded) =>
      recorded === expected
        ? Effect.void
        : workspaceE2EError(message, {
            diagnosticCode: "postgres_account_fixture_assertion_failed",
            operation: "assert referral attribution",
          })
    )
  );

/**
 * Checkout carries a referral in the signed pay state and records it only
 * when the order is paid, so an unpaid pay page leaves no attribution and no
 * invitation claim behind.
 */
const assertNothingRecordedBeforePayment = (invited: DotyposCustomerId) =>
  Effect.gen(function* () {
    yield* assertReferrer(
      invited,
      undefined,
      "checkout recorded a referral before payment"
    );
    const claim = yield* findWorkspaceE2EReferralInvitationClaimState(invited);
    if (claim !== undefined) {
      return yield* workspaceE2EError(
        "checkout reserved an invitation claim before payment",
        {
          diagnosticCode: "postgres_account_fixture_assertion_failed",
          operation: "assert referral claim before payment",
        }
      );
    }
  });

const checkoutCapture = (context: ReferralCaseContext) =>
  captureReferralCheckoutOnCasePage(context.browserSession, {
    baseUrl: context.config.baseUrl,
    screenshots: context.screenshots,
  });

const requireSingleState = (
  checkoutStates: readonly CheckoutFlowState[],
  account: WorkspaceE2EReferralLinkedAccount
) => {
  const [state] = checkoutStates;
  if (
    !state ||
    checkoutStates.length !== 1 ||
    state.data.email !== account.email
  ) {
    throw new Error("planned referral checkout is not bound to its customer");
  }
  return state;
};

const expectDiscounts = (
  context: ReferralCaseContext,
  id: string,
  discounts: Parameters<typeof assertDisplayedDiscounts>[0]["discounts"]
) =>
  context.runStep({
    execute: assertDisplayedDiscounts({
      config: context.config,
      discounts,
      session: context.browserSession,
    }),
    id,
    timeoutMs: context.config.timeouts.uiTransition,
  });

const invitationDiscounts = getReferralDiscountExpectations();

const appliedNotice = m.accountProfileReferralApplied(
  { discount: formatReferralInvitationDiscount("en-US") },
  { locale: "en-US" }
);

const referrerScreen: ReferralCaseExecutor = (context) =>
  Effect.gen(function* () {
    const { config, identities, runStep } = context;
    const referrer = yield* runStep({
      execute: Effect.gen(function* () {
        const referrer = yield* identities.seedReferrer("rrs-referrer");
        yield* identities.signIn(referrer, context);
        return referrer;
      }),
      id: "seed-and-sign-in-referrer-without-invitees",
      timeoutMs: config.timeouts.datasource,
    });

    yield* runStep({
      // The runner's first open primes the preview's protection bypass for
      // the later Playwright-native navigations.
      execute: openPage(
        context.browserSession,
        config,
        `${config.baseUrl}${getAccountSectionPath("cs-CZ", "referrals")}`,
        { timeoutMs: config.timeouts.browserNavigation }
      ),
      id: "open-czech-referrals-screen",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* pageStep(
      context,
      "assert-zero-invite-referrals-screen",
      config.timeouts.browserAction * 2,
      async (page) => {
        await waitForReferralStats({
          count: 0,
          locale: "cs-CZ",
          savings: "empty",
          total: 0,
          page,
        });
        await captureReviews(context, page, [
          "linked-referrals-cs-desktop",
          "linked-referrals-cs-mobile",
        ]);
      }
    );

    const otherReferrer = yield* runStep({
      execute: Effect.gen(function* () {
        const invitees = [];
        for (const label of ["rrs-invitee-a", "rrs-invitee-b"] as const) {
          const customerId = yield* identities.createCustomer(label);
          const visit = yield* identities.createPastVisit(customerId);
          invitees.push({ customerId, visit });
        }
        const pending = yield* identities.createCustomer("rrs-invitee-c");
        for (const { customerId, visit } of invitees) {
          yield* seedWorkspaceE2EReferralInvitee({
            invitedDotyposCustomerId: customerId,
            paidVisit: {
              dotyposReservationId: visit.reservationId,
              endedAt: visit.endedAt,
            },
            referrerDotyposCustomerId: referrer.customerId,
            referrerPromotionCodeId: referrer.promotionCodeId,
          });
        }
        yield* seedWorkspaceE2EReferralInvitee({
          invitedDotyposCustomerId: pending,
          referrerDotyposCustomerId: referrer.customerId,
          referrerPromotionCodeId: referrer.promotionCodeId,
        });
        const ownVisit = yield* identities.createPastVisit(referrer.customerId);
        yield* seedWorkspaceE2EReferrerSavings({
          dotyposReservationId: ownVisit.reservationId,
          paidAt: ownVisit.endedAt,
          referrerDotyposCustomerId: referrer.customerId,
          saved: referrerSavings,
        });
        return yield* identities.seedReferrer("rrs-other-referrer");
      }),
      id: "seed-invitees-and-savings",
      timeoutMs: config.timeouts.datasource * 3,
    });

    yield* pageStep(
      context,
      "assert-referral-overview",
      config.timeouts.browserNavigation + config.timeouts.browserAction * 2,
      async (page) => {
        await page.goto(
          new URL(getAccountSectionPath("en-US", "referrals"), config.baseUrl)
            .href,
          { timeout: config.timeouts.browserNavigation }
        );
        // Two invitees compound to 9.75%, which the screen rounds up to 10%.
        await waitForReferralStats({
          count: 2,
          locale: "en-US",
          savings: "saved",
          total: 3,
          page,
        });
        const screen = page.locator(accountSectionLandmarks.referrals);
        const saved = m.accountReferralsSaved(
          {
            amount: formatMoney(
              { currency: "CZK", exponent: 2, value: referrerSavings.value },
              "en-US"
            ),
          },
          { locale: "en-US" }
        );
        assert(
          (
            await screen.locator("#account-referrals-savings").innerText()
          ).includes(saved),
          "the savings tile does not show the seeded paid booking"
        );
        const href = await screen
          .locator("#account-referrals-link")
          .getAttribute("href", { timeout: config.timeouts.browserAction });
        const link = href && URL.canParse(href) ? new URL(href) : undefined;
        assert(
          link?.origin === new URL(config.baseUrl).origin &&
            link.pathname === "/account" &&
            link.searchParams.getAll("ref").join() === referrer.code,
          "the share link is not the absolute locale-free account link"
        );
        assert(
          (await screen.innerText()).includes(
            m.accountReferralsHowTitle({}, { locale: "en-US" })
          ),
          "the referral explainer is missing"
        );
        await captureReviews(context, page, [
          "referral-overview-positive-desktop",
          "referral-overview-positive-mobile",
        ]);
      }
    );

    yield* pageStep(
      context,
      "copy-referral-code-and-link",
      config.timeouts.browserAction * 2,
      async (page) => {
        await page
          .context()
          .grantPermissions(["clipboard-read", "clipboard-write"], {
            origin: new URL(config.baseUrl).origin,
          });
        const link = await page
          .locator("#account-referrals-link")
          .getAttribute("href", { timeout: config.timeouts.browserAction });
        for (const [label, copied, value] of [
          [
            m.accountReferralsCopyCode({}, { locale: "en-US" }),
            m.accountReferralsCodeCopied({}, { locale: "en-US" }),
            referrer.code,
          ],
          [
            m.accountReferralsCopyLink({}, { locale: "en-US" }),
            m.accountReferralsLinkCopied({}, { locale: "en-US" }),
            link,
          ],
        ] as const) {
          const button = page.getByRole("button", { exact: true, name: label });
          await waitForReactClickHandler(page, button);
          await button.click({ timeout: config.timeouts.browserAction });
          await page
            .getByRole("button", { exact: true, name: copied })
            .waitFor({ timeout: config.timeouts.browserAction });
          const clipboard = await page.evaluate(() =>
            navigator.clipboard.readText()
          );
          assert(clipboard === value, `${label} copied a different value`);
        }
      }
    );

    yield* pageStep(
      context,
      "assert-czech-overview-ignores-share-link",
      config.timeouts.browserNavigation * 3 + config.timeouts.browserAction,
      async (page) => {
        await page.goto(
          new URL(getAccountSectionPath("cs-CZ", "referrals"), config.baseUrl)
            .href,
          { timeout: config.timeouts.browserNavigation }
        );
        await waitForReferralStats({
          count: 2,
          locale: "cs-CZ",
          total: 3,
          page,
        });
        await captureReviews(context, page, [
          "referral-overview-positive-cs-desktop",
          "referral-overview-positive-cs-mobile",
        ]);
        await verifyReferralScreenIgnoresShareLink({
          baseUrl: config.baseUrl,
          page,
          shareCode: otherReferrer.code,
        });
      }
    );
  });

const captureReviews = async (
  context: ReferralCaseContext,
  page: Page,
  targets: readonly AccountReviewTarget[]
) => {
  for (const target of targets) {
    await captureAccountReview(
      page,
      { baseUrl: context.config.baseUrl, screenshots: context.screenshots },
      target
    );
  }
};

const profileCompletionCheckout: ReferralCaseExecutor = (
  context,
  checkoutStates
) =>
  Effect.gen(function* () {
    const { browserSession, config, identities, runStep } = context;
    const { account, otherReferrer, referrer } = yield* runStep({
      execute: Effect.gen(function* () {
        const referrer = yield* identities.seedReferrer("rpc-referrer");
        const otherReferrer =
          yield* identities.seedReferrer("rpc-other-referrer");
        const account = yield* identities.seedUnlinkedAccount("rpc-customer");
        yield* identities.signIn(account, context);
        return { account, otherReferrer, referrer };
      }),
      id: "seed-two-referrers-and-sign-in-new-account",
      timeoutMs: config.timeouts.datasource,
    });

    const customerId = yield* runStep({
      execute: Effect.gen(function* () {
        yield* openReferralAccount(
          browserSession,
          config,
          `?ref=${referrer.code}`
        );
        yield* waitForRememberedReferralCode(
          referralCookieContext(context),
          referrer.code
        );
        yield* waitForProfileCompletionForm(
          browserSession,
          config,
          referrer.code
        );
        yield* completeReferralProfile(browserSession, config, account);
        yield* waitForPageText({
          description: "applied referral notice on the linked account",
          matches: (text) => text.includes(appliedNotice),
          session: browserSession,
          timeoutMs: config.timeouts.uiTransition,
        });
        const customerId = yield* requireLinkedCustomer(context, account);
        yield* waitForReferrer(context, customerId, referrer.customerId);
        // The recorded referral uses the remembered code up.
        yield* waitForNoRememberedReferralCode(referralCookieContext(context));
        return customerId;
      }),
      id: "complete-profile-from-remembered-code",
      timeoutMs: config.timeouts.checkoutStart,
    });

    yield* pageStep(
      context,
      "dismiss-referral-notice",
      config.timeouts.browserAction * 2 + config.timeouts.browserNavigation,
      async (page) => {
        const dismiss = page.getByRole("button", {
          exact: true,
          name: m.accountProfileReferralNoticeDismiss({}, { locale: "en-US" }),
        });
        await waitForReactClickHandler(page, dismiss);
        await dismiss.click({ timeout: config.timeouts.browserAction });
        const notice = page.getByText(appliedNotice, { exact: true });
        await notice.waitFor({
          state: "detached",
          timeout: config.timeouts.browserAction,
        });
        await page.reload({ timeout: config.timeouts.browserNavigation });
        await page.locator(accountSectionLandmarks.reservations).waitFor({
          state: "attached",
          timeout: config.timeouts.browserAction,
        });
        assert(
          (await notice.count()) === 0,
          "the dismissed referral notice came back"
        );
      }
    );

    const linked = { ...account, customerId };
    const state = requireSingleState(checkoutStates, linked);
    const locale = state.data.locale;
    let payUrl = yield* startPayPage({
      browserSession,
      config,
      contact: linked,
      data: state.data,
      datasourceConfig: context.datasourceConfig,
      runStep,
      state,
      stepPrefix: "completion-referral",
    });
    yield* runStep({
      execute: assertOrdinaryCodeSlotAvailable({
        config,
        session: browserSession,
      }),
      id: "assert-code-box-free-after-automatic-invitation",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* expectDiscounts(
      context,
      "assert-recorded-referral-discount",
      invitationDiscounts
    );
    yield* captureReviewStep({
      captureReview: checkoutCapture(context),
      expectedPayUrl: payUrl,
      orderId: state.orderId!,
      runStep,
      target: "account-referral-invitation-applied",
    });

    payUrl = yield* runStep({
      execute: rejectReferralCode({
        browserSession,
        code: otherReferrer.code,
        config,
        currentPayUrl: payUrl,
        error: "referral-already-attributed",
        locale,
        message: m.checkoutReferralCodeAlreadyAttributed({}, { locale }),
        orderId: state.orderId!,
      }),
      id: "reject-another-referrer-code",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* expectDiscounts(
      context,
      "assert-referral-kept-after-rejection",
      invitationDiscounts
    );
    yield* runStep({
      execute: assertReferrer(
        customerId,
        referrer.customerId,
        "another referrer's code changed the recorded referral"
      ),
      id: "assert-recorded-referrer-kept",
      timeoutMs: config.timeouts.datasource,
    });
    yield* captureReviewStep({
      captureReview: checkoutCapture(context),
      expectedPayUrl: payUrl,
      orderId: state.orderId!,
      runStep,
      target: "account-referral-change-rejected",
    });

    yield* applyCodeAndReadFreshPayUrl({
      browserSession,
      appliedMessage: referralAppliedMessage(locale),
      code: referrer.code,
      config,
      currentPayUrl: payUrl,
      locale,
      orderId: state.orderId!,
      runStep,
      stepId: "reenter-recorded-referral-code",
    });
    yield* expectDiscounts(
      context,
      "assert-invitation-applied-once",
      invitationDiscounts
    );
  });

const checkoutCodeEntry: ReferralCaseExecutor = (context, checkoutStates) =>
  Effect.gen(function* () {
    const { browserSession, config, identities, runStep } = context;
    const { customer, linkReferrer, referrer } = yield* runStep({
      execute: Effect.gen(function* () {
        const referrer = yield* identities.seedReferrer("rce-referrer");
        const linkReferrer =
          yield* identities.seedReferrer("rce-link-referrer");
        // A completed profile without a referral; it owns its own code.
        const customer = yield* identities.seedReferrer("rce-customer");
        yield* identities.signIn(customer, context);
        return { customer, linkReferrer, referrer };
      }),
      id: "seed-two-referrers-and-sign-in-completed-profile",
      timeoutMs: config.timeouts.datasource,
    });
    const state = requireSingleState(checkoutStates, customer);
    const locale = state.data.locale;
    let payUrl = yield* startPayPage({
      browserSession,
      config,
      contact: customer,
      data: state.data,
      datasourceConfig: context.datasourceConfig,
      runStep,
      referralCode: linkReferrer.code,
      state,
      stepPrefix: "code-entry",
    });
    yield* runStep({
      execute: waitForRememberedReferralCode(
        referralCookieContext(context),
        linkReferrer.code
      ),
      id: "remember-share-link-code",
      timeoutMs: config.timeouts.uiTransition,
    });

    payUrl = yield* runStep({
      execute: rejectReferralCode({
        browserSession,
        code: customer.code,
        config,
        currentPayUrl: payUrl,
        error: "unavailable",
        locale,
        message: m.checkoutDiscountCodeUnavailable({}, { locale }),
        orderId: state.orderId!,
      }),
      id: "reject-own-referral-code",
      timeoutMs: config.timeouts.uiTransition,
    });

    payUrl = yield* applyCodeAndReadFreshPayUrl({
      browserSession,
      appliedMessage: referralAppliedMessage(locale),
      code: referrer.code,
      config,
      currentPayUrl: payUrl,
      locale,
      orderId: state.orderId!,
      runStep,
      stepId: "apply-typed-referrer-code",
    });
    yield* expectDiscounts(
      context,
      "assert-typed-referral-discount",
      invitationDiscounts
    );
    yield* runStep({
      // An accepted typed code replaces the shared link's remembered code.
      execute: waitForRememberedReferralCode(
        referralCookieContext(context),
        referrer.code
      ),
      id: "assert-typed-code-remembered",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: assertNothingRecordedBeforePayment(customer.customerId),
      id: "assert-nothing-recorded-before-payment",
      timeoutMs: config.timeouts.datasource,
    });

    payUrl = yield* applyCodeAndReadFreshPayUrl({
      browserSession,
      appliedMessage: ordinaryCodeAppliedMessage(
        ordinaryCodeAdjustment,
        locale
      ),
      code: discountCodeFixtures.partial.code,
      config,
      currentPayUrl: payUrl,
      locale,
      orderId: state.orderId!,
      runStep,
      stepId: "apply-ordinary-code-after-referral",
    });
    yield* runStep({
      execute: assertReferralConfirmationCleared({
        config,
        locale,
        session: browserSession,
      }),
      id: "assert-referral-confirmation-cleared-after-ordinary-code",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* expectDiscounts(context, "assert-referral-kept-with-ordinary-code", [
      ...invitationDiscounts,
      { adjustment: ordinaryCodeAdjustment, label: "E2E promo code" },
    ]);
    yield* captureReviewStep({
      captureReview: checkoutCapture(context),
      expectedPayUrl: payUrl,
      orderId: state.orderId!,
      runStep,
      target: "account-referral-with-ordinary-code",
    });
  });

const shareLinkCheckout: ReferralCaseExecutor = (context, checkoutStates) =>
  Effect.gen(function* () {
    const { browserSession, config, identities, runStep } = context;
    const { customer, referrer } = yield* runStep({
      execute: Effect.gen(function* () {
        const referrer = yield* identities.seedReferrer("rsl-referrer");
        // The customer refers one eligible invitee, so checkout also shows
        // its own referrer discount next to the invitation.
        const customer = yield* identities.seedReferrer("rsl-customer");
        const invitee = yield* identities.createCustomer("rsl-invitee");
        const visit = yield* identities.createPastVisit(invitee);
        yield* seedWorkspaceE2EReferralInvitee({
          invitedDotyposCustomerId: invitee,
          paidVisit: {
            dotyposReservationId: visit.reservationId,
            endedAt: visit.endedAt,
          },
          referrerDotyposCustomerId: customer.customerId,
          referrerPromotionCodeId: customer.promotionCodeId,
        });
        yield* identities.signIn(customer, context);
        return { customer, referrer };
      }),
      id: "seed-referrer-and-sign-in-customer-with-invitee",
      timeoutMs: config.timeouts.datasource * 2,
    });
    const state = requireSingleState(checkoutStates, customer);
    const locale = state.data.locale;
    let payUrl = yield* startPayPage({
      browserSession,
      config,
      contact: customer,
      data: state.data,
      datasourceConfig: context.datasourceConfig,
      referralCode: referrer.code,
      runStep,
      state,
      stepPrefix: "share-link",
    });
    yield* runStep({
      execute: assertShareLinkReferralApplied({
        config,
        locale,
        orderId: state.orderId!,
        payUrl,
        session: browserSession,
      }),
      id: "assert-share-link-referral-on-first-pay-page",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: assertOrdinaryCodeSlotAvailable({
        config,
        session: browserSession,
      }),
      id: "assert-code-box-free-after-share-link-referral",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* expectDiscounts(
      context,
      "assert-share-link-referral-discount",
      invitationDiscounts
    );
    yield* runStep({
      execute: assertReferrerDiscountMatchesRemainingSubtotal({
        locale,
        session: browserSession,
      }),
      id: "assert-referrer-discount-after-invitation",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        yield* assertNothingRecordedBeforePayment(customer.customerId);
        // Unsettled, so the browser keeps remembering the shared code.
        yield* waitForRememberedReferralCode(
          referralCookieContext(context),
          referrer.code
        );
      }),
      id: "assert-nothing-recorded-and-code-remembered",
      timeoutMs: config.timeouts.datasource,
    });
    yield* captureReviewStep({
      captureReview: checkoutCapture(context),
      expectedPayUrl: payUrl,
      orderId: state.orderId!,
      runStep,
      target: "account-referral-link-applied",
    });

    payUrl = yield* applyCodeAndReadFreshPayUrl({
      browserSession,
      appliedMessage: ordinaryCodeAppliedMessage(
        referralVoucherAdjustment,
        locale
      ),
      code: discountCodeFixtures.accountReferralVoucher.code,
      config,
      currentPayUrl: payUrl,
      locale,
      orderId: state.orderId!,
      runStep,
      stepId: "apply-voucher-after-referral",
    });
    yield* runStep({
      execute: assertReferralConfirmationCleared({
        config,
        locale,
        session: browserSession,
      }),
      id: "assert-referral-confirmation-cleared-after-voucher",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* expectDiscounts(context, "assert-referral-kept-with-voucher", [
      ...invitationDiscounts,
      {
        adjustment: referralVoucherAdjustment,
        label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
      },
    ]);
    yield* runStep({
      execute: assertReferrerDiscountMatchesRemainingSubtotal({
        locale,
        requireVoucherAfterReferrer: true,
        session: browserSession,
      }),
      id: "assert-voucher-credited-after-referral-discounts",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* captureReviewStep({
      captureReview: checkoutCapture(context),
      expectedPayUrl: payUrl,
      orderId: state.orderId!,
      runStep,
      target: "account-referral-with-voucher",
    });
  });

const autoLinkedSignIn: ReferralCaseExecutor = (context) =>
  Effect.gen(function* () {
    const { browserSession, config, identities, runStep } = context;
    const { otherReferrer, referrer } = yield* runStep({
      execute: Effect.gen(function* () {
        const referrer = yield* identities.seedReferrer("ral-referrer");
        const otherReferrer =
          yield* identities.seedReferrer("ral-other-referrer");
        return { otherReferrer, referrer };
      }),
      id: "seed-two-referrers",
      timeoutMs: config.timeouts.datasource,
    });

    // Each first sign-in finds one existing customer with the same email,
    // so the account page links it instead of asking for completion.
    const signInExistingCustomer = (
      label: "ral-usable" | "ral-unusable" | "ral-attributed",
      ref: string,
      prepare: (
        customerId: DotyposCustomerId
      ) => Effect.Effect<
        void,
        WorkspaceE2EError,
        import("../integrations/database.service").E2EDatabase
      > = () => Effect.void
    ) =>
      Effect.gen(function* () {
        const customerId = yield* identities.createCustomer(label);
        yield* prepare(customerId);
        const account = yield* identities.seedUnlinkedAccount(label);
        yield* identities.signIn(account, context);
        yield* openReferralAccount(browserSession, config, `?ref=${ref}`);
        yield* waitForLinkedAccount(browserSession, config);
        const linked = yield* requireLinkedCustomer(context, account);
        if (linked !== customerId) {
          return yield* workspaceE2EError(
            "first sign-in did not link the existing customer",
            {
              diagnosticCode: "postgres_account_fixture_assertion_failed",
              operation: "assert auto-linked customer",
            }
          );
        }
        return customerId;
      });

    // Ordered so each shared link meets an empty cookie: a recorded or
    // existing referral uses the remembered code up, and the unusable code
    // that stays remembered comes last.
    yield* runStep({
      execute: Effect.gen(function* () {
        const customerId = yield* signInExistingCustomer(
          "ral-usable",
          referrer.code
        );
        yield* waitForReferrer(context, customerId, referrer.customerId);
        yield* waitForNoRememberedReferralCode(referralCookieContext(context));
      }),
      id: "assert-remembered-code-recorded-at-auto-link",
      timeoutMs: config.timeouts.checkoutStart,
    });

    yield* runStep({
      execute: Effect.gen(function* () {
        const customerId = yield* signInExistingCustomer(
          "ral-attributed",
          referrer.code,
          (customerId) =>
            seedWorkspaceE2EReferralInvitee({
              invitedDotyposCustomerId: customerId,
              referrerDotyposCustomerId: otherReferrer.customerId,
              referrerPromotionCodeId: otherReferrer.promotionCodeId,
            })
        );
        yield* assertReferrer(
          customerId,
          otherReferrer.customerId,
          "a remembered code replaced an existing referral"
        );
        yield* waitForNoRememberedReferralCode(referralCookieContext(context));
      }),
      id: "assert-existing-referral-kept-at-auto-link",
      timeoutMs: config.timeouts.checkoutStart,
    });

    yield* runStep({
      execute: Effect.gen(function* () {
        const unusableCode = makeUnusableReferralCode();
        const customerId = yield* signInExistingCustomer(
          "ral-unusable",
          unusableCode
        );
        yield* assertReferrer(
          customerId,
          undefined,
          "an unusable remembered code recorded a referral"
        );
        yield* waitForRememberedReferralCode(
          referralCookieContext(context),
          unusableCode
        );
      }),
      id: "assert-auto-link-skips-unusable-code",
      timeoutMs: config.timeouts.checkoutStart,
    });
  });

const profileCompletionUnusableLink: ReferralCaseExecutor = (context) =>
  Effect.gen(function* () {
    const { browserSession, config, identities, runStep } = context;
    const { account, referrer } = yield* runStep({
      execute: Effect.gen(function* () {
        const referrer = yield* identities.seedReferrer("rpu-referrer");
        const account = yield* identities.seedUnlinkedAccount("rpu-customer");
        yield* identities.signIn(account, context);
        return { account, referrer };
      }),
      id: "seed-referrer-and-sign-in-new-account",
      timeoutMs: config.timeouts.datasource,
    });
    const unusableCode = makeUnusableReferralCode();
    yield* runStep({
      execute: Effect.gen(function* () {
        yield* openReferralAccount(
          browserSession,
          config,
          `?ref=${unusableCode}`
        );
        yield* waitForRememberedReferralCode(
          referralCookieContext(context),
          unusableCode
        );
        yield* waitForProfileCompletionForm(browserSession, config, "");
        // The first shared link wins: a later one changes nothing.
        yield* openReferralAccount(
          browserSession,
          config,
          `?ref=${referrer.code}`
        );
        yield* waitForRememberedReferralCode(
          referralCookieContext(context),
          unusableCode
        );
        yield* waitForProfileCompletionForm(browserSession, config, "");
      }),
      id: "assert-first-share-link-remembered",
      timeoutMs:
        2 * (config.timeouts.browserNavigation + config.timeouts.uiTransition),
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        yield* completeReferralProfile(browserSession, config, account);
        const customerId = yield* requireLinkedCustomer(context, account);
        yield* assertReferrer(
          customerId,
          undefined,
          "an unusable remembered code recorded a referral"
        );
      }),
      id: "complete-profile-despite-unusable-code",
      timeoutMs: config.timeouts.checkoutStart,
    });
  });

const referralCaseExecutors: Record<
  WorkspaceE2EReferralCaseId,
  ReferralCaseExecutor
> = {
  "referral-auto-linked-sign-in": autoLinkedSignIn,
  "referral-checkout-code-entry": checkoutCodeEntry,
  "referral-profile-completion-checkout": profileCompletionCheckout,
  "referral-profile-completion-unusable-link": profileCompletionUnusableLink,
  "referral-referrer-screen": referrerScreen,
  "referral-share-link-checkout": shareLinkCheckout,
};
