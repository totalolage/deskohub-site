import { Effect, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { createWorkspaceMeetingRoomEmailDetailRows } from "@/features/checkout/backend/fulfillment/workspace-meeting-room-email-details";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { isMeetingRoomWholeDayReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import {
  formatReservationDisplayDate,
  formatReservationDisplayTimeRange,
} from "@/features/reservation/reservation-date";
import { isSingleDayReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { renderEmailRowsText } from "@/shared/backend/email/rendering";
import {
  activateHydratedBrowserElement,
  evalBrowserScript,
  openBrowserPage,
  waitForBrowserText,
  waitForBrowserUrl,
} from "../browser";
import {
  assertFulfilledStatusScript,
  getAssertFulfillmentFailedSupportScript,
} from "../browser-scripts";
import {
  completeNexiHostedPayment,
  submitPaymentAndWaitForHostedPage,
  submitReservationForPayPage,
} from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import {
  type ExpectedDiscountApplication,
  markFulfillmentFailedForE2E,
  markPreviewFulfillmentDeliveredForE2E,
  replayNexiWebhook,
  requireProviderSessionRowAfterRedirect,
  validateDiscountApplications,
  validatePostgres,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import {
  type ValidatedDotyposReservation,
  validateDotypos,
} from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { assert, log, parseUrl } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlow,
  CheckoutFlowState,
  CheckoutRow,
  WorkspaceE2EStep,
  WorkspaceE2EStepRunner,
} from "../types";
import { isExpectedCheckoutStatusUrl, makeUrl, setSearchParams } from "../urls";

const decodeStoredMeetingRoomReservationDetails = Schema.decodeUnknownSync(
  Schema.Struct({ kind: Schema.Literal("meeting-room") }),
  { onExcessProperty: "error" }
);

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
  expectedDiscounts,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  flow: Pick<CheckoutFlow, "id" | "submitReservationScript">;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
  state: CheckoutFlowState;
  payPageSteps?: (orderId: string) => readonly WorkspaceE2EStep<void>[];
  expectedDiscounts?: readonly ExpectedDiscountApplication[];
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    state.startedAt = new Date();
    const orderId = yield* runStep({
      capacity: "reservation-start",
      execute: Effect.gen(function* () {
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          run,
          session,
          submitReservationScript: flow.submitReservationScript(data),
          timeouts: config.timeouts,
        });
      }),
      id: "prepare-checkout-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    if (payPageSteps) {
      for (const step of payPageSteps(orderId)) yield* runStep(step);
    }
    yield* runStep({
      execute: submitPaymentAndWaitForHostedPage({
        run,
        session,
        timeouts: config.timeouts,
      }).pipe(Effect.asVoid),
      id: "start-checkout-payment",
      timeoutMs: config.timeouts.providerTransition,
    });
    const providerSessionRow = yield* runStep({
      execute: requireProviderSessionRowAfterRedirect(orderId, (row) => {
        state.checkoutRow = row;
      }),
      id: "read-provider-session-row",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: completeNexiHostedPayment({
        data,
        run,
        session,
        timeouts: config.timeouts,
      }),
      id: "complete-hosted-payment",
      timeoutMs: config.timeouts.hostedPayment,
    });
    yield* runStep({
      execute: waitForCheckoutStatusPage(config, run, session),
      id: "reach-checkout-status-page",
      timeoutMs: config.timeouts.providerTransition,
    });
    state.orderId = orderId;

    // Nexi verification happens inside the deployed webhook handler. The runner
    // validates the resulting payment/webhook state without holding Nexi secrets.
    yield* runStep({
      capacity: "provider-verification",
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
    yield* assertFulfillmentFailedSupportPath({
      config,
      data,
      orderId,
      run,
      runStep,
      session,
    });

    log(`${flow.id} checkout e2e passed for order ${orderId}`);
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
  orderId: string;
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

        return formatWorkspaceMoney(
          {
            value: checkoutRow.amount_value,
            exponent: checkoutRow.amount_exponent,
            currency: checkoutRow.currency,
          },
          data.locale
        );
      }
    );
    yield* openBrowserPage(
      config,
      run,
      session,
      `${config.baseUrl}/${data.locale}/reservation/status/${orderId}`,
      { timeoutMs: config.timeouts.browserNavigation }
    );
    const expectedMeetingRoomText = yield* tryWorkspaceE2ESync(
      "read confirmed reservation interval for status assertion",
      () =>
        data.meetingRoom
          ? (() => {
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
            })()
          : []
    );
    yield* waitForBrowserText({
      description: "fulfilled checkout status copy",
      matches: (text) =>
        /Your workspace access is ready\./i.test(text) &&
        /sent by email/i.test(text) &&
        expectedMeetingRoomText.every((expected) => text.includes(expected)),
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* evalBrowserScript(
      "assert fulfilled checkout status page",
      run,
      session,
      assertFulfilledStatusScript,
      {
        timeoutMs: config.timeouts.browserAction,
      }
    );
    log("Checkout status page validated");
  });

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
  data: Pick<CheckoutData, "meetingRoom">;
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

        decodeStoredMeetingRoomReservationDetails(
          checkoutRow.reservation_details
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
        wholeDay: "celý den",
      }
    );
    const customerText = renderEmailRowsText(customerRows).join("\n");
    const internalText = renderEmailRowsText(internalRows).join("\n");

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
          customerRows[1]?.[1] === customerDate &&
            customerRows[2]?.[1] === "whole day",
          "customer email detail rows do not match the confirmed calendar day"
        );
        assert(
          internalRows[1]?.[1] === internalDate &&
            internalRows[2]?.[1] === "celý den",
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
  orderId: string;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
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
        yield* openBrowserPage(config, run, session, statusUrl.toString(), {
          timeoutMs: config.timeouts.browserNavigation,
        });
      }),
      id: "open-fulfillment-failed-status-page",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: waitForBrowserText({
        description: "fulfillment failed support link",
        matches: (text) =>
          /couldn't deliver your access codes/i.test(text) &&
          /Send support request/i.test(text),
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
      }),
      id: "wait-for-fulfillment-support-link",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: evalBrowserScript(
        "assert fulfillment failed support link",
        run,
        session,
        getAssertFulfillmentFailedSupportScript(data, orderId),
        {
          logOutput: false,
          timeoutMs: config.timeouts.browserAction,
        }
      ),
      id: "assert-fulfillment-support-link",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: activateHydratedBrowserElement(
        run,
        session,
        "#checkout-status-support-contact",
        { timeoutMs: config.timeouts.browserAction }
      ),
      id: "activate-fulfillment-support-link",
      timeoutMs: config.timeouts.browserAction,
    });
    yield* runStep({
      execute: waitForBrowserUrl({
        description: "fulfillment failed support contact page",
        matches: (url) => {
          const parsed = parseUrl(url);
          return (
            parsed?.pathname === `/${data.locale}/contact` &&
            (parsed.searchParams.get("message") ?? "").includes(orderId)
          );
        },
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
      }),
      id: "reach-fulfillment-support-contact-page",
      timeoutMs: config.timeouts.uiTransition,
    });
    log("Fulfillment failed support path e2e passed");
  });
