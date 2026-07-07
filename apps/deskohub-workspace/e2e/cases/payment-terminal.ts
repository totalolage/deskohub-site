import {
  openBrowserPage,
  waitForBrowserUrl,
  waitForInteractiveSnapshot,
} from "../browser";
import {
  clickStatusReserveAgainScript,
  submitCoworkReservationScript,
} from "../browser-scripts";
import { startCheckoutPaymentAttempt } from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
import {
  assertPaymentTerminalRow,
  markPaymentTerminalForE2E,
  waitForWebhookReplayRow,
} from "../integrations/database";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  PaymentTerminalScenario,
} from "../types";

export const getPaymentTerminalScenarios =
  (): readonly PaymentTerminalScenario[] => [
    {
      providerStatus: "DECLINED",
      state: "failed",
      titlePattern: /Payment was not completed\./i,
    },
    {
      providerStatus: "CANCELLED",
      state: "cancelled",
      titlePattern: /Payment was cancelled\./i,
    },
  ];

export const assertPaymentTerminalPath = async ({
  config,
  data,
  datasourceConfig,
  run,
  scenario,
  session,
  state,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  run: Runner;
  scenario: PaymentTerminalScenario;
  session: string;
  state: CheckoutFlowState;
}) => {
  state.startedAt = new Date();
  const orderId = await startCheckoutPaymentAttempt({
    config,
    data,
    onOrderId: (orderId) => {
      state.orderId = orderId;
    },
    run,
    session,
    submitReservationScript: submitCoworkReservationScript,
  });
  state.orderId = orderId;
  state.checkoutRow = await waitForWebhookReplayRow(
    datasourceConfig,
    orderId,
    (row) => {
      state.checkoutRow = row;
    }
  );
  state.checkoutRow = await markPaymentTerminalForE2E(
    datasourceConfig,
    orderId,
    scenario
  );
  assertPaymentTerminalRow(state.checkoutRow, scenario);
  await assertTerminalStatusPage({
    config,
    orderId,
    run,
    scenario,
    session,
  });

  await clickStatusReserveAgain(run, session);
  await waitForBrowserUrl({
    description: `${scenario.state} payment restart page`,
    matches: (url) =>
      (parseUrl(url)?.pathname ?? "") === "/en-US/checkout/order",
    run,
    session,
    timeoutMs: 60_000,
  });

  log(`Payment ${scenario.state} status e2e passed for order ${orderId}`);
};

const assertTerminalStatusPage = async ({
  config,
  orderId,
  run,
  scenario,
  session,
}: {
  config: WorkspaceE2EConfig;
  orderId: string;
  run: Runner;
  scenario: PaymentTerminalScenario;
  session: string;
}) => {
  const url = `${config.browserUrl}/en-US/checkout/status/${orderId}`;

  await openBrowserPage(config, run, session, url, {
    timeoutMs: 60_000,
  });
  await waitForInteractiveSnapshot({
    description: `${scenario.state} checkout status copy`,
    matches: (snapshot) =>
      scenario.titlePattern.test(snapshot) &&
      /Start a new reservation/i.test(snapshot),
    run,
    session,
    timeoutMs: getCheckoutTimeoutMs(),
  });

  log(`Checkout ${scenario.state} status page validated`);
};

const clickStatusReserveAgain = async (run: Runner, session: string) => {
  await run("agent-browser", ["--session", session, "eval", "--stdin"], {
    input: clickStatusReserveAgainScript,
    logOutput: false,
    timeoutMs: 30_000,
  });
};
