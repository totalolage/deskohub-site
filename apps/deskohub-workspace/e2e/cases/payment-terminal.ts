import { Effect } from "effect";
import {
  openBrowserPage,
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
    const orderId = yield* resources.withPaymentTerminalProviderSession(
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
      ).pipe(Effect.retry({ times: 1 }))
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
    const url = new URL(
      `${config.browserUrl}/en-US/checkout/status/${orderId}`
    );
    url.searchParams.set("e2eAt", String(Date.now()));

    yield* effectifyPromise(`open ${scenario.state} checkout status page`, () =>
      openBrowserPage(config, run, session, url.toString(), {
        timeoutMs: 60_000,
      })
    );
    yield* effectifyPromise(
      `wait for ${scenario.state} checkout status copy`,
      () =>
        waitForBrowserText({
          description: `${scenario.state} checkout status copy`,
          matches: (text) =>
            scenario.titlePattern.test(text) &&
            /Start a new reservation/i.test(text),
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
