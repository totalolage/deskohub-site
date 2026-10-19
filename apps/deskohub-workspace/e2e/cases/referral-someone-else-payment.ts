import { deepStrictEqual } from "node:assert/strict";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import { m } from "@/features/i18n";
import { referralCodeQueryParam } from "@/features/referrals/client";
import {
  makeWorkspaceE2ECaseIdentities,
  type WorkspaceE2ECaseIdentities,
} from "../account/case-identities";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import type { WorkspaceE2EAccountJournalOwner } from "../account/reconcile";
import { seedWorkspaceE2EReferralOwner } from "../account/referral-fixture";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import { waitForBrowserUrl } from "../browser";
import { getSubmitCoworkReservationScript } from "../browser-scripts";
import {
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectCoworkDates,
  withCheckoutContactEmail,
} from "../checkout/data";
import {
  applyDiscountCode,
  assertRequestedOnlyDiscountCode,
} from "../checkout/discount-code";
import {
  type DatasourceConfig,
  getConfig,
  getDatasourceConfig,
  type WorkspaceE2EConfig,
} from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import {
  type ExpectedDiscountApplication,
  type ReferralInvitationPaymentRecord,
  readReferralInvitationPayment,
  waitForCheckoutRow,
} from "../integrations/database";
import { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ECaseBinder } from "../playwright-checkout/fixtures";
import {
  isReferralAppliedPayUrl,
  referralAppliedMessage,
} from "../referrals/checkout";
import {
  waitForNoRememberedReferralCode,
  waitForRememberedReferralCode,
} from "../referrals/referral-cookie";
import { addRedaction, assert, type Runner } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  CheckoutRow,
  WorkspaceE2ECase,
  WorkspaceE2EStep,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import {
  assertDisplayedDiscounts,
  calendarDiscountExpectation,
} from "./discounts";

export const referralSomeoneElsePaymentCaseId =
  "checkout-referral-someone-else";

const referrerRecipientLabel = "rse-referrer";
const bookerRecipientLabel = "rse-booker";
const customerRecipientLabel = "rse-customer";

type RecipientLabel =
  | typeof bookerRecipientLabel
  | typeof customerRecipientLabel
  | typeof referrerRecipientLabel;

/**
 * The case's own identity journal: the seeded referrer, the seeded booker,
 * and the customer the booking creates, each derived from a run-scoped
 * recipient.
 */
export const referralSomeoneElsePaymentJournalOwner: WorkspaceE2EAccountJournalOwner =
  {
    ownerId: referralSomeoneElsePaymentCaseId,
    recipientLabels: [
      referrerRecipientLabel,
      bookerRecipientLabel,
      customerRecipientLabel,
    ],
  };

const invitationAdjustment = {
  basisPoints: 1500,
  kind: "percentage",
} as const;

const getInvitationDiscount = (
  locale: CheckoutData["locale"]
): ExpectedDiscountApplication => ({
  adjustment: invitationAdjustment,
  label: m.checkoutSummaryItemReferralInvitationDiscount({}, { locale }),
});

/**
 * The paid order's discount applications, in order. The long-lived E2E
 * Calendar sale covers every cowork date, so the invitation applies after it,
 * to the sale's remaining subtotal.
 */
export const getReferralSomeoneElseDiscounts = (
  locale: CheckoutData["locale"]
): readonly ExpectedDiscountApplication[] => [
  calendarDiscountExpectation,
  getInvitationDiscount(locale),
];

/**
 * Plans the paid referral checkout on its own cowork date, after every
 * other case has planned its dates. The case pool binds the run-scoped
 * identities before the case runs.
 */
export const planReferralSomeoneElsePaymentCase = ({
  allocation,
  availableBasicDates,
  config,
  flowStates,
}: {
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly availableBasicDates: readonly string[];
  readonly config: WorkspaceE2EConfig;
  readonly flowStates: CheckoutFlowState[];
}): Effect.Effect<WorkspaceE2ECase, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dates = yield* selectCoworkDates(availableBasicDates, 1, {
      allocation,
      excludedDates: new Set(flowStates.map(({ data }) => data.date)),
      selectionLabel: "someone-else referral payment",
    });
    const state: CheckoutFlowState = {
      data: makeCoworkCheckoutData(
        config.baseUrl,
        yield* requireCheckoutDate(dates, 0),
        referralSomeoneElsePaymentCaseId
      ),
    };
    flowStates.push(state);
    return {
      checkoutStates: [state],
      execute: () =>
        Effect.fail(
          workspaceE2EError(
            `${referralSomeoneElsePaymentCaseId} must be bound to its run-scoped identities by the case pool`,
            { operation: "bind someone-else referral payment case" }
          )
        ),
      id: referralSomeoneElsePaymentCaseId,
      timeoutMs: config.timeouts.checkoutCase,
    };
  });

/**
 * Binds the planned case to this run's synthetic identities: a signed-in
 * booker opens a shared referral link and books for the referred customer.
 */
export const bindReferralSomeoneElsePaymentCase: WorkspaceE2ECaseBinder =
  async ({ environment, run, runId, testCase }) => {
    if (testCase.id !== referralSomeoneElsePaymentCaseId) return testCase;
    const [state] = testCase.checkoutStates;
    if (!state || testCase.checkoutStates.length !== 1) {
      throw new Error(
        "planned someone-else referral payment checkout is incomplete"
      );
    }
    const config = getConfig(environment);
    const datasourceConfig = getDatasourceConfig(environment);
    const identities = makeWorkspaceE2ECaseIdentities<RecipientLabel>({
      baseUrl: config.baseUrl,
      datasourceConfig,
      displayName: (label) => recipientDisplayNames[label],
      journalOwnerId: referralSomeoneElsePaymentCaseId,
      run,
      runId,
      secret: resolveWorkspaceE2ESessionSigningSecret(environment),
    });
    const boundState: CheckoutFlowState = {
      data: withCheckoutContactEmail(
        state.data,
        makeWorkspaceE2EAccountRecipientForRunId(runId, customerRecipientLabel)
      ),
    };
    return {
      ...testCase,
      checkoutStates: [boundState],
      execute: ({ runStep, session }) =>
        executeReferralSomeoneElsePayment({
          config,
          datasourceConfig,
          identities,
          run,
          runStep,
          session,
          state: boundState,
        }).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.mapError((cause) =>
            toWorkspaceE2EError(
              "run someone-else referral payment e2e case",
              cause
            )
          )
        ),
    };
  };

const recipientDisplayNames: Record<RecipientLabel, string> = {
  [bookerRecipientLabel]: "Workspace E2E Booker",
  [customerRecipientLabel]: "Workspace E2E Referred Customer",
  [referrerRecipientLabel]: "Synthetic Referral Referrer",
};

type Identities = WorkspaceE2ECaseIdentities<RecipientLabel>;

/** The reservation URL a booker opens from a shared referral link. */
const withReferralCode = (data: CheckoutData, code: string): CheckoutData => {
  const url = new URL(data.checkoutUrl);
  url.searchParams.set(referralCodeQueryParam, code);
  return { ...data, checkoutUrl: url.toString() };
};

const executeReferralSomeoneElsePayment = Effect.fn(
  "ReferralSomeoneElsePayment.execute"
)(function* ({
  config,
  datasourceConfig,
  identities,
  run,
  runStep,
  session,
  state,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly identities: Identities;
  readonly run: Runner;
  readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
  readonly session: string;
  readonly state: CheckoutFlowState;
}) {
  const database = yield* E2EDatabase;
  const locale = state.data.locale;
  const invitationDiscount = getInvitationDiscount(locale);
  const expectedDiscounts = getReferralSomeoneElseDiscounts(locale);

  yield* runStep({
    execute: waitForNoRememberedReferralCode({ config, run, session }),
    id: "starts-without-remembered-referral-code",
    timeoutMs: config.timeouts.uiTransition,
  });
  const referrer = yield* runStep({
    execute: seedReferrer(identities),
    id: "seed-synthetic-referrer",
    timeoutMs: config.timeouts.datasource,
  });
  const booker = yield* runStep({
    execute: identities.seedLinkedAccount(bookerRecipientLabel),
    id: "seed-synthetic-booker",
    timeoutMs: config.timeouts.datasource,
  });
  yield* runStep({
    execute: identities.signIn(booker, session),
    id: "sign-in-synthetic-booker",
    timeoutMs: config.timeouts.datasource,
  });
  const data = withReferralCode(state.data, referrer.code);
  state.data = data;

  let bookedCustomerId: string | undefined;
  const payPageSteps = (
    orderId: CheckoutRow["reservation_id"]
  ): readonly WorkspaceE2EStep<void>[] => [
    {
      // Journal the booked customer before payment can attribute it.
      execute: Effect.gen(function* () {
        const row = yield* waitForCheckoutRow(datasourceConfig, orderId);
        const customerId = yield* tryWorkspaceE2ESync(
          "read booked customer",
          () => {
            assert(row.dotypos_customer_id, "booked customer missing");
            assert(
              row.dotypos_customer_id !== referrer.customerId,
              "someone-else booking resolved to the referrer"
            );
            assert(
              row.dotypos_customer_id !== booker.customerId,
              "someone-else booking resolved to the booker"
            );
            return row.dotypos_customer_id;
          }
        );
        bookedCustomerId = customerId;
        yield* identities.journalCustomer(customerId);
      }).pipe(Effect.provideService(E2EDatabase, database)),
      id: "journal-booked-customer",
      timeoutMs: config.timeouts.datasource,
    },
    {
      // The shared reservation link left its code in the booker's cookie,
      // which prefills the box.
      execute: waitForRememberedReferralCode(
        { config, run, session },
        referrer.code
      ),
      id: "remember-shared-referral-code",
      timeoutMs: config.timeouts.uiTransition,
    },
    {
      execute: assertRequestedOnlyDiscountCode({
        code: canonicalPromotionCodeSchema.make(referrer.code),
        config,
        run,
        session,
      }),
      id: "assert-referral-code-prefilled",
      timeoutMs: config.timeouts.uiTransition,
    },
    {
      execute: Effect.gen(function* () {
        yield* applyDiscountCode({
          appliedMessage: referralAppliedMessage(locale),
          code: referrer.code,
          config,
          run,
          session,
        });
        yield* waitForBrowserUrl({
          description: "referral-applied pay page",
          matches: (currentUrl) =>
            isReferralAppliedPayUrl({
              baseUrl: config.baseUrl,
              currentUrl,
              locale,
              orderId,
            }),
          run,
          session,
          timeoutMs: config.timeouts.uiTransition,
        });
      }),
      id: "apply-referral-invitation-code",
      timeoutMs: config.timeouts.uiTransition,
    },
    {
      execute: assertDisplayedDiscounts({
        config,
        discounts: expectedDiscounts,
        run,
        session,
      }),
      id: "assert-referral-invitation-discount",
      timeoutMs: config.timeouts.uiTransition,
    },
  ];

  yield* executeCheckoutFlow({
    config,
    data,
    datasourceConfig,
    expectedDiscounts,
    flow: {
      id: referralSomeoneElsePaymentCaseId,
      submitReservationScript: getSubmitCoworkReservationScript,
    },
    payPageSteps,
    run,
    runStep,
    session,
    state,
  });

  yield* runStep({
    // Booking for someone else never settles the booker's own referral, so
    // the paid status page leaves the booker's remembered code in place.
    execute: waitForRememberedReferralCode(
      { config, run, session },
      referrer.code
    ),
    id: "keep-booker-referral-code-after-paid-status",
    timeoutMs: config.timeouts.uiTransition,
  });
  const orderId = state.orderId;
  yield* runStep({
    execute: Effect.gen(function* () {
      const record = orderId
        ? yield* readReferralInvitationPayment(orderId)
        : undefined;
      yield* tryWorkspaceE2ESync("assert someone-else referral payment", () =>
        assertReferralSomeoneElsePayment(record, {
          bookedCustomerId,
          invitationLabel: invitationDiscount.label,
          referrerCustomerId: referrer.customerId,
        })
      );
    }),
    id: "validate-referral-attribution",
    timeoutMs: config.timeouts.datasource,
  });
});

const seedReferrer = Effect.fn("ReferralSomeoneElsePayment.seedReferrer")(
  function* (identities: Identities) {
    const account = identities.describe(referrerRecipientLabel);
    yield* identities.record({ authUserIds: [account.accountId] });
    const customerId = yield* identities.createCustomer(referrerRecipientLabel);
    const owner = yield* seedWorkspaceE2EReferralOwner({
      accountId: account.accountId,
      dotyposCustomerId: customerId,
      email: account.email,
      name: account.name,
    });
    addRedaction(owner.code, true);
    return { code: owner.code, customerId };
  }
);

/**
 * The paid order carries the 15% invitation: the booked customer is
 * attributed to the seeded referrer, and its one active invitation claim is
 * redeemed by the order's active attempt through that attempt's invitation
 * application.
 */
export const assertReferralSomeoneElsePayment = (
  record: ReferralInvitationPaymentRecord | undefined,
  expected: {
    readonly bookedCustomerId: string | undefined;
    readonly invitationLabel: string;
    readonly referrerCustomerId: string;
  }
) => {
  assert(record, "referral order missing");
  assert(record.paymentState === "paid", "referral order is not paid");
  assert(
    record.dotyposCustomerId !== null &&
      record.dotyposCustomerId === expected.bookedCustomerId,
    "referral order changed its booked customer"
  );
  assert(
    record.attributions.length === 1 &&
      record.attributions[0]?.referrerDotyposCustomerId ===
        expected.referrerCustomerId,
    "booked customer is not attributed to the seeded referrer"
  );
  const activeClaims = record.claims.filter(
    ({ state }) => state === "reserved" || state === "redeemed"
  );
  const [claim] = activeClaims;
  assert(
    claim && activeClaims.length === 1,
    "booked customer needs exactly one active referral invitation claim"
  );
  assert(claim.state === "redeemed", "referral invitation claim not redeemed");
  assert(
    record.activePaymentAttemptId !== null &&
      claim.paymentAttemptId === record.activePaymentAttemptId,
    "referral invitation claim is not on the paid attempt"
  );
  const application = record.applications.find(
    ({ id }) => id === claim.applicationId
  );
  assert(
    application?.paymentAttemptId === record.activePaymentAttemptId,
    "referral invitation claim has no application on the paid attempt"
  );
  assert(
    application.label === expected.invitationLabel,
    "referral invitation application label changed"
  );
  deepStrictEqual(
    application.adjustment,
    invitationAdjustment,
    "referral invitation application is not 15%"
  );
};
