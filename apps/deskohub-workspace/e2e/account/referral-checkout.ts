import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import {
  formatWorkspaceMoney,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  evalBrowserScript,
  openBrowserPage,
  readBrowserUrl,
  waitForBrowserCondition,
} from "../browser";
import { getSubmitCoworkReservationScript } from "../browser-scripts";
import { assertDisplayedDiscounts } from "../cases/discounts";
import { applyDiscountCode } from "../checkout/discount-code";
import { submitReservationForPayPage } from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { tryWorkspaceE2ESync, workspaceE2EError } from "../errors";
import {
  type ExpectedDiscountApplication,
  waitForCheckoutRow,
} from "../integrations/database";
import { discountCodeFixtures } from "../integrations/discount-fixtures";
import { pollUntil } from "../polling";
import { assert, type Runner } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import type { WorkspaceE2EReferralCheckoutReviewTarget } from "./referral-checkout-review";

const invitationAdjustment = { kind: "percentage", basisPoints: 1500 } as const;
const referrerEligibleInviteeCount = 1;
const accountReferralVoucherAmount = {
  currency: "CZK",
  exponent: 2,
  value: 10_000,
} as const;
const ordinaryCodeSlotObservationKey =
  "__deskohubE2EReferralDiscountFormObservation";
const ordinaryCodeSlotObservationMaximumCount = 9;

type OrdinaryCodeSlotObservation = {
  readonly formCount: number;
  readonly namedFieldCount: number;
  readonly namedInputEmpty: 0 | 1;
  readonly namedInputEnabled: 0 | 1;
  readonly namedInputPresent: 0 | 1;
  readonly selectedFormPresent: 0 | 1;
  readonly selectedFormVisible: 0 | 1;
  readonly submitEnabled: 0 | 1;
  readonly submitPresent: 0 | 1;
};

export const calculateSingleInviteeReferralDiscount = (
  remainingSubtotal: WorkspaceMoney
): WorkspaceMoney => ({
  ...remainingSubtotal,
  value: Number((BigInt(remainingSubtotal.value) + 10n) / 20n),
});

export type WorkspaceE2EAccountReferralCheckoutContact = {
  readonly customerId: DotyposCustomerId;
  readonly email: string;
  readonly name: string;
  readonly phone: string;
};

export type WorkspaceE2EAccountReferralCheckoutCapture = (input: {
  readonly expectedPayUrl: string;
  readonly orderId: WorkspaceReservationId;
  readonly target: WorkspaceE2EReferralCheckoutReviewTarget;
}) => Promise<void>;

export const bindWorkspaceE2EAccountReferralCheckout = ({
  captureReview,
  config,
  contact,
  datasourceConfig,
  referralCode,
  run,
  testCase,
}: {
  readonly captureReview: WorkspaceE2EAccountReferralCheckoutCapture;
  readonly config: WorkspaceE2EConfig;
  readonly contact: WorkspaceE2EAccountReferralCheckoutContact;
  readonly datasourceConfig: DatasourceConfig;
  readonly referralCode: string;
  readonly run: Runner;
  readonly testCase: WorkspaceE2ECase;
}): WorkspaceE2ECase => {
  const states = testCase.checkoutStates.map((state) => ({
    ...state,
    data: bindCheckoutContact(state.data, contact),
  }));
  const dates = states.map(({ data }) => data.date);
  if (
    testCase.id !== "account-referral-checkout" ||
    states.length !== 2 ||
    dates[0] === dates[1] ||
    states.some(({ data }) => data.expectedReservationDetails.kind !== "cowork")
  ) {
    throw new Error("planned account referral checkout is incomplete");
  }

  const referralDiscounts = getReferralDiscountExpectations();
  const invitationSuccess = m.checkoutReferralDiscountApplied(
    {},
    { locale: "en-US" }
  );
  const ordinarySuccess = m.checkoutDiscountCodeApplied(
    {
      discount: formatDiscountAdjustment(
        {
          kind: "percentage",
          basisPoints: 1000,
        },
        "en-US"
      ),
    },
    { locale: "en-US" }
  );
  const voucherAdjustment = {
    kind: "fixed",
    amount: accountReferralVoucherAmount,
  } as const;
  const voucherSuccess = m.checkoutDiscountCodeApplied(
    { discount: formatDiscountAdjustment(voucherAdjustment, "en-US") },
    { locale: "en-US" }
  );

  return {
    ...testCase,
    checkoutStates: states,
    execute: Effect.fn("WorkspaceE2EAccountReferralCheckout.execute")(
      function* ({ runStep, session }) {
        const [ordinaryState, voucherState] = states;
        if (!ordinaryState || !voucherState) {
          return yield* workspaceE2EError(
            "planned account referral checkout is missing a flow state",
            { operation: "read account referral checkout states" }
          );
        }

        let ordinaryPayUrl = yield* startPayPage({
          config,
          contact,
          data: ordinaryState.data,
          datasourceConfig,
          run,
          runStep,
          session,
          state: ordinaryState,
          stepPrefix: "ordinary-flow",
        });
        ordinaryPayUrl = yield* applyCodeAndReadFreshPayUrl({
          appliedMessage: invitationSuccess,
          code: referralCode,
          config,
          currentPayUrl: ordinaryPayUrl,
          locale: ordinaryState.data.locale,
          orderId: ordinaryState.orderId!,
          run,
          runStep,
          session,
          stepId: "accept-referral-invitation",
        });
        yield* runStep({
          execute: assertOrdinaryCodeSlotAvailable({
            config,
            run,
            session,
          }),
          id: "assert-ordinary-code-slot-after-referral",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* runStep({
          execute: assertDisplayedDiscounts({
            config,
            discounts: referralDiscounts,
            run,
            session,
          }),
          id: "assert-referral-invitation-discount",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* runStep({
          execute: assertReferrerDiscountMatchesRemainingSubtotal({
            locale: ordinaryState.data.locale,
            run,
            session,
          }),
          id: "assert-referrer-fixed-discount-after-invitation",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* captureReviewStep({
          captureReview,
          expectedPayUrl: ordinaryPayUrl,
          orderId: ordinaryState.orderId!,
          target: "account-referral-invitation-applied",
          runStep,
        });

        ordinaryPayUrl = yield* applyCodeAndReadFreshPayUrl({
          appliedMessage: ordinarySuccess,
          code: discountCodeFixtures.partial.code,
          config,
          currentPayUrl: ordinaryPayUrl,
          locale: ordinaryState.data.locale,
          orderId: ordinaryState.orderId!,
          run,
          runStep,
          session,
          stepId: "apply-ordinary-code-after-referral",
        });
        yield* runStep({
          execute: assertReferralConfirmationCleared({
            config,
            locale: ordinaryState.data.locale,
            run,
            session,
          }),
          id: "assert-referral-confirmation-cleared-after-ordinary-code",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* runStep({
          execute: assertDisplayedDiscounts({
            config,
            discounts: [
              ...referralDiscounts,
              {
                adjustment: { kind: "percentage", basisPoints: 1000 },
                label: "E2E promo code",
              },
            ],
            run,
            session,
          }),
          id: "assert-referral-and-ordinary-discounts",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* runStep({
          execute: assertReferrerDiscountMatchesRemainingSubtotal({
            locale: ordinaryState.data.locale,
            run,
            session,
          }),
          id: "assert-referrer-fixed-discount-after-ordinary-code",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* captureReviewStep({
          captureReview,
          expectedPayUrl: ordinaryPayUrl,
          orderId: ordinaryState.orderId!,
          target: "account-referral-with-ordinary-code",
          runStep,
        });

        let voucherPayUrl = yield* startPayPage({
          config,
          contact,
          data: voucherState.data,
          datasourceConfig,
          run,
          runStep,
          session,
          state: voucherState,
          stepPrefix: "voucher-flow",
        });
        voucherPayUrl = yield* applyCodeAndReadFreshPayUrl({
          appliedMessage: invitationSuccess,
          code: referralCode,
          config,
          currentPayUrl: voucherPayUrl,
          locale: voucherState.data.locale,
          orderId: voucherState.orderId!,
          run,
          runStep,
          session,
          stepId: "reaccept-referral-invitation",
        });
        yield* runStep({
          execute: assertOrdinaryCodeSlotAvailable({
            config,
            run,
            session,
          }),
          id: "assert-ordinary-code-slot-after-idempotent-referral",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* runStep({
          execute: assertDisplayedDiscounts({
            config,
            discounts: referralDiscounts,
            run,
            session,
          }),
          id: "assert-idempotent-referral-discount",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* runStep({
          execute: assertReferrerDiscountMatchesRemainingSubtotal({
            locale: voucherState.data.locale,
            run,
            session,
          }),
          id: "assert-referrer-fixed-discount-after-idempotent-referral",
          timeoutMs: config.timeouts.uiTransition,
        });

        voucherPayUrl = yield* applyCodeAndReadFreshPayUrl({
          appliedMessage: voucherSuccess,
          code: discountCodeFixtures.accountReferralVoucher.code,
          config,
          currentPayUrl: voucherPayUrl,
          locale: voucherState.data.locale,
          orderId: voucherState.orderId!,
          run,
          runStep,
          session,
          stepId: "apply-voucher-after-referral",
        });
        yield* runStep({
          execute: assertReferralConfirmationCleared({
            config,
            locale: voucherState.data.locale,
            run,
            session,
          }),
          id: "assert-referral-confirmation-cleared-after-voucher",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* runStep({
          execute: assertDisplayedDiscounts({
            config,
            discounts: [
              ...referralDiscounts,
              {
                adjustment: voucherAdjustment,
                label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
              },
            ],
            run,
            session,
          }),
          id: "assert-referral-and-voucher-discounts",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* runStep({
          execute: assertReferrerDiscountMatchesRemainingSubtotal({
            locale: voucherState.data.locale,
            requireVoucherAfterReferrer: true,
            run,
            session,
          }),
          id: "assert-referrer-fixed-discount-before-voucher-credit",
          timeoutMs: config.timeouts.uiTransition,
        });
        yield* captureReviewStep({
          captureReview,
          expectedPayUrl: voucherPayUrl,
          orderId: voucherState.orderId!,
          target: "account-referral-with-voucher",
          runStep,
        });
      }
    ),
  };
};

const startPayPage = ({
  config,
  contact,
  data,
  datasourceConfig,
  run,
  runStep,
  session,
  state,
  stepPrefix,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly contact: WorkspaceE2EAccountReferralCheckoutContact;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
  readonly session: string;
  readonly state: CheckoutFlowState;
  readonly stepPrefix: string;
}) =>
  runStep({
    execute: Effect.gen(function* () {
      state.startedAt = new Date();
      yield* openBrowserPage(config, run, session, data.checkoutUrl, {
        timeoutMs: config.timeouts.browserNavigation,
      });
      let payUrl: string | undefined;
      const orderId = yield* submitReservationForPayPage({
        onOrderId: (value) => {
          state.orderId = value;
        },
        onPayPageUrl: (value) => {
          payUrl = value;
        },
        run,
        session,
        submitReservationScript: getSubmitCoworkReservationScript(data),
        timeouts: config.timeouts,
      });
      state.orderId = orderId;
      if (!payUrl) {
        payUrl = yield* readBrowserUrl(run, session);
      }
      if (!payUrl) {
        return yield* workspaceE2EError(
          "checkout did not reach its signed pay page",
          { operation: "read account referral checkout pay page" }
        );
      }
      const row = yield* waitForCheckoutRow(datasourceConfig, orderId);
      if (row.dotypos_customer_id !== contact.customerId) {
        return yield* workspaceE2EError(
          "account referral checkout did not resolve to its verified customer",
          { operation: "verify account referral checkout customer" }
        );
      }
      return payUrl;
    }),
    id: `prepare-${stepPrefix}-pay-page`,
    timeoutMs: config.timeouts.checkoutStart,
  });

const applyCodeAndReadFreshPayUrl = ({
  appliedMessage,
  code,
  config,
  currentPayUrl,
  locale,
  orderId,
  run,
  runStep,
  session,
  stepId,
}: {
  readonly appliedMessage: string;
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly currentPayUrl: string;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
  readonly run: Runner;
  readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
  readonly session: string;
  readonly stepId: string;
}) =>
  runStep({
    execute: Effect.gen(function* () {
      yield* applyDiscountCode({
        appliedMessage,
        code,
        config,
        run,
        session,
      });
      return yield* waitForFreshPayStateUrl({
        config,
        locale,
        orderId,
        previousUrl: currentPayUrl,
        run,
        session,
      });
    }),
    id: stepId,
    timeoutMs: config.timeouts.uiTransition,
  });

const waitForFreshPayStateUrl = ({
  config,
  locale,
  orderId,
  previousUrl,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
  readonly previousUrl: string;
  readonly run: Runner;
  readonly session: string;
}) =>
  pollUntil(
    readBrowserUrl(run, session).pipe(
      Effect.map((url) =>
        url &&
        isFreshOwnedPayStateUrl(url, previousUrl, config, locale, orderId)
          ? url
          : undefined
      )
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: "fresh signed checkout pay state",
      timeoutMs: config.timeouts.uiTransition,
    }
  );

const assertOrdinaryCodeSlotAvailable = ({
  config,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly run: Runner;
  readonly session: string;
}) =>
  waitForBrowserCondition(
    run,
    session,
    "ordinary code slot after referral acceptance",
    `(() => {
      const formSelector = "#checkout-discount-code-form";
      const inputSelector = 'input[name="submittedCode"]';
      const buttonSelector = 'button[type="submit"]';
      const forms = document.querySelectorAll(formSelector);
      const form = document.querySelector("#checkout-discount-code-form");
      const input = form?.querySelector(inputSelector);
      const submit = form?.querySelector(buttonSelector);
      const inputIsPresent = input instanceof HTMLInputElement;
      const submitIsPresent = submit instanceof HTMLButtonElement;
      const formStyle = form ? window.getComputedStyle(form) : undefined;
      const observation = {
        formCount: Math.min(forms.length, ${ordinaryCodeSlotObservationMaximumCount}),
        namedFieldCount: Math.min(
          document.querySelectorAll(inputSelector).length,
          ${ordinaryCodeSlotObservationMaximumCount}
        ),
        selectedFormPresent: form === null ? 0 : 1,
        selectedFormVisible:
          form !== null &&
          form.getClientRects().length > 0 &&
          formStyle?.display !== "none" &&
          formStyle?.visibility === "visible"
            ? 1
            : 0,
        namedInputPresent: inputIsPresent ? 1 : 0,
        namedInputEnabled: inputIsPresent && !input.disabled ? 1 : 0,
        namedInputEmpty: inputIsPresent && input.value === "" ? 1 : 0,
        submitPresent: submitIsPresent ? 1 : 0,
        submitEnabled: submitIsPresent && !submit.disabled ? 1 : 0,
      };
      window[${JSON.stringify(ordinaryCodeSlotObservationKey)}] = observation;
      return input instanceof HTMLInputElement &&
        !input.disabled &&
        input.value === "" &&
        submit instanceof HTMLButtonElement &&
        !submit.disabled;
    })()`,
    { timeoutMs: config.timeouts.uiTransition }
  ).pipe(
    Effect.ensuring(
      annotateOrdinaryCodeSlotObservation({ run, session })
    )
  );

const annotateOrdinaryCodeSlotObservation = ({
  run,
  session,
}: {
  readonly run: Runner;
  readonly session: string;
}) =>
  Effect.exit(
    evalBrowserScript(
      "read bounded referral discount form observation",
      run,
      session,
      `(() => {
        const key = ${JSON.stringify(ordinaryCodeSlotObservationKey)};
        const observation = window[key];
        delete window[key];
        return observation;
      })()`,
      {
        logCommand: false,
        logOutput: false,
        timeoutMs: workspaceE2EPollIntervalMs.browser,
      }
    ).pipe(
      Effect.flatMap(({ stdout }) =>
        Effect.try({
          catch: () => undefined,
          try: () => JSON.parse(stdout) as unknown,
        })
      ),
      Effect.flatMap((value) => {
        const observation = parseOrdinaryCodeSlotObservation(value);
        return observation
          ? Effect.annotateCurrentSpan({
              "e2e.account.discount_form.form_count":
                observation.formCount,
              "e2e.account.discount_form.named_field_count":
                observation.namedFieldCount,
              "e2e.account.discount_form.selected_form_present":
                observation.selectedFormPresent,
              "e2e.account.discount_form.selected_form_visible":
                observation.selectedFormVisible,
              "e2e.account.discount_form.named_input_present":
                observation.namedInputPresent,
              "e2e.account.discount_form.named_input_enabled":
                observation.namedInputEnabled,
              "e2e.account.discount_form.named_input_empty":
                observation.namedInputEmpty,
              "e2e.account.discount_form.submit_present":
                observation.submitPresent,
              "e2e.account.discount_form.submit_enabled":
                observation.submitEnabled,
            })
          : Effect.void;
      })
    )
  ).pipe(Effect.asVoid);

const parseOrdinaryCodeSlotObservation = (
  value: unknown
): OrdinaryCodeSlotObservation | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const observation = value as Record<string, unknown>;
  const isFlag = (candidate: unknown): candidate is 0 | 1 =>
    candidate === 0 || candidate === 1;
  const isCount = (candidate: unknown): candidate is number =>
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate >= 0 &&
    candidate <= ordinaryCodeSlotObservationMaximumCount;

  if (
    !isCount(observation.formCount) ||
    !isCount(observation.namedFieldCount) ||
    !isFlag(observation.selectedFormPresent) ||
    !isFlag(observation.selectedFormVisible) ||
    !isFlag(observation.namedInputPresent) ||
    !isFlag(observation.namedInputEnabled) ||
    !isFlag(observation.namedInputEmpty) ||
    !isFlag(observation.submitPresent) ||
    !isFlag(observation.submitEnabled)
  ) {
    return undefined;
  }

  return {
    formCount: observation.formCount,
    namedFieldCount: observation.namedFieldCount,
    selectedFormPresent: observation.selectedFormPresent,
    selectedFormVisible: observation.selectedFormVisible,
    namedInputPresent: observation.namedInputPresent,
    namedInputEnabled: observation.namedInputEnabled,
    namedInputEmpty: observation.namedInputEmpty,
    submitPresent: observation.submitPresent,
    submitEnabled: observation.submitEnabled,
  };
};

const assertReferralConfirmationCleared = ({
  config,
  locale,
  run,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly locale: CheckoutData["locale"];
  readonly run: Runner;
  readonly session: string;
}) => {
  const message = m.checkoutReferralDiscountApplied({}, { locale });
  return waitForBrowserCondition(
    run,
    session,
    "referral confirmation cleared after ordinary code application",
    `(() => !(document.body?.innerText.includes(${JSON.stringify(message)})))()`,
    { timeoutMs: config.timeouts.uiTransition }
  );
};

const assertReferrerDiscountMatchesRemainingSubtotal = Effect.fn(
  "WorkspaceE2EAccountReferralCheckout.assertReferrerDiscount"
)(function* ({
  locale,
  requireVoucherAfterReferrer = false,
  run,
  session,
}: {
  readonly locale: CheckoutData["locale"];
  readonly requireVoucherAfterReferrer?: boolean;
  readonly run: Runner;
  readonly session: string;
}) {
  const result = yield* evalBrowserScript(
    "read visible checkout discount amounts",
    run,
    session,
    `(() => {
        const trigger = document.querySelector('[data-checkout-discount-details]');
        const contentId = trigger?.getAttribute('aria-describedby');
        const content = contentId ? document.getElementById(contentId) : undefined;
        const originalPrice = document.querySelector('del[aria-hidden="true"]')?.textContent?.trim();
        const rows = [...(content?.querySelectorAll('li') ?? [])].map((row) => {
          const details = row.firstElementChild;
          return {
            label: details?.firstElementChild?.textContent?.trim() ?? '',
            adjustment: details?.children.item(1)?.textContent?.trim() ?? '',
            amount: row.lastElementChild?.textContent?.trim() ?? '',
          };
        });
        return JSON.stringify({ originalPrice, rows });
      })()`,
    { logOutput: false }
  );
  yield* tryWorkspaceE2ESync("assert visible fixed referral discount", () => {
    const snapshot = JSON.parse(result.stdout) as {
      readonly originalPrice: string | null;
      readonly rows: readonly {
        readonly adjustment: string;
        readonly amount: string;
        readonly label: string;
      }[];
    };
    assert(snapshot.originalPrice, "discounted product price is missing");
    const invitationLabel = m.checkoutSummaryItemReferralInvitationDiscount(
      {},
      { locale }
    );
    const referrerLabel = m.checkoutSummaryItemReferralDiscount(
      { count: String(referrerEligibleInviteeCount) },
      { locale }
    );
    const referrerIndex = snapshot.rows.findIndex(
      ({ label }) => label === referrerLabel
    );
    assert(referrerIndex > 0, "referrer discount row is missing");
    assert(
      snapshot.rows
        .slice(0, referrerIndex)
        .some(({ label }) => label === invitationLabel),
      "invitation discount does not precede the referrer discount"
    );
    if (requireVoucherAfterReferrer) {
      const voucherLabel = m.checkoutVoucherLabel({}, { locale });
      const voucherIndex = snapshot.rows.findIndex(
        ({ label }) => label === voucherLabel
      );
      assert(
        voucherIndex > referrerIndex,
        "voucher credit does not follow the invitation and referrer discounts"
      );
    }

    const priorDiscountTotal = snapshot.rows
      .slice(0, referrerIndex)
      .reduce(
        (total, row) => total + parseDisplayedCzkAmount(row.amount, locale),
        0
      );
    const remainingSubtotal =
      parseDisplayedCzkAmount(snapshot.originalPrice, locale) -
      priorDiscountTotal;
    assert(
      Number.isSafeInteger(remainingSubtotal) && remainingSubtotal >= 0,
      "visible discounts exceed the original product price"
    );
    const expectedAmount = calculateSingleInviteeReferralDiscount({
      currency: "CZK",
      exponent: 2,
      value: remainingSubtotal,
    });
    const referrerRow = snapshot.rows[referrerIndex];
    assert(referrerRow, "referrer discount row is missing");
    assert(
      referrerRow.adjustment ===
        formatDiscountAdjustment(
          { kind: "fixed", amount: expectedAmount },
          locale
        ),
      "referrer discount is not the expected fixed amount"
    );
    assert(
      referrerRow.amount ===
        formatWorkspaceMoney(
          { ...expectedAmount, value: -expectedAmount.value },
          locale
        ),
      "referrer deduction does not match its fixed amount"
    );
  });
});

const parseDisplayedCzkAmount = (
  text: string,
  locale: CheckoutData["locale"]
) => {
  const formatter = new Intl.NumberFormat(locale, {
    currency: "CZK",
    maximumFractionDigits: 2,
    style: "currency",
  });
  const parts = formatter.formatToParts(-1_234.56);
  const group = parts.find(({ type }) => type === "group")?.value;
  const decimal = parts.find(({ type }) => type === "decimal")?.value ?? ".";
  const currency = parts.find(({ type }) => type === "currency")?.value;
  const minus = parts.find(({ type }) => type === "minusSign")?.value;
  assert(group && currency && minus, "currency format is incomplete");
  const normalized = text
    .replaceAll(currency, "")
    .replaceAll(group, "")
    .replaceAll(minus, "")
    .replaceAll(/[\s\u00a0\u202f]/g, "")
    .replaceAll(decimal, ".")
    .replaceAll(/[^\d.]/g, "");
  const amount = Number(normalized);
  assert(Number.isFinite(amount), "discount amount is not numeric");
  return Math.round(Math.abs(amount) * 100);
};

export const isFreshOwnedPayStateUrl = (
  currentUrl: string,
  previousUrl: string,
  config: WorkspaceE2EConfig,
  locale: CheckoutData["locale"],
  orderId: WorkspaceReservationId
) => {
  try {
    const current = new URL(currentUrl);
    const previous = new URL(previousUrl);
    const currentPayStates = current.searchParams.getAll("payState");
    const previousPayStates = previous.searchParams.getAll("payState");
    const orderIds = current.searchParams.getAll("orderId");
    const previousOrderIds = previous.searchParams.getAll("orderId");
    return (
      current.origin === new URL(config.baseUrl).origin &&
      previous.origin === current.origin &&
      current.pathname === `/${locale}/checkout/pay` &&
      previous.pathname === current.pathname &&
      currentPayStates.length === 1 &&
      Boolean(currentPayStates[0]) &&
      previousPayStates.length === 1 &&
      Boolean(previousPayStates[0]) &&
      currentPayStates[0] !== previousPayStates[0] &&
      previousOrderIds.length === 1 &&
      previousOrderIds[0] === orderId &&
      orderIds.length === 1 &&
      orderIds[0] === orderId &&
      !current.searchParams.has("ref") &&
      !current.searchParams.has("submittedCode")
    );
  } catch {
    return false;
  }
};

const getReferralDiscountExpectations =
  (): readonly ExpectedDiscountApplication[] => [
    {
      adjustment: invitationAdjustment,
      label: m.checkoutSummaryItemReferralInvitationDiscount(
        {},
        { locale: "en-US" }
      ),
    },
  ];

const bindCheckoutContact = (
  data: CheckoutData,
  contact: WorkspaceE2EAccountReferralCheckoutContact
): CheckoutData => {
  const url = new URL(data.checkoutUrl);
  url.searchParams.set("email", contact.email);
  url.searchParams.set("name", contact.name);
  url.searchParams.set("phone", contact.phone);
  return {
    ...data,
    checkoutUrl: url.toString(),
    email: contact.email,
    name: contact.name,
    phone: contact.phone,
  };
};

const captureReviewStep = ({
  captureReview,
  expectedPayUrl,
  orderId,
  target,
  runStep,
}: {
  readonly captureReview: WorkspaceE2EAccountReferralCheckoutCapture;
  readonly expectedPayUrl: string;
  readonly orderId: WorkspaceReservationId;
  readonly target: WorkspaceE2EReferralCheckoutReviewTarget;
  readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
}) =>
  runStep({
    execute: Effect.tryPromise({
      catch: () =>
        workspaceE2EError("referral checkout review capture failed", {
          operation: "capture account referral checkout review",
        }),
      try: () => captureReview({ expectedPayUrl, orderId, target }),
    }),
    id: `capture-${target.replaceAll("account-referral-", "")}`,
    timeoutMs: 30_000,
  });
