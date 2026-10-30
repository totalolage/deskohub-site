import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { renderWorkspaceEmailDetailsText } from "@/emails/workspace-email-detail";
import { createWorkspaceMeetingRoomEmailDetailRows } from "@/features/checkout/backend/fulfillment/workspace-meeting-room-email-details";
import { isMeetingRoomWholeDayReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateRange,
  formatReservationDisplayTimeRange,
} from "@/features/reservation/reservation-date";
import { isSingleDayReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { formatMoney } from "@/shared/money/money";
import {
  activateElement,
  activateHydratedElement,
  assertPageCheck,
  closeBrowserTab,
  normalizeBrowserText,
  openBrowserPage,
  openPage,
  readBrowserNetworkLog,
  switchToBrowserTab,
  waitForBrowserUrl,
  waitForPageCondition,
  waitForPageText,
  waitForPageUrl,
  waitForReactHandler,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStep, WorkspaceE2EStepRunner } from "../case-runner";
import {
  formatNexiBuildFailureCodes,
  parseNexiBuildFailures,
} from "../checkout/nexi-build-api";
import {
  completeNexiHostedPayment,
  type HostedPaymentPage,
  type NexiChallengeOutcome,
} from "../checkout/nexi-hosted-payment";
import {
  classifyNexiSandboxRejection,
  decideNexiSandboxRetry,
  type NexiSandboxRejection,
  nexiSandboxRetryDelayMs,
} from "../checkout/nexi-sandbox-retry";
import {
  submitPaymentAndWaitForHostedPage,
  submitReservationForPayPage,
} from "../checkout/payment";
import {
  findRepeatReservationProblem,
  toRepeatReservation,
} from "../checkout/repeat-reservation";
import { matchesExpectedReservationDetails } from "../checkout/reservation-details";
import { reservationStatusIsolationStep } from "../checkout/reservation-status-isolation";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { WorkspaceE2EHostedPaymentPermitService } from "../coordination/hosted-payment-permit.service";
import type { WorkspaceE2EProviderVerificationPermitService } from "../coordination/provider-verification-permit.service";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import {
  type ExpectedDiscountApplication,
  markFulfillmentFailedForE2E,
  markPreviewFulfillmentDeliveredForE2E,
  replayNexiWebhook,
  requireProviderSessionRowAfterRedirect,
  retireRejectedPaymentAttemptForE2E,
  validateDiscountApplications,
  validatePostgres,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import {
  type ValidatedDotyposReservation,
  validateDotypos,
} from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { assert, browserSessionFor, log, parseUrl } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlow,
  CheckoutFlowState,
  CheckoutRow,
} from "../types";
import { isExpectedCheckoutStatusUrl, makeUrl, setSearchParams } from "../urls";

export const executeCheckoutFlow = ({
  config,
  data,
  datasourceConfig,
  flow,
  run,
  runStep,
  session,
  state,
  payPageSteps,
  beforeReservationSubmit,
  expectedDiscounts,
  afterFulfillment,
  verifyPostFulfillmentPaths = false,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  flow: CheckoutFlowStart;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
  state: CheckoutFlowState;
  payPageSteps?: (
    orderId: CheckoutRow["reservation_id"]
  ) => readonly WorkspaceE2EStep<void>[];
  beforeReservationSubmit?: Effect.Effect<void, WorkspaceE2EError>;
  expectedDiscounts?: readonly ExpectedDiscountApplication[];
  // Checks on the fulfilled reservation beyond the status page, before any
  // post-fulfillment path changes it.
  afterFulfillment?: (
    orderId: CheckoutRow["reservation_id"]
  ) => Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
  // The reserve-again restart, the fulfillment-failed support path, and the
  // reservation status isolation that starts from that support path do not
  // depend on the product, so one paid case opts in instead of every case.
  // The support path marks fulfillment failed, so it runs after every other
  // assertion on the fulfilled reservation.
  verifyPostFulfillmentPaths?: boolean;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  | E2EDatabase
  | HttpClient.HttpClient
  | WorkspaceE2EHostedPaymentPermitService
  | WorkspaceE2EProviderVerificationPermitService
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    state.startedAt = new Date();
    const orderId =
      "startReservation" in flow
        ? yield* flow.startReservation
        : yield* runStep({
            execute: Effect.gen(function* () {
              const browser = yield* browserSessionFor(run, session);
              yield* openPage(browser, config, data.checkoutUrl, {
                timeoutMs: config.timeouts.browserNavigation,
              });
              if (beforeReservationSubmit) yield* beforeReservationSubmit;
              return yield* submitReservationForPayPage({
                onOrderId: (startedOrderId) => {
                  state.orderId = startedOrderId;
                },
                session: browser,
                preparation: flow.toReservationPreparation(data),
                timeouts: config.timeouts,
              });
            }),
            id: "prepare-checkout-pay-page",
            timeoutMs: config.timeouts.checkoutStart,
          });
    if (payPageSteps) {
      for (const step of payPageSteps(orderId)) yield* runStep(step);
    }
    const providerSessionRow = yield* completeHostedCheckoutPayment({
      config,
      data,
      orderId,
      run,
      runStep,
      session,
      state,
    });
    state.orderId = orderId;

    // Nexi verification happens inside the deployed webhook handler. The runner
    // validates the resulting payment/webhook state without holding Nexi secrets.
    yield* runStep({
      permit: "provider-verification",
      execute: replayNexiWebhook(config, providerSessionRow).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient)
      ),
      id: "replay-payment-webhook",
      timeoutMs: config.timeouts.providerTransition,
    });
    yield* runStep({
      execute: markPreviewFulfillmentDeliveredForE2E(datasourceConfig, orderId),
      id: "complete-test-fulfillment",
      timeoutMs: config.timeouts.datasource,
    });
    const checkoutRow = yield* runStep({
      execute: validatePostgres(datasourceConfig, data, orderId, (row) => {
        state.checkoutRow = row;
      }),
      id: "validate-postgres-state",
      timeoutMs: config.timeouts.datasource,
    });
    state.checkoutRow = checkoutRow;
    if (expectedDiscounts) {
      yield* runStep({
        execute: validateDiscountApplications(
          datasourceConfig,
          orderId,
          expectedDiscounts
        ),
        id: "validate-discount-applications",
        timeoutMs: config.timeouts.datasource,
      });
    }
    const dotyposReservation = yield* runStep({
      execute: validateDotypos(datasourceConfig, data, checkoutRow),
      id: "validate-dotypos-reservation",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: assertFulfilledStatusPage({
        checkoutRow,
        config,
        data,
        dotyposReservation,
        orderId,
        run,
        session,
      }),
      id: "assert-fulfilled-status-page",
      timeoutMs: config.timeouts.uiTransition,
    });
    if (afterFulfillment) yield* afterFulfillment(orderId);
    if (verifyPostFulfillmentPaths) {
      yield* runStep({
        execute: restartReservationAfterFulfillment({
          config,
          data,
          run,
          session,
        }),
        id: "restart-reservation-after-fulfillment",
        timeoutMs: config.timeouts.uiTransition,
      });
    }
    if (
      data.meetingRoom &&
      isMeetingRoomWholeDayReservationDuration(data.meetingRoom.duration)
    ) {
      yield* runStep({
        execute: assertWholeDayMeetingRoomEmailPreviews({
          checkoutRow,
          data,
          dotyposReservation,
        }),
        id: "assert-whole-day-reservation-email-previews",
        timeoutMs: config.timeouts.datasource,
      });
    }
    if (verifyPostFulfillmentPaths) {
      yield* assertFulfillmentFailedSupportPath({
        config,
        data,
        orderId,
        run,
        runStep,
        session,
      });
      const customerId = yield* tryWorkspaceE2ESync(
        "read paid customer for reservation status isolation",
        () => {
          assert(
            checkoutRow.dotypos_customer_id,
            "paid customer id missing after checkout"
          );
          return checkoutRow.dotypos_customer_id;
        }
      );
      yield* runStep(
        reservationStatusIsolationStep({
          config,
          customerId,
          data,
          orderId,
          run,
          session,
        })
      );
    }

    log(`${flow.id} checkout e2e passed for order ${orderId}`);
  });

/**
 * How a checkout reaches its pay page: by submitting the flow's reservation
 * form, or through `startReservation`, which starts the reservation some
 * other way, captures its order for cleanup, and leaves the browser on the
 * pay page.
 */
export type CheckoutFlowStart =
  | Pick<CheckoutFlow, "id" | "toReservationPreparation">
  | {
      readonly id: CheckoutFlow["id"];
      readonly startReservation: Effect.Effect<
        CheckoutRow["reservation_id"],
        WorkspaceE2EError,
        E2EDatabase | HttpClient.HttpClient
      >;
    };

export type HostedCheckoutPaymentOptions = {
  // Defaults to an authenticated payment.
  readonly challengeOutcome?: NexiChallengeOutcome;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly orderId: CheckoutRow["reservation_id"];
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
};

type HostedPaymentAttempt =
  | { readonly kind: "completed"; readonly row: CheckoutRow }
  | {
      readonly authorizationRequested: boolean;
      readonly error: WorkspaceE2EError;
      readonly hostedPaymentPage: HostedPaymentPage;
      readonly kind: "sandbox-rejected";
      readonly rejection: NexiSandboxRejection;
      readonly row: CheckoutRow;
    };

// Pays on the Nexi hosted page. The shared Nexi sandbox sometimes rejects a
// payment on its own side; when that happened before Nexi could authorize
// anything, the payment restarts once through a fresh payment attempt. The
// hosted-payment permit covers both attempts and ends at the status page.
export const completeHostedCheckoutPayment = (
  options: HostedCheckoutPaymentOptions
): Effect.Effect<
  CheckoutRow,
  WorkspaceE2EError,
  E2EDatabase | WorkspaceE2EHostedPaymentPermitService
> =>
  Effect.gen(function* () {
    const hostedPaymentPermit = yield* WorkspaceE2EHostedPaymentPermitService;
    return yield* hostedPaymentPermit.withPermit(
      options.session,
      Effect.gen(function* () {
        const first = yield* runHostedPaymentAttempt(options);
        if (first.kind === "completed") return first.row;

        const restarted = yield* options.runStep({
          execute: restartSandboxRejectedPayment(options, first),
          id: "restart-sandbox-rejected-payment",
          timeoutMs:
            options.config.timeouts.datasource +
            nexiSandboxRetryDelayMs +
            options.config.timeouts.browserNavigation,
        });
        if (!restarted) return yield* first.error;

        // The restarted attempt never restarts again, so it completes or fails.
        const retry = yield* runHostedPaymentAttempt(options, first.row);
        if (retry.kind === "sandbox-rejected") return yield* retry.error;
        return retry.row;
      })
    );
  });

const runHostedPaymentAttempt = (
  {
    challengeOutcome,
    config,
    data,
    orderId,
    run,
    runStep,
    session,
    state,
  }: HostedCheckoutPaymentOptions,
  // The first attempt's row when this attempt restarts a rejected payment.
  rejectedRow?: CheckoutRow
): Effect.Effect<HostedPaymentAttempt, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const stepId = (id: string) => (rejectedRow ? `${id}-retry` : id);
    const hostedPaymentPage = yield* runStep({
      execute: submitPaymentAndWaitForHostedPage({
        run,
        session,
        timeouts: config.timeouts,
      }),
      id: stepId("start-checkout-payment"),
      timeoutMs: config.timeouts.providerTransition,
    });
    const row = yield* runStep({
      execute: requireProviderSessionRowAfterRedirect(orderId, {
        onRow: (value) => {
          state.checkoutRow = value;
        },
        timeoutMs: config.timeouts.browserAction,
      }).pipe(
        Effect.tap((value) =>
          rejectedRow
            ? tryWorkspaceE2ESync("assert fresh payment attempt", () =>
                assertFreshPaymentAttempt(rejectedRow, value)
              )
            : Effect.void
        )
      ),
      id: stepId("read-provider-session-row"),
      timeoutMs: config.timeouts.datasource,
    });

    let authorizationRequested = false;
    const rejected = yield* runStep({
      execute: completeNexiHostedPayment({
        ...(challengeOutcome ? { challengeOutcome } : {}),
        data,
        hostedPaymentPage,
        onPaymentAuthorizationRequested: () => {
          authorizationRequested = true;
        },
        run,
        session,
        timeouts: config.timeouts,
      }),
      id: stepId("complete-hosted-payment"),
      timeoutMs: config.timeouts.hostedPayment,
    }).pipe(
      Effect.as(undefined),
      Effect.catch((error) => {
        const rejection = classifyNexiSandboxRejection(error);
        return !rejectedRow && rejection && hostedPaymentPage
          ? Effect.succeed({
              authorizationRequested,
              error,
              hostedPaymentPage,
              kind: "sandbox-rejected" as const,
              rejection,
              row,
            })
          : Effect.fail(error);
      })
    );
    if (rejected) return rejected;

    yield* runStep({
      execute: waitForCheckoutStatusPage(config, run, session),
      id: stepId("reach-checkout-status-page"),
      timeoutMs: config.timeouts.providerTransition,
    });
    return { kind: "completed", row };
  });

export const assertFreshPaymentAttempt = (
  rejectedRow: Pick<CheckoutRow, "payment_attempt_id" | "provider_order_id">,
  row: Pick<CheckoutRow, "payment_attempt_id" | "provider_order_id">
) => {
  assert(
    row.payment_attempt_id !== rejectedRow.payment_attempt_id,
    "restarted payment reused the rejected payment attempt"
  );
  assert(
    row.provider_order_id !== rejectedRow.provider_order_id,
    "restarted payment reused the rejected Nexi order"
  );
};

// Decides whether the rejected payment may restart. If so, retires the rejected attempt, leaves the hosted page, and
// reopens the checkout pay page, which starts a fresh attempt and Nexi order.
const restartSandboxRejectedPayment = (
  { config, orderId, run, session, state }: HostedCheckoutPaymentOptions,
  rejected: Extract<HostedPaymentAttempt, { kind: "sandbox-rejected" }>
): Effect.Effect<boolean, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const networkLog = yield* readBrowserNetworkLog(run, session);
    const decision = decideNexiSandboxRetry({
      authorizationRequested: rejected.authorizationRequested,
      error: rejected.error,
    });
    const nexiCodes = formatNexiBuildFailureCodes(
      parseNexiBuildFailures(networkLog)
    );
    if (!decision.retry) {
      log(
        `Nexi sandbox rejection ${rejected.rejection.diagnosticCode} is not restarted: ${decision.reason} (Nexi codes: ${nexiCodes})`
      );
      return false;
    }
    const paymentAttemptId = rejected.row.payment_attempt_id;
    if (!paymentAttemptId) return false;

    log(
      `Nexi sandbox rejected the hosted payment (${rejected.rejection.diagnosticCode}; Nexi codes: ${nexiCodes}); restarting once with a fresh payment attempt`
    );
    state.checkoutRow = yield* retireRejectedPaymentAttemptForE2E(
      orderId,
      paymentAttemptId
    );

    const { checkoutPageUrl, checkoutTabId, hostedPaymentTabId } =
      rejected.hostedPaymentPage;
    if (hostedPaymentTabId !== checkoutTabId) {
      yield* closeBrowserTab(run, session, hostedPaymentTabId);
      yield* switchToBrowserTab(run, session, checkoutTabId);
    }
    // Give the shared sandbox a moment before the next card-data submission.
    yield* Effect.sleep(`${nexiSandboxRetryDelayMs} millis`);
    yield* openBrowserPage(config, run, session, checkoutPageUrl, {
      timeoutMs: config.timeouts.browserNavigation,
    });
    return true;
  });

const waitForCheckoutStatusPage = (
  config: WorkspaceE2EConfig,
  run: Runner,
  session: string
) =>
  waitForBrowserUrl({
    description: "checkout status page",
    matches: (url) => isExpectedCheckoutStatusUrl(url, config.expectedHost),
    run,
    session,
    timeoutMs: config.timeouts.providerTransition,
  }).pipe(Effect.asVoid);

const restartReservationAfterFulfillment = ({
  config,
  data,
  run,
  session,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  run: Runner;
  session: string;
}) =>
  Effect.gen(function* () {
    const reservationPath = yield* tryWorkspaceE2ESync(
      "read fresh reservation path",
      () => {
        const url = parseUrl(data.checkoutUrl);
        if (!url) throw new Error("checkout URL is invalid");
        return url.pathname;
      }
    );

    const browser = yield* browserSessionFor(run, session);
    yield* activateElement(browser, "#checkout-status-reserve-again", {
      timeoutMs: config.timeouts.browserAction,
    });
    yield* waitForReactHandler(browser, "form", "onSubmit", {
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* waitForPageCondition(
      browser,
      "fresh reservation form remains active",
      isFreshReservationFormSettled,
      { reservationPath },
      { timeoutMs: config.timeouts.uiTransition }
    );
    yield* assertPageCheck(
      browser,
      "assert repeat reservation defaults",
      findRepeatReservationProblem,
      toRepeatReservation(data),
      { timeoutMs: config.timeouts.browserAction }
    );
  });

/**
 * Runs in the browser: whether the page has stayed on the fresh reservation
 * form at `reservationPath` for a second. It records when it first saw the
 * form on the document element and forgets it once the page leaves.
 */
export const isFreshReservationFormSettled = ({
  reservationPath,
}: {
  readonly reservationPath: string;
}) => {
  const root = document.documentElement;
  if (location.pathname !== reservationPath) {
    delete root.dataset.checkoutRestartReadyAt;
    return false;
  }
  const readyAt = Number(root.dataset.checkoutRestartReadyAt);
  if (!Number.isFinite(readyAt) || readyAt <= 0) {
    root.dataset.checkoutRestartReadyAt = String(Date.now());
    return false;
  }
  return Date.now() - readyAt >= 1000;
};

export const assertFulfilledStatusPage = ({
  checkoutRow,
  config,
  data,
  dotyposReservation,
  orderId,
  run,
  session,
}: {
  checkoutRow: CheckoutRow;
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  dotyposReservation: ValidatedDotyposReservation;
  orderId: CheckoutRow["reservation_id"];
  run: Runner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const expectedPaymentPrice = yield* tryWorkspaceE2ESync(
      "read checkout payment amount for status assertion",
      () => {
        if (
          checkoutRow.amount_value === null ||
          checkoutRow.amount_exponent === null ||
          checkoutRow.currency === null
        ) {
          throw new Error("checkout payment amount is incomplete");
        }

        return formatMoney(
          {
            value: checkoutRow.amount_value,
            exponent: checkoutRow.amount_exponent,
            currency: checkoutRow.currency,
          },
          data.locale
        );
      }
    );
    // The payment return already left this browser on the ordinary production
    // status route. Keep that page alive so its real auto-refresh observes the
    // fulfillment transition instead of starting another streamed RSC request
    // for every paid case.
    const browser = yield* browserSessionFor(run, session);
    yield* waitForPageUrl({
      description: "fulfilled checkout status page",
      matches: (url) => {
        const parsed = parseUrl(url);
        return Boolean(
          parsed &&
            isExpectedCheckoutStatusUrl(url, config.expectedHost) &&
            parsed.pathname.endsWith(`/reservation/status/${orderId}`)
        );
      },
      session: browser,
      timeoutMs: config.timeouts.uiTransition,
    });
    const expectedReservationText = yield* tryWorkspaceE2ESync(
      "read confirmed reservation interval for status assertion",
      () => {
        if (data.office) {
          return [
            "Private office",
            formatReservationDisplayDateRange(
              dotyposReservation.reservedFrom,
              dotyposReservation.reservedUntil,
              data.locale
            ),
            "Seats",
            String(data.office.seats),
            expectedPaymentPrice,
          ];
        }
        if (!data.meetingRoom) return [];

        const interval = {
          startsAt: dotyposReservation.reservedFrom,
          endsAt: dotyposReservation.reservedUntil,
        };

        return [
          formatReservationDisplayDate(interval.startsAt, data.locale),
          isSingleDayReservationInterval(interval)
            ? "whole day"
            : formatReservationDisplayTimeRange(
                interval.startsAt,
                interval.endsAt,
                data.locale
              ),
          expectedPaymentPrice,
        ];
      }
    );
    yield* waitForPageText({
      description: "fulfilled checkout status copy",
      matches: (text) => {
        const normalizedText = normalizeBrowserText(text).toLocaleLowerCase(
          data.locale
        );

        return (
          /Your reservation is confirmed\./i.test(normalizedText) &&
          /emailed you the secure access link/i.test(normalizedText) &&
          expectedReservationText.every((expected) =>
            normalizedText.includes(
              normalizeBrowserText(expected).toLocaleLowerCase(data.locale)
            )
          )
        );
      },
      session: browser,
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* assertPageCheck(
      browser,
      "assert fulfilled checkout status page",
      findFulfilledStatusPageProblem,
      undefined,
      { timeoutMs: config.timeouts.browserAction }
    );
    log("Checkout status page validated");
  });

/**
 * Runs in the browser: why the page is not the canonical fulfilled checkout
 * status page, or `null` when it is. It must not close over anything.
 */
export const findFulfilledStatusPageProblem = (): string | null => {
  if (document.querySelector("[data-reservation-access]")) {
    return "reservation access rendered on checkout status page";
  }
  // Only account-origin navigation may intercept the status route. A checkout
  // status rendered in a dialog means the reservation modal slot leaked.
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    if (/Your reservation is confirmed\./i.test(dialog.textContent ?? "")) {
      return "checkout status rendered in a reservation dialog";
    }
  }
  const text = document.body?.textContent ?? "";
  return /Your reservation is confirmed\./i.test(text) &&
    /emailed you the secure access link/i.test(text)
    ? null
    : "fulfilled checkout status copy not visible";
};

type WholeDayEmailCheckoutRow = Pick<
  CheckoutRow,
  "dotypos_customer_id" | "dotypos_reservation_id" | "reservation_details"
>;

export const assertWholeDayMeetingRoomEmailPreviews = ({
  checkoutRow,
  data,
  dotyposReservation,
}: {
  checkoutRow: WholeDayEmailCheckoutRow;
  data: Pick<CheckoutData, "expectedReservationDetails" | "meetingRoom">;
  dotyposReservation: ValidatedDotyposReservation;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const reservation = yield* tryWorkspaceE2ESync(
      "build whole-day reservation email preview",
      () => {
        assert(
          data.meetingRoom &&
            isMeetingRoomWholeDayReservationDuration(data.meetingRoom.duration),
          "whole-day meeting-room checkout data missing"
        );
        assert(
          isSingleDayReservationInterval({
            startsAt: dotyposReservation.reservedFrom,
            endsAt: dotyposReservation.reservedUntil,
          }),
          "confirmed Dotypos reservation is not one Prague calendar day"
        );
        assert(
          checkoutRow.dotypos_customer_id,
          "Dotypos customer id missing from checkout row"
        );
        assert(
          checkoutRow.dotypos_reservation_id,
          "Dotypos reservation id missing from checkout row"
        );

        assert(
          matchesExpectedReservationDetails(
            checkoutRow.reservation_details,
            data.expectedReservationDetails
          ),
          "meeting-room checkout row does not record the booked offer"
        );

        return {
          reservedFrom: dotyposReservation.reservedFrom,
          reservedUntil: dotyposReservation.reservedUntil,
        };
      }
    );
    const customerRows = createWorkspaceMeetingRoomEmailDetailRows(
      reservation,
      "en-US",
      {
        reservationLabel: "Reservation",
        reservationTitle: "Meeting Room",
        dateLabel: "Reservation date",
        timeLabel: "Reservation time",
        setupLabel: "Setup from",
        wholeDay: "whole day",
      }
    );
    const internalRows = createWorkspaceMeetingRoomEmailDetailRows(
      reservation,
      "cs-CZ",
      {
        reservationLabel: "Rezervace",
        reservationTitle: "Zasedací místnost",
        dateLabel: "Datum rezervace",
        timeLabel: "Čas rezervace",
        setupLabel: "Příprava od",
        wholeDay: "celý den",
      }
    );
    const customerText =
      renderWorkspaceEmailDetailsText(customerRows).join("\n");
    const internalText =
      renderWorkspaceEmailDetailsText(internalRows).join("\n");

    yield* tryWorkspaceE2ESync(
      "assert whole-day reservation email previews",
      () => {
        const customerDate = formatReservationDisplayDate(
          reservation.reservedFrom,
          "en-US"
        );
        const internalDate = formatReservationDisplayDate(
          reservation.reservedFrom,
          "cs-CZ"
        );
        const customerTimeRange = formatReservationDisplayTimeRange(
          reservation.reservedFrom,
          reservation.reservedUntil,
          "en-US"
        );
        const internalTimeRange = formatReservationDisplayTimeRange(
          reservation.reservedFrom,
          reservation.reservedUntil,
          "cs-CZ"
        );

        assert(
          customerRows[1]?.value === customerDate &&
            customerRows[2]?.value === "whole day",
          "customer email detail rows do not match the confirmed calendar day"
        );
        assert(
          internalRows[1]?.value === internalDate &&
            internalRows[2]?.value === "celý den",
          "internal email detail rows do not match the confirmed calendar day"
        );
        assert(
          customerText.includes(customerDate) &&
            customerText.includes("whole day"),
          "customer email does not present the confirmed calendar day"
        );
        assert(
          internalText.includes(internalDate) &&
            internalText.includes("celý den"),
          "internal email does not present the confirmed calendar day"
        );
        assert(
          !customerText.includes(customerTimeRange),
          "customer email exposes the whole-day midnight time range"
        );
        assert(
          !internalText.includes(internalTimeRange),
          "internal email exposes the whole-day midnight time range"
        );
      }
    );
    log("Whole-day reservation email previews validated");
  });

const assertFulfillmentFailedSupportPath = ({
  config,
  data,
  orderId,
  run,
  runStep,
  session,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  orderId: CheckoutRow["reservation_id"];
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    // Each step reaches the browser itself, so a browser that fails to open
    // stays attributed to the step that needed it.
    const inBrowser = <A>(
      drive: (browser: E2EBrowserSession) => Effect.Effect<A, WorkspaceE2EError>
    ) => Effect.flatMap(browserSessionFor(run, session), drive);
    yield* runStep({
      execute: markFulfillmentFailedForE2E(orderId),
      id: "mark-fulfillment-failed-for-support-path",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        const statusUrl = yield* makeUrl(
          "build fulfillment failed checkout status URL",
          `${config.baseUrl}/${data.locale}/reservation/status/${orderId}`
        );
        yield* setSearchParams(statusUrl, {
          e2eAt: String(Date.now()),
        });
        yield* inBrowser((browser) =>
          openPage(browser, config, statusUrl.toString(), {
            timeoutMs: config.timeouts.browserNavigation,
          })
        );
      }),
      id: "open-fulfillment-failed-status-page",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: inBrowser((browser) =>
        waitForPageText({
          description: "fulfillment failed support link",
          matches: (text) =>
            /couldn't deliver your confirmation/i.test(text) &&
            /Send support request/i.test(text),
          session: browser,
          timeoutMs: config.timeouts.uiTransition,
        })
      ),
      id: "wait-for-fulfillment-support-link",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: inBrowser((browser) =>
        assertPageCheck(
          browser,
          "assert fulfillment failed support link",
          findFulfillmentSupportLinkProblem,
          { locale: data.locale, orderId },
          { timeoutMs: config.timeouts.browserAction }
        )
      ),
      id: "assert-fulfillment-support-link",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: inBrowser((browser) =>
        activateHydratedElement(browser, "#checkout-status-support-contact", {
          timeoutMs: config.timeouts.browserAction,
        })
      ),
      id: "activate-fulfillment-support-link",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: inBrowser((browser) =>
        waitForPageUrl({
          description: "fulfillment failed support contact page",
          matches: (url) => {
            const parsed = parseUrl(url);
            return (
              parsed?.pathname === `/${data.locale}/contact` &&
              (parsed.searchParams.get("message") ?? "").includes(orderId)
            );
          },
          session: browser,
          timeoutMs: config.timeouts.uiTransition,
        })
      ),
      id: "reach-fulfillment-support-contact-page",
      timeoutMs: config.timeouts.uiTransition,
    });
    log("Fulfillment failed support path e2e passed");
  });

/**
 * Runs in the browser: why the fulfillment-failed status page does not offer
 * a support request for `orderId` on the locale's contact page, or `null`
 * when it does. It must not close over anything.
 */
export const findFulfillmentSupportLinkProblem = ({
  locale,
  orderId,
}: {
  readonly locale: string;
  readonly orderId: string;
}): string | null => {
  const text = document.body?.textContent ?? "";
  if (!/couldn't deliver your confirmation/i.test(text)) {
    return "fulfillment failed status copy not visible";
  }
  const link = [...document.querySelectorAll("a")].find((candidate) =>
    /Send support request/i.test(candidate.textContent ?? "")
  );
  if (!(link instanceof HTMLAnchorElement)) {
    return "support contact link not found";
  }
  const url = new URL(link.href);
  if (url.pathname !== `/${locale}/contact`) {
    return "support contact link points at unexpected path";
  }
  if (!(url.searchParams.get("message") ?? "").includes(orderId)) {
    return "support contact message missing order id";
  }
  return null;
};
