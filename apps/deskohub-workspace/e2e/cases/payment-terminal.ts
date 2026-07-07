import { Effect } from "effect";
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
  effectifyPromise,
  effectifySync,
  type WorkspaceE2EError,
} from "../errors";
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
  WorkspaceE2EResourceScope,
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

export const assertPaymentTerminalPath = ({
  config,
  data,
  datasourceConfig,
  resources,
  run,
  scenario,
  session,
  state,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  datasourceConfig: DatasourceConfig;
  resources: WorkspaceE2EResourceScope;
  run: Runner;
  scenario: PaymentTerminalScenario;
  session: string;
  state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const orderId = yield* resources.withCheckoutProviderSession(
      effectifyPromise(`start ${scenario.state} payment provider session`, () =>
        startCheckoutPaymentAttempt({
          config,
          data,
          onOrderId: (orderId) => {
            state.orderId = orderId;
          },
          run,
          session,
          submitReservationScript: submitCoworkReservationScript,
        })
      )
    );
    state.orderId = orderId;
    state.checkoutRow = yield* effectifyPromise(
      `wait for ${scenario.state} payment webhook row`,
      () =>
        waitForWebhookReplayRow(datasourceConfig, orderId, (row) => {
          state.checkoutRow = row;
        })
    );
    const checkoutRow = yield* effectifyPromise(
      `mark ${scenario.state} payment terminal state`,
      () => markPaymentTerminalForE2E(datasourceConfig, orderId, scenario)
    );
    state.checkoutRow = checkoutRow;
    yield* effectifySync(`assert ${scenario.state} payment terminal row`, () =>
      assertPaymentTerminalRow(checkoutRow, scenario)
    );
    yield* assertTerminalStatusPage({
      config,
      orderId,
      run,
      scenario,
      session,
    });

    yield* clickStatusReserveAgain(run, session);
    yield* effectifyPromise(
      `wait for ${scenario.state} payment restart page`,
      () =>
        waitForBrowserUrl({
          description: `${scenario.state} payment restart page`,
          matches: (url) =>
            (parseUrl(url)?.pathname ?? "") === "/en-US/checkout/order",
          run,
          session,
          timeoutMs: 60_000,
        })
    );

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
    const url = `${config.browserUrl}/en-US/checkout/status/${orderId}`;

    yield* effectifyPromise(`open ${scenario.state} checkout status page`, () =>
      openBrowserPage(config, run, session, url, {
        timeoutMs: 60_000,
      })
    );
    yield* effectifyPromise(
      `wait for ${scenario.state} checkout status copy`,
      () =>
        waitForInteractiveSnapshot({
          description: `${scenario.state} checkout status copy`,
          matches: (snapshot) =>
            scenario.titlePattern.test(snapshot) &&
            /Start a new reservation/i.test(snapshot),
          run,
          session,
          timeoutMs: getCheckoutTimeoutMs(),
        })
    );

    log(`Checkout ${scenario.state} status page validated`);
  });

const clickStatusReserveAgain = (run: Runner, session: string) =>
  effectifyPromise("click status reserve again", () =>
    run("agent-browser", ["--session", session, "eval", "--stdin"], {
      input: clickStatusReserveAgainScript,
      logOutput: false,
      timeoutMs: 30_000,
    })
  );
