import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import { m } from "@/features/i18n";
import { formatReferralInvitationDiscount } from "@/features/referrals/client";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationCustomerQueryParam } from "@/features/reservation/reservation-checkout-query";
import { formatMoney, type Money } from "@/shared/money/money";
import { openPage, readPageUrl } from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import {
  applyDiscountCode,
  submitDiscountCode,
} from "../checkout/discount-code";
import { submitReservationForPayPage } from "../checkout/payment";
import { toReservationStep } from "../checkout/reservation-form-preparation";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import {
  type ExpectedDiscountApplication,
  waitForCheckoutRow,
} from "../integrations/database";
import { pollUntil } from "../polling";
import { addRedaction, assert, parseUrl } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import type { WorkspaceE2EReferralCheckoutReviewTarget } from "./checkout-review";

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
  remainingSubtotal: Money
): Money => ({
  ...remainingSubtotal,
  value: Number((BigInt(remainingSubtotal.value) + 10n) / 20n),
});

export type WorkspaceE2EReferralCheckoutContact = {
  readonly customerId: DotyposCustomerId;
  readonly email: string;
  readonly name: string;
  readonly phone: string;
};

export type WorkspaceE2EReferralCheckoutCapture = (input: {
  readonly expectedPayUrl: string;
  readonly orderId: WorkspaceReservationId;
  readonly target: WorkspaceE2EReferralCheckoutReviewTarget;
}) => Effect.Effect<void, WorkspaceE2EError>;

/** The voucher fixture redeemed after a share-link referral. */
export const referralVoucherAdjustment = {
  kind: "fixed",
  amount: accountReferralVoucherAmount,
} as const;

export const referralAppliedMessage = (locale: CheckoutData["locale"]) =>
  m.checkoutReferralDiscountApplied(
    { discount: formatReferralInvitationDiscount(locale) },
    { locale }
  );

export const ordinaryCodeAppliedMessage = (
  adjustment: Parameters<typeof formatDiscountAdjustment>[0],
  locale: CheckoutData["locale"]
) =>
  m.checkoutDiscountCodeApplied(
    { discount: formatDiscountAdjustment(adjustment, locale) },
    { locale }
  );

export const startPayPage = ({
  browserSession,
  config,
  contact,
  data,
  datasourceConfig,
  referralCode,
  runStep,
  state,
  stepPrefix,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly contact: WorkspaceE2EReferralCheckoutContact;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  /** Starts the reservation from a share link carrying this code. */
  readonly referralCode?: string;
  readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
  readonly state: CheckoutFlowState;
  readonly stepPrefix: string;
  /** The browser session obtained inside the case step. */
  readonly browserSession: E2EBrowserSession;
}) =>
  runStep({
    execute: Effect.gen(function* () {
      state.startedAt = new Date();
      const checkoutUrl = new URL(data.checkoutUrl);
      if (referralCode !== undefined) {
        addRedaction(referralCode, true);
        checkoutUrl.searchParams.set("ref", referralCode);
      }
      yield* openPage(browserSession, config, checkoutUrl.toString(), {
        timeoutMs: config.timeouts.browserNavigation,
      });
      const orderId = yield* submitReservationForPayPage({
        onOrderId: (value) => {
          state.orderId = value;
        },
        session: browserSession,
        preparation: toReservationStep(data),
        timeouts: config.timeouts,
      });
      state.orderId = orderId;
      const payUrl = yield* readPageUrl(browserSession);
      if (!payUrl) {
        return yield* workspaceE2EError(
          "checkout did not reach its signed pay page",
          { operation: "read account referral checkout pay page" }
        );
      }
      yield* Effect.sync(() =>
        addRedaction(
          parseUrl(payUrl)?.searchParams.get("payState") ?? undefined
        )
      );
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

export const applyCodeAndReadFreshPayUrl = ({
  appliedMessage,
  browserSession,
  code,
  config,
  currentPayUrl,
  locale,
  orderId,
  runStep,
  stepId,
}: {
  readonly appliedMessage: string;
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly currentPayUrl: string;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
  readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
  readonly stepId: string;
  /** The browser session obtained inside the case step. */
  readonly browserSession: E2EBrowserSession;
}) =>
  runStep({
    execute: Effect.gen(function* () {
      yield* applyDiscountCode({
        appliedMessage,
        code,
        config,
        session: browserSession,
      });
      return yield* waitForFreshPayStateUrl({
        config,
        locale,
        orderId,
        previousUrl: currentPayUrl,
        session: browserSession,
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
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
  readonly previousUrl: string;
  readonly session: E2EBrowserSession;
}) =>
  pollUntil(
    readPageUrl(session).pipe(
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

export const rejectReferralCode = ({
  browserSession,
  code,
  config,
  currentPayUrl,
  error,
  locale,
  message,
  orderId,
}: {
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly currentPayUrl: string;
  readonly error: string;
  readonly locale: CheckoutData["locale"];
  readonly message: string;
  readonly orderId: WorkspaceReservationId;
  /** The browser session obtained inside the case step. */
  readonly browserSession: E2EBrowserSession;
}) =>
  Effect.gen(function* () {
    yield* submitDiscountCode({ code, config, session: browserSession });
    const rejectedUrl = yield* pollUntil(
      readPageUrl(browserSession).pipe(
        Effect.map((url) =>
          url &&
          isRejectedReferralCodeUrl({
            baseUrl: config.baseUrl,
            currentUrl: url,
            error,
            locale,
            orderId,
            previousUrl: currentPayUrl,
          })
            ? url
            : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.browser,
        label: "rejected referral code on a re-signed pay state",
        timeoutMs: config.timeouts.uiTransition,
      }
    );
    yield* browserSession.use(
      "wait for rejected referral code kept in the field with its alert",
      (page) =>
        page.waitForFunction(
          ({ expectedCode, expectedMessage }) => {
            const alert = document.querySelector(
              "#checkout-discount-code-error"
            );
            const input = document.querySelector("#checkout-discount-code");
            return (
              alert?.getAttribute("role") === "alert" &&
              alert.textContent?.includes(expectedMessage) === true &&
              input?.getAttribute("aria-invalid") === "true" &&
              input instanceof HTMLInputElement &&
              input.value.toUpperCase() === expectedCode
            );
          },
          { expectedCode: code.toUpperCase(), expectedMessage: message },
          { timeout: config.timeouts.uiTransition }
        )
    );
    return rejectedUrl;
  });

export const assertShareLinkReferralApplied = ({
  config,
  locale,
  orderId,
  payUrl,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
  readonly payUrl: string;
  readonly session: E2EBrowserSession;
}) =>
  Effect.gen(function* () {
    if (
      !isReferralAppliedPayUrl({
        baseUrl: config.baseUrl,
        currentUrl: payUrl,
        locale,
        orderId,
      })
    ) {
      return yield* workspaceE2EError(
        "share-link checkout did not reach a referral-applied pay page",
        { operation: "verify share-link referral pay page" }
      );
    }
    const message = referralAppliedMessage(locale);
    yield* session.use("wait for share-link referral applied notice", (page) =>
      page.waitForFunction(
        (expectedMessage) =>
          document
            .querySelector("[data-checkout-referral-applied]")
            ?.textContent?.includes(expectedMessage) === true,
        message,
        { timeout: config.timeouts.uiTransition }
      )
    );
  });

export const assertOrdinaryCodeSlotAvailable = ({
  config,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly session: E2EBrowserSession;
}) =>
  session
    .use("wait for ordinary code slot after referral acceptance", (page) =>
      page.waitForFunction(
        ({ maximumCount, observationKey }) => {
          const inputSelector = 'input[name="submittedCode"]';
          const forms = document.querySelectorAll(
            "#checkout-discount-code-form"
          );
          const form = document.querySelector("#checkout-discount-code-form");
          const input = form?.querySelector(inputSelector);
          const submit = form?.querySelector('button[type="submit"]');
          const inputIsPresent = input instanceof HTMLInputElement;
          const submitIsPresent = submit instanceof HTMLButtonElement;
          const formStyle = form ? window.getComputedStyle(form) : undefined;
          // Counts and flags only, so the span never carries a typed code.
          const observation = {
            formCount: Math.min(forms.length, maximumCount),
            namedFieldCount: Math.min(
              document.querySelectorAll(inputSelector).length,
              maximumCount
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
          Reflect.set(window, observationKey, observation);
          return (
            input instanceof HTMLInputElement &&
            !input.disabled &&
            input.value === "" &&
            submit instanceof HTMLButtonElement &&
            !submit.disabled
          );
        },
        {
          maximumCount: ordinaryCodeSlotObservationMaximumCount,
          observationKey: ordinaryCodeSlotObservationKey,
        },
        { timeout: config.timeouts.uiTransition }
      )
    )
    .pipe(
      Effect.asVoid,
      Effect.ensuring(annotateOrdinaryCodeSlotObservation(session))
    );

const annotateOrdinaryCodeSlotObservation = (session: E2EBrowserSession) =>
  Effect.exit(
    session
      .evaluate(
        "read bounded referral discount form observation",
        (observationKey) => {
          const observation: unknown = Reflect.get(window, observationKey);
          Reflect.deleteProperty(window, observationKey);
          return observation;
        },
        ordinaryCodeSlotObservationKey,
        { timeoutMs: workspaceE2EPollIntervalMs.browser }
      )
      .pipe(
        Effect.flatMap((value) => {
          const observation = parseOrdinaryCodeSlotObservation(value);
          return observation
            ? Effect.annotateCurrentSpan({
                "e2e.account.discount_form.form_count": observation.formCount,
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

export const assertReferralConfirmationCleared = ({
  config,
  locale,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly locale: CheckoutData["locale"];
  readonly session: E2EBrowserSession;
}) =>
  session
    .use(
      "wait for referral confirmation cleared after ordinary code application",
      (page) =>
        page.waitForFunction(
          (message) => !document.body?.innerText.includes(message),
          referralAppliedMessage(locale),
          { timeout: config.timeouts.uiTransition }
        )
    )
    .pipe(Effect.asVoid);

export const assertReferrerDiscountMatchesRemainingSubtotal = Effect.fn(
  "WorkspaceE2EReferralCheckout.assertReferrerDiscount"
)(function* ({
  locale,
  requireVoucherAfterReferrer = false,
  session,
}: {
  readonly locale: CheckoutData["locale"];
  readonly requireVoucherAfterReferrer?: boolean;
  readonly session: E2EBrowserSession;
}) {
  // Every caller's step deadline is shorter than the argv evaluation's own
  // two-minute bound, so the step alone bounds this read, as it did before.
  const snapshot = yield* session.evaluate(
    "read visible checkout discount amounts",
    () => {
      const trigger = document.querySelector(
        "[data-checkout-discount-details]"
      );
      const contentId = trigger?.getAttribute("aria-describedby");
      const content = contentId ? document.getElementById(contentId) : null;
      const originalPrice =
        document
          .querySelector('del[aria-hidden="true"]')
          ?.textContent?.trim() ?? null;
      const rows = [...(content?.querySelectorAll("li") ?? [])].map((row) => {
        const details = row.firstElementChild;
        return {
          label: details?.firstElementChild?.textContent?.trim() ?? "",
          adjustment: details?.children.item(1)?.textContent?.trim() ?? "",
          amount: row.lastElementChild?.textContent?.trim() ?? "",
        };
      });
      return { originalPrice, rows };
    },
    undefined
  );
  yield* tryWorkspaceE2ESync("assert visible fixed referral discount", () => {
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
        formatMoney(
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

const readSinglePayStateUrl = ({
  baseUrl,
  currentUrl,
  locale,
  orderId,
}: {
  readonly baseUrl: string;
  readonly currentUrl: string;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
}) => {
  const current = new URL(currentUrl);
  const payStates = current.searchParams.getAll("payState");
  const orderIds = current.searchParams.getAll("orderId");
  const payState = payStates.length === 1 ? payStates[0] : undefined;
  if (
    !payState ||
    current.origin !== new URL(baseUrl).origin ||
    current.pathname !== `/${locale}/checkout/pay` ||
    orderIds.length !== 1 ||
    orderIds[0] !== orderId ||
    current.searchParams.has("ref") ||
    current.searchParams.has("submittedCode")
  ) {
    return undefined;
  }
  return { payState, searchParams: current.searchParams };
};

/** The first pay page of a reservation started from a share link. */
export const isReferralAppliedPayUrl = (input: {
  readonly baseUrl: string;
  readonly currentUrl: string;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
}) => {
  try {
    const current = readSinglePayStateUrl(input);
    return (
      current !== undefined &&
      current.searchParams.getAll("referralApplied").join() === "1" &&
      !current.searchParams.has("discountCodeError")
    );
  } catch {
    return false;
  }
};

/**
 * A rejected code re-signs the pay state so the box keeps the code, and
 * reports one error.
 */
export const isRejectedReferralCodeUrl = ({
  error,
  previousUrl,
  ...input
}: {
  readonly baseUrl: string;
  readonly currentUrl: string;
  readonly error: string;
  readonly locale: CheckoutData["locale"];
  readonly orderId: WorkspaceReservationId;
  readonly previousUrl: string;
}) => {
  try {
    const current = readSinglePayStateUrl(input);
    const previous = readSinglePayStateUrl({
      ...input,
      currentUrl: previousUrl,
    });
    return (
      current !== undefined &&
      previous !== undefined &&
      current.payState !== previous.payState &&
      current.searchParams.getAll("discountCodeError").join() === error &&
      !current.searchParams.has("referralApplied")
    );
  } catch {
    return false;
  }
};

export const getReferralDiscountExpectations =
  (): readonly ExpectedDiscountApplication[] => [
    {
      adjustment: invitationAdjustment,
      label: m.checkoutSummaryItemReferralInvitationDiscount(
        {},
        { locale: "en-US" }
      ),
    },
  ];

/**
 * Binds a planned checkout to the signed-in customer's own booking. Contact
 * fields alone open a signed-in reservation page in "book for someone else"
 * mode, so the link also asks for the account card.
 */
export const bindCheckoutContact = (
  data: CheckoutData,
  contact: Pick<WorkspaceE2EReferralCheckoutContact, "email" | "name" | "phone">
): CheckoutData => {
  const url = new URL(data.checkoutUrl);
  url.searchParams.set(reservationCustomerQueryParam, "account");
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

export const captureReviewStep = ({
  captureReview,
  expectedPayUrl,
  orderId,
  target,
  runStep,
}: {
  readonly captureReview: WorkspaceE2EReferralCheckoutCapture;
  readonly expectedPayUrl: string;
  readonly orderId: WorkspaceReservationId;
  readonly target: WorkspaceE2EReferralCheckoutReviewTarget;
  readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
}) =>
  runStep({
    // Any failure, a Playwright timeout included, fails the capture plainly.
    execute: captureReview({ expectedPayUrl, orderId, target }).pipe(
      Effect.mapError(() =>
        workspaceE2EError("referral checkout review capture failed", {
          operation: "capture account referral checkout review",
        })
      )
    ),
    id: `capture-${target.replaceAll("account-referral-", "")}`,
    timeoutMs: 30_000,
  });
