import { Effect } from "effect";
import {
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
import { getCheckoutTimeoutMs } from "../config";
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
import type { CheckoutData, CheckoutFlow, CheckoutFlowState } from "../types";
import { makeUrl, setSearchParams } from "../urls";
import { verifyAlias } from "../vercel";

export const executeCheckoutFlow = ({
  config,
  data,
  datasourceConfig,
  deploymentId,
  flow,
  run,
  session,
  state,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  deploymentId: string;
  flow: CheckoutFlow;
  run: Runner;
  session: string;
  state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const orderId = yield* startCheckoutPaymentAttempt({
      config,
      data,
      onOrderId: (orderId) => {
        state.orderId = orderId;
      },
      run,
      session,
      submitReservationScript: flow.submitReservationScript(data),
    }).pipe(Effect.retry({ times: 1 }));
    yield* completeNexiHostedPayment({ data, run, session });
    yield* waitForBrowserUrl({
      description: "checkout status page",
      matches: (url) => {
        const parsed = parseUrl(url);
        return (
          parsed?.host === config.alias &&
          parsed.pathname.includes("/checkout/status/")
        );
      },
      run,
      session,
      timeoutMs: getCheckoutTimeoutMs(),
    });
    state.orderId = orderId;

    // Nexi verification happens inside the deployed webhook handler. The runner
    // validates the resulting payment/webhook state without holding Nexi secrets.
    const replayRow = yield* waitForWebhookReplayRow(
      datasourceConfig,
      orderId,
      (row) => {
        state.checkoutRow = row;
      }
    );
    yield* replayNexiWebhook(config, replayRow);
    yield* markConsoleFulfillmentDeliveredForE2E(datasourceConfig, orderId);
    const checkoutRow = yield* validatePostgres(
      datasourceConfig,
      data,
      orderId,
      (row) => {
        state.checkoutRow = row;
      }
    );
    state.checkoutRow = checkoutRow;
    yield* verifyAlias(config, deploymentId);
    yield* assertFulfilledStatusPage({
      config,
      locale: data.locale,
      orderId,
      run,
      session,
    });
    yield* validateDotypos(datasourceConfig, data, checkoutRow);
    yield* assertFulfillmentFailedSupportPath({
      config,
      data,
      datasourceConfig,
      orderId,
      run,
      session,
    });

    log(`${flow.id} checkout e2e passed for order ${orderId}`);
  });

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
      `${config.browserUrl}/${locale}/checkout/status/${orderId}`,
      { timeoutMs: getCheckoutTimeoutMs() }
    );
    yield* waitForBrowserText({
      description: "fulfilled checkout status copy",
      matches: (text) =>
        /Your workspace access is ready\./i.test(text) &&
        /sent by email/i.test(text),
      run,
      session,
      timeoutMs: getCheckoutTimeoutMs(),
    });
    yield* evalBrowserScript(
      "assert fulfilled checkout status page",
      run,
      session,
      assertFulfilledStatusScript,
      {
        timeoutMs: getCheckoutTimeoutMs(),
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
      `${config.browserUrl}/${data.locale}/checkout/status/${orderId}`
    );
    yield* setSearchParams(statusUrl, {
      e2eAt: String(Date.now()),
      e2eState: "fulfillmentFailed",
    });
    yield* openBrowserPage(config, run, session, statusUrl.toString(), {
      timeoutMs: getCheckoutTimeoutMs(),
    });
    yield* waitForBrowserText({
      description: "fulfillment failed support link",
      matches: (text) =>
        /couldn't deliver your access codes/i.test(text) &&
        /Send support request/i.test(text),
      run,
      session,
      timeoutMs: getCheckoutTimeoutMs(),
    });
    yield* evalBrowserScript(
      "assert fulfillment failed support link",
      run,
      session,
      getAssertFulfillmentFailedSupportScript(data, orderId),
      {
        logOutput: false,
        timeoutMs: getCheckoutTimeoutMs(),
      }
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
