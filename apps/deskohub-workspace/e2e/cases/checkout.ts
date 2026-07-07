import { openBrowserPage, waitForBrowserUrl } from "../browser";
import {
  assertFulfilledStatusScript,
  getAssertFulfillmentFailedSupportScript,
  getAssertSupportContactPrefillScript,
} from "../browser-scripts";
import { completeCheckout } from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
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
import { verifyAlias } from "../vercel";

export const executeCheckoutFlow = async ({
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
}) => {
  state.startedAt = new Date();
  const orderId = await completeCheckout({
    config,
    data,
    onOrderId: (orderId) => {
      state.orderId = orderId;
    },
    run,
    session,
    submitReservationScript: flow.submitReservationScript(data),
  });
  state.orderId = orderId;
  // Nexi verification happens inside the deployed webhook handler. The runner
  // validates the resulting payment/webhook state without holding Nexi secrets.
  const replayRow = await waitForWebhookReplayRow(
    datasourceConfig,
    orderId,
    (row) => {
      state.checkoutRow = row;
    }
  );
  await replayNexiWebhook(config, replayRow);
  await markConsoleFulfillmentDeliveredForE2E(datasourceConfig, orderId);
  state.checkoutRow = await validatePostgres(
    datasourceConfig,
    data,
    orderId,
    (row) => {
      state.checkoutRow = row;
    }
  );
  await verifyAlias(config, deploymentId);
  await assertFulfilledStatusPage({
    config,
    locale: data.locale,
    orderId,
    run,
    session,
  });
  await validateDotypos(datasourceConfig, data, state.checkoutRow);
  await assertFulfillmentFailedSupportPath({
    config,
    data,
    datasourceConfig,
    orderId,
    run,
    session,
  });

  log(`${flow.id} checkout e2e passed for order ${orderId}`);
};

const assertFulfilledStatusPage = async ({
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
}) => {
  const headers = config.bypassSecret
    ? [
        "--headers",
        JSON.stringify({
          "x-vercel-protection-bypass": config.bypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }),
      ]
    : [];

  await run(
    "agent-browser",
    [
      "--session",
      session,
      ...headers,
      "open",
      `${config.aliasUrl}/${locale}/checkout/status/${orderId}`,
    ],
    { timeoutMs: getCheckoutTimeoutMs() }
  );
  await run("agent-browser", ["--session", session, "eval", "--stdin"], {
    input: assertFulfilledStatusScript,
    timeoutMs: getCheckoutTimeoutMs(),
  });
  log("Checkout status page validated");
};

const assertFulfillmentFailedSupportPath = async ({
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
}) => {
  await markFulfillmentFailedForE2E(datasourceConfig, orderId);
  await openBrowserPage(
    config,
    run,
    session,
    `${config.aliasUrl}/${data.locale}/checkout/status/${orderId}`,
    { timeoutMs: getCheckoutTimeoutMs() }
  );
  await run("agent-browser", ["--session", session, "eval", "--stdin"], {
    input: getAssertFulfillmentFailedSupportScript(data, orderId),
    logOutput: false,
    timeoutMs: getCheckoutTimeoutMs(),
  });
  await waitForBrowserUrl({
    description: "fulfillment failed support contact page",
    matches: (url) => parseUrl(url)?.pathname === `/${data.locale}/contact`,
    run,
    session,
    timeoutMs: 60_000,
  });
  await run("agent-browser", ["--session", session, "eval", "--stdin"], {
    input: getAssertSupportContactPrefillScript(data, orderId),
    logOutput: false,
    timeoutMs: 30_000,
  });
  log("Fulfillment failed support path e2e passed");
};
