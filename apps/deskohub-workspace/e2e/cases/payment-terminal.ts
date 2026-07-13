import { Effect } from "effect";
import {
  evalBrowserScript,
  openBrowserPage,
  switchToMainFrame,
  waitForBrowserText,
  waitForBrowserUrl,
} from "../browser";
import {
  clickStatusReserveAgainScript,
  submitCoworkReservationScript,
} from "../browser-scripts";
import { startCheckoutPaymentAttempt } from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { getCheckoutTimeoutMs } from "../config";
import type { WorkspaceE2EError } from "../errors";
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
import { makeUrl, setSearchParams } from "../urls";

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

export const assertPaymentTerminalPath = ({
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
      submitReservationScript: submitCoworkReservationScript,
    }).pipe(Effect.retry({ times: 1 }));
    state.orderId = orderId;
    state.checkoutRow = yield* waitForWebhookReplayRow(
      datasourceConfig,
      orderId,
      (row) => {
        state.checkoutRow = row;
      }
    );
    const checkoutRow = yield* markPaymentTerminalForE2E(
      datasourceConfig,
      orderId,
      scenario
    );
    state.checkoutRow = checkoutRow;
    yield* assertPaymentTerminalRow(checkoutRow, scenario);
    yield* assertTerminalStatusPage({
      config,
      orderId,
      run,
      scenario,
      session,
    });

    yield* clickStatusReserveAgain(run, session);
    yield* waitForBrowserUrl({
      description: `${scenario.state} payment restart page`,
      matches: (url) =>
        (parseUrl(url)?.pathname ?? "") ===
        "/en-US/reservation/cowork",
      run,
      session,
      timeoutMs: 60_000,
    });

    log(`Payment ${scenario.state} status e2e passed for order ${orderId}`);
  });

const assertTerminalStatusPage = ({
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
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* makeUrl(
      "build payment terminal checkout status URL",
      `${config.browserUrl}/en-US/reservation/status/${orderId}`
    );
    yield* setSearchParams(url, { e2eAt: String(Date.now()) });

    yield* switchToMainFrame(run, session);
    yield* openBrowserPage(config, run, session, url.toString(), {
      timeoutMs: 60_000,
    });
    yield* waitForBrowserText({
      description: `${scenario.state} checkout status copy`,
      matches: (text) =>
        scenario.titlePattern.test(text) &&
        /Start a new reservation/i.test(text),
      run,
      session,
      timeoutMs: getCheckoutTimeoutMs(),
    });

    log(`Checkout ${scenario.state} status page validated`);
  });

const clickStatusReserveAgain = (run: Runner, session: string) =>
  evalBrowserScript(
    "click status reserve again",
    run,
    session,
    clickStatusReserveAgainScript,
    {
      logOutput: false,
      timeoutMs: 30_000,
    }
  );
