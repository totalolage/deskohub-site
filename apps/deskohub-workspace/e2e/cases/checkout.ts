import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import {
  formatReservationDisplayDate,
  formatReservationDisplayTimeRange,
} from "@/features/reservation/reservation-date";
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
import type { WorkspaceE2EError } from "../errors";
import {
  type ExpectedDiscountApplication,
  markFulfillmentFailedForE2E,
  markPreviewFulfillmentDeliveredForE2E,
  replayNexiWebhook,
  validateDiscountApplications,
  validatePostgres,
  waitForWebhookReplayRow,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import { validateDotypos } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlow,
  CheckoutFlowState,
  WorkspaceE2EStep,
  WorkspaceE2EStepRunner,
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
  payPageStep,
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
  payPageStep?: (orderId: string) => WorkspaceE2EStep<void>;
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
    if (payPageStep) {
      yield* runStep(payPageStep(orderId));
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
    const replayRow = yield* runStep({
      execute: waitForWebhookReplayRow(datasourceConfig, orderId, (row) => {
        state.checkoutRow = row;
      }),
      id: "wait-for-webhook-row",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: replayNexiWebhook(config, replayRow).pipe(
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
    yield* runStep({
      execute: assertFulfilledStatusPage({
        config,
        data,
        orderId,
        run,
        session,
      }),
      id: "assert-fulfilled-status-page",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: validateDotypos(datasourceConfig, data, checkoutRow),
      id: "validate-dotypos-reservation",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: assertFulfillmentFailedSupportPath({
        config,
        data,
        datasourceConfig,
        orderId,
        run,
        session,
      }),
      id: "assert-fulfillment-support-path",
      timeoutMs: config.timeouts.uiTransition,
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
  config,
  data,
  orderId,
  run,
  session,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  orderId: string;
  run: Runner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* openBrowserPage(
      config,
      run,
      session,
      `${config.baseUrl}/${data.locale}/reservation/status/${orderId}`,
      { timeoutMs: config.timeouts.browserNavigation }
    );
    const expectedMeetingRoomText = data.meetingRoom
      ? [
          formatReservationDisplayDate(
            Temporal.Instant.from(data.meetingRoom.startsAt),
            data.locale
          ),
          formatReservationDisplayTimeRange(
            Temporal.Instant.from(data.meetingRoom.startsAt),
            Temporal.Instant.from(data.meetingRoom.endsAt),
            data.locale
          ),
        ]
      : [];
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

const assertFulfillmentFailedSupportPath = ({
  config,
  data,
  datasourceConfig,
  orderId,
  run,
  session,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  orderId: string;
  run: Runner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    yield* markFulfillmentFailedForE2E(orderId);
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
    yield* waitForBrowserText({
      description: "fulfillment failed support link",
      matches: (text) =>
        /couldn't deliver your access codes/i.test(text) &&
        /Send support request/i.test(text),
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* evalBrowserScript(
      "assert fulfillment failed support link",
      run,
      session,
      getAssertFulfillmentFailedSupportScript(data, orderId),
      {
        logOutput: false,
        timeoutMs: config.timeouts.browserAction,
      }
    );
    yield* activateHydratedBrowserElement(
      run,
      session,
      "#checkout-status-support-contact",
      { timeoutMs: config.timeouts.browserAction }
    );
    yield* waitForBrowserUrl({
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
      timeoutMs: 60_000,
    });
    log("Fulfillment failed support path e2e passed");
  });
