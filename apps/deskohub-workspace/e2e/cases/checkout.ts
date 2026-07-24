import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
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
  startCheckoutPaymentAttempt,
} from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  markConsoleFulfillmentDeliveredForE2E,
  markFulfillmentFailedForE2E,
  replayNexiWebhook,
  validatePostgres,
  waitForWebhookReplayRow,
} from "../integrations/database";
import { validateDotypos } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlow,
  CheckoutFlowState,
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
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  flow: CheckoutFlow;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
  state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: startCheckoutPaymentAttempt({
        config,
        data,
        onOrderId: (startedOrderId) => {
          state.orderId = startedOrderId;
        },
        run,
        session,
        submitReservationScript: flow.submitReservationScript(data),
      }),
      id: "start-checkout-payment",
      timeoutMs: config.timeouts.checkoutStart,
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
      execute: markConsoleFulfillmentDeliveredForE2E(datasourceConfig, orderId),
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
    yield* runStep({
      execute: assertFulfilledStatusPage({
        config,
        locale: data.locale,
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

const assertFulfilledStatusPage = ({
  config,
  locale,
  orderId,
  run,
  session,
}: {
  config: WorkspaceE2EConfig;
  locale: CheckoutData["locale"];
  orderId: string;
  run: Runner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* openBrowserPage(
      config,
      run,
      session,
      `${config.baseUrl}/${locale}/checkout/status/${orderId}`,
      { timeoutMs: config.timeouts.browserNavigation }
    );
    yield* waitForBrowserText({
      description: "fulfilled checkout status copy",
      matches: (text) =>
        /Your workspace access is ready\./i.test(text) &&
        /sent by email/i.test(text),
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
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* markFulfillmentFailedForE2E(datasourceConfig, orderId);
    const statusUrl = yield* makeUrl(
      "build fulfillment failed checkout status URL",
      `${config.baseUrl}/${data.locale}/checkout/status/${orderId}`
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
