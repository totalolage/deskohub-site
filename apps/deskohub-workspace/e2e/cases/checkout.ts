import { Effect } from "effect";
import {
  openBrowserPage,
  waitForBrowserUrl,
  waitForInteractiveSnapshot,
} from "../browser";
import {
  assertFulfilledStatusScript,
  getAssertFulfillmentFailedSupportScript,
  getAssertSupportContactPrefillScript,
} from "../browser-scripts";
import {
  completeNexiHostedPayment,
  startCheckoutPaymentAttempt,
} from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
import { effectifyPromise, type WorkspaceE2EError } from "../errors";
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
  WorkspaceE2EResourceScope,
} from "../types";
import { verifyAlias } from "../vercel";

export const executeCheckoutFlow = ({
  config,
  data,
  datasourceConfig,
  deploymentId,
  flow,
  resources,
  run,
  session,
  state,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  deploymentId: string;
  flow: CheckoutFlow;
  resources: WorkspaceE2EResourceScope;
  run: Runner;
  session: string;
  state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const orderId = yield* resources.withCheckoutProviderSession(
      Effect.gen(function* () {
        const orderId = yield* effectifyPromise(
          `start ${flow.id} checkout provider session`,
          () =>
            startCheckoutPaymentAttempt({
              config,
              data,
              onOrderId: (orderId) => {
                state.orderId = orderId;
              },
              run,
              session,
              submitReservationScript: flow.submitReservationScript(data),
            })
        );
        yield* effectifyPromise(`complete ${flow.id} hosted payment`, () =>
          completeNexiHostedPayment({ data, run, session })
        );
        yield* effectifyPromise(
          `wait for ${flow.id} checkout status page`,
          () =>
            waitForBrowserUrl({
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
            })
        );
        return orderId;
      })
    );
    state.orderId = orderId;

    // Nexi verification happens inside the deployed webhook handler. The runner
    // validates the resulting payment/webhook state without holding Nexi secrets.
    const replayRow = yield* effectifyPromise(
      `wait for ${flow.id} webhook replay row`,
      () =>
        waitForWebhookReplayRow(datasourceConfig, orderId, (row) => {
          state.checkoutRow = row;
        })
    );
    yield* effectifyPromise(`replay ${flow.id} Nexi webhook`, () =>
      replayNexiWebhook(config, replayRow)
    );
    yield* effectifyPromise(
      `mark ${flow.id} console fulfillment delivered`,
      () => markConsoleFulfillmentDeliveredForE2E(datasourceConfig, orderId)
    );
    const checkoutRow = yield* effectifyPromise(
      `validate ${flow.id} Postgres state`,
      () =>
        validatePostgres(datasourceConfig, data, orderId, (row) => {
          state.checkoutRow = row;
        })
    );
    state.checkoutRow = checkoutRow;
    yield* effectifyPromise("verify Vercel alias after checkout", () =>
      verifyAlias(config, deploymentId)
    );
    yield* assertFulfilledStatusPage({
      config,
      locale: data.locale,
      orderId,
      run,
      session,
    });
    yield* effectifyPromise(`validate ${flow.id} Dotypos state`, () =>
      validateDotypos(datasourceConfig, data, checkoutRow)
    );
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
    const headers = config.bypassSecret
      ? [
          "--headers",
          JSON.stringify({
            "x-vercel-protection-bypass": config.bypassSecret,
            "x-vercel-set-bypass-cookie": "true",
          }),
        ]
      : [];

    yield* effectifyPromise("open fulfilled checkout status page", () =>
      run(
        "agent-browser",
        [
          "--session",
          session,
          ...headers,
          "open",
          `${config.browserUrl}/${locale}/checkout/status/${orderId}`,
        ],
        { timeoutMs: getCheckoutTimeoutMs() }
      )
    );
    yield* effectifyPromise("assert fulfilled checkout status page", () =>
      run("agent-browser", ["--session", session, "eval", "--stdin"], {
        input: assertFulfilledStatusScript,
        timeoutMs: getCheckoutTimeoutMs(),
      })
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
    yield* effectifyPromise("mark checkout fulfillment failed", () =>
      markFulfillmentFailedForE2E(datasourceConfig, orderId)
    );
    const statusUrl = new URL(
      `${config.browserUrl}/${data.locale}/checkout/status/${orderId}`
    );
    statusUrl.searchParams.set("e2eState", "fulfillmentFailed");
    statusUrl.searchParams.set("e2eAt", String(Date.now()));
    yield* effectifyPromise(
      "open fulfillment failed checkout status page",
      () =>
        openBrowserPage(config, run, session, statusUrl.toString(), {
          timeoutMs: getCheckoutTimeoutMs(),
        })
    );
    yield* effectifyPromise("wait for fulfillment failed support link", () =>
      waitForInteractiveSnapshot({
        description: "fulfillment failed support link",
        matches: (snapshot) =>
          /couldn't deliver your access codes/i.test(snapshot) &&
          /Send support request/i.test(snapshot),
        run,
        session,
        timeoutMs: getCheckoutTimeoutMs(),
      })
    );
    yield* effectifyPromise("assert fulfillment failed support link", () =>
      run("agent-browser", ["--session", session, "eval", "--stdin"], {
        input: getAssertFulfillmentFailedSupportScript(data, orderId),
        logOutput: false,
        timeoutMs: getCheckoutTimeoutMs(),
      })
    );
    yield* effectifyPromise(
      "wait for fulfillment failed support contact page",
      () =>
        waitForBrowserUrl({
          description: "fulfillment failed support contact page",
          matches: (url) =>
            parseUrl(url)?.pathname === `/${data.locale}/contact`,
          run,
          session,
          timeoutMs: 60_000,
        })
    );
    yield* effectifyPromise("assert support contact prefill", () =>
      run("agent-browser", ["--session", session, "eval", "--stdin"], {
        input: getAssertSupportContactPrefillScript(data, orderId),
        logOutput: false,
        timeoutMs: 30_000,
      })
    );
    log("Fulfillment failed support path e2e passed");
  });
