import { Effect } from "effect";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  activateHydratedBrowserElement,
  openBrowserPage,
  switchToBrowserTab,
  switchToMainFrame,
  waitForBrowserCondition,
  waitForBrowserText,
  waitForBrowserUrl,
} from "../browser";
import { getPrefilledReservationConditionScript } from "../browser-scripts";
import {
  prepareCheckoutPaymentAttempt,
  submitPaymentAndWaitForHostedPage,
} from "../checkout/payment";
import type { WorkspaceE2EConfig } from "../config";
import { WorkspaceE2EHostedPaymentPermitService } from "../coordination/hosted-payment-permit.service";
import type { WorkspaceE2EError } from "../errors";
import {
  assertPaymentTerminalRow,
  markPaymentTerminalForE2E,
  requireProviderSessionRowAfterRedirect,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  PaymentTerminalScenario,
  WorkspaceE2EStepRunner,
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
  reservationPath,
  run,
  runStep,
  scenario,
  session,
  state,
  submitReservationScript,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  reservationPath: string;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  scenario: PaymentTerminalScenario;
  session: string;
  state: CheckoutFlowState;
  submitReservationScript: string;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | WorkspaceE2EHostedPaymentPermitService
> =>
  Effect.gen(function* () {
    const hostedPaymentPermit = yield* WorkspaceE2EHostedPaymentPermitService;
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: prepareCheckoutPaymentAttempt({
        config,
        data,
        onOrderId: (startedOrderId) => {
          state.orderId = startedOrderId;
        },
        run,
        session,
        submitReservationScript,
      }),
      id: "prepare-checkout-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    // The hosted session ends once the attempt reaches its terminal state.
    yield* hostedPaymentPermit.withPermit(
      session,
      Effect.gen(function* () {
        yield* runStep({
          execute: submitPaymentAndWaitForHostedPage({
            run,
            session,
            timeouts: config.timeouts,
          }).pipe(
            Effect.tap(({ checkoutTabId }) =>
              switchToBrowserTab(run, session, checkoutTabId)
            )
          ),
          id: "start-hosted-payment",
          timeoutMs: config.timeouts.providerTransition,
        });
        log(`Started hosted payment attempt for order ${orderId}`);
        yield* runStep({
          execute: preparePaymentTerminalState({
            orderId,
            scenario,
            state,
            timeoutMs: config.timeouts.browserAction,
          }),
          id: `prepare-${scenario.state}-payment-state`,
          timeoutMs: config.timeouts.datasource,
        });
      })
    );
    yield* runStep({
      execute: assertTerminalStatusPage({
        config,
        orderId,
        run,
        scenario,
        session,
      }),
      id: `assert-${scenario.state}-status-page`,
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: retryReservation({
        data,
        reservationPath,
        run,
        scenario,
        session,
        timeouts: config.timeouts,
      }),
      id: "retry-reservation",
      timeoutMs: config.timeouts.uiTransition,
    });

    log(`Payment ${scenario.state} status e2e passed for order ${orderId}`);
  });

const preparePaymentTerminalState = ({
  orderId,
  scenario,
  state,
  timeoutMs,
}: {
  orderId: WorkspaceReservationId;
  scenario: PaymentTerminalScenario;
  state: CheckoutFlowState;
  timeoutMs: number;
}) =>
  Effect.gen(function* () {
    const providerSessionRow = yield* requireProviderSessionRowAfterRedirect(
      orderId,
      {
        onRow: (row) => {
          state.checkoutRow = row;
        },
        timeoutMs,
      }
    );
    state.checkoutRow = providerSessionRow;
    const checkoutRow = yield* markPaymentTerminalForE2E(
      orderId,
      providerSessionRow.payment_attempt_id,
      scenario
    );
    state.checkoutRow = checkoutRow;
    yield* assertPaymentTerminalRow(checkoutRow, scenario);
  });

/** The selection parameters the retry link must carry back to the form. */
const getExpectedRetrySelection = (
  data: CheckoutData
): Readonly<Record<string, string>> => {
  if (data.meetingRoom) {
    return {
      startDateTime: data.meetingRoom.startDateTime,
      duration: getMeetingRoomReservationDurationKey(data.meetingRoom.duration),
    };
  }
  if (data.office) {
    return {
      startsOn: data.office.startsOn,
      seats: String(data.office.seats),
    };
  }
  return data.expectedReservationDetails.kind === "cowork"
    ? {
        entryTier: data.expectedReservationDetails.entryTier,
        date: data.date,
      }
    : { date: data.date };
};

const contactSearchParams = ["name", "email", "phone", "customer"];

/** Whether a reservation page URL reopens the retried selection, contact-free. */
const isRetryReservationUrl = (
  value: string,
  reservationPath: string,
  expectedSelection: Readonly<Record<string, string>>
) => {
  const url = parseUrl(value);
  return (
    url?.pathname === reservationPath &&
    Object.entries(expectedSelection).every(
      ([name, expected]) => url.searchParams.get(name) === expected
    ) &&
    contactSearchParams.every((name) => !url.searchParams.has(name))
  );
};

const retryReservation = ({
  data,
  reservationPath,
  run,
  scenario,
  session,
  timeouts,
}: {
  data: CheckoutData;
  reservationPath: string;
  run: Runner;
  scenario: PaymentTerminalScenario;
  session: string;
  timeouts: WorkspaceE2ETimeouts;
}) =>
  Effect.gen(function* () {
    const expectedSelection = getExpectedRetrySelection(data);
    yield* activateStatusRetry(run, session, reservationPath, timeouts);
    yield* waitForBrowserUrl({
      description: `${scenario.state} payment retry page with the original selection`,
      matches: (url) =>
        isRetryReservationUrl(url, reservationPath, expectedSelection),
      run,
      session,
      timeoutMs: timeouts.uiTransition,
    });
    yield* waitForBrowserCondition(
      run,
      session,
      `${scenario.state} payment retry form shows the original selection`,
      getPrefilledReservationConditionScript(data, { includeContact: false }),
      { timeoutMs: timeouts.uiTransition }
    );
  });

const assertTerminalStatusPage = ({
  config,
  orderId,
  run,
  scenario,
  session,
}: {
  config: WorkspaceE2EConfig;
  orderId: WorkspaceReservationId;
  run: Runner;
  scenario: PaymentTerminalScenario;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* makeUrl(
      "build payment terminal checkout status URL",
      `${config.baseUrl}/en-US/reservation/status/${orderId}`
    );
    yield* setSearchParams(url, { e2eAt: String(Date.now()) });

    yield* switchToMainFrame(run, session);
    yield* openBrowserPage(config, run, session, url.toString(), {
      timeoutMs: 60_000,
    });
    yield* waitForBrowserText({
      description: `${scenario.state} checkout status copy`,
      matches: (text) =>
        scenario.titlePattern.test(text) && /Try again/i.test(text),
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });

    log(`Checkout ${scenario.state} status page validated`);
  });

const activateStatusRetry = (
  run: Runner,
  session: string,
  reservationPath: string,
  timeouts: WorkspaceE2ETimeouts
) => {
  const selector = `#checkout-status-reserve-again[href^="${reservationPath}?"]`;

  return activateHydratedBrowserElement(run, session, selector, {
    timeoutMs: timeouts.uiTransition,
  });
};
