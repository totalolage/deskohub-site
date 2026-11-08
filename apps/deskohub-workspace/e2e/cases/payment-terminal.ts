import { Effect } from "effect";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  activateHydratedElement,
  openPage,
  readPageUrl,
  waitForPageCondition,
  waitForPageText,
  waitForPageUrl,
} from "../browser";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import {
  prepareCheckoutPaymentAttempt,
  submitPaymentAndWaitForHostedPage,
} from "../checkout/payment";
import {
  isPrefilledReservation,
  toPrefilledReservation,
} from "../checkout/prefilled-reservation";
import type { ReservationFormPreparation } from "../checkout/reservation-form-preparation";
import type { WorkspaceE2EConfig } from "../config";
import { WorkspaceE2EHostedPaymentPermitService } from "../coordination/hosted-payment-permit.service";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import {
  assertPaymentTerminalRow,
  markPaymentTerminalForE2E,
  readCheckoutRow,
  requireProviderSessionRowAfterRedirect,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import type { Runner } from "../runtime";
import { assert, browserSessionFor, log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  PaymentTerminalScenario,
} from "../types";
import { makeUrl, setSearchParams } from "../urls";
import { completeHostedCheckoutPayment } from "./checkout";

export const getPaymentTerminalScenarios =
  (): readonly PaymentTerminalScenario[] => [
    {
      failureCode: "nexi_payment_failed",
      id: "payment-authentication-failed",
      providerStatus: "THREEDS_FAILED",
      state: "failed",
      titlePattern: /Payment was not completed\./i,
      trigger: "hosted_authentication_failure",
    },
    {
      failureCode: "workspace_e2e_nexi_cancelled",
      id: "payment-cancelled",
      providerStatus: "CANCELLED",
      state: "cancelled",
      titlePattern: /Payment was cancelled\./i,
      trigger: "injected",
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
  preparation,
}: {
  config: WorkspaceE2EConfig;
  data: CheckoutData;
  reservationPath: string;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  scenario: PaymentTerminalScenario;
  session: string;
  state: CheckoutFlowState;
  preparation: ReservationFormPreparation;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | WorkspaceE2EHostedPaymentPermitService
> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* browserSessionFor(run, session);
        return yield* prepareCheckoutPaymentAttempt({
          config,
          data,
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          preparation,
          session: browser,
        });
      }),
      id: "prepare-checkout-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    if (scenario.trigger === "hosted_authentication_failure") {
      // The hosted-payment permit ends once Nexi returns to checkout status.
      yield* completeHostedCheckoutPayment({
        challengeOutcome: "failed",
        config,
        data,
        orderId,
        run,
        runStep,
        session,
        state,
      });
      // The status page reconciles the order with Nexi; no webhook replay.
      yield* runStep({
        execute: Effect.flatMap(browserSessionFor(run, session), (browser) =>
          assertReturnedTerminalStatusPage({
            orderId,
            scenario,
            session: browser,
            timeouts: config.timeouts,
          })
        ),
        id: `assert-${scenario.state}-status-page`,
        timeoutMs: config.timeouts.uiTransition,
      });
      yield* runStep({
        execute: validateReconciledTerminalRow({ orderId, scenario, state }),
        id: `validate-${scenario.state}-payment-state`,
        timeoutMs: config.timeouts.datasource,
      });
    } else {
      yield* injectPaymentTerminalState({
        config,
        orderId,
        run,
        runStep,
        scenario,
        session,
        state,
      });
      yield* runStep({
        execute: Effect.flatMap(browserSessionFor(run, session), (browser) =>
          assertTerminalStatusPage({
            config,
            orderId,
            scenario,
            session: browser,
          })
        ),
        id: `assert-${scenario.state}-status-page`,
        timeoutMs: config.timeouts.uiTransition,
      });
    }
    yield* runStep({
      execute: Effect.flatMap(browserSessionFor(run, session), (browser) =>
        retryReservation({
          data,
          reservationPath,
          scenario,
          session: browser,
          timeouts: config.timeouts,
        })
      ),
      id: "retry-reservation",
      timeoutMs: config.timeouts.uiTransition,
    });

    log(`Payment ${scenario.state} status e2e passed for order ${orderId}`);
  });

const injectPaymentTerminalState = ({
  config,
  orderId,
  run,
  runStep,
  scenario,
  session,
  state,
}: {
  config: WorkspaceE2EConfig;
  orderId: WorkspaceReservationId;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  scenario: PaymentTerminalScenario;
  session: string;
  state: CheckoutFlowState;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | WorkspaceE2EHostedPaymentPermitService
> =>
  Effect.gen(function* () {
    const hostedPaymentPermit = yield* WorkspaceE2EHostedPaymentPermitService;
    // The hosted session ends once the attempt reaches its terminal state.
    yield* hostedPaymentPermit.withPermit(
      session,
      Effect.gen(function* () {
        yield* runStep({
          execute: Effect.gen(function* () {
            const browser = yield* browserSessionFor(run, session);
            const { checkoutPage } = yield* submitPaymentAndWaitForHostedPage({
              session: browser,
              timeouts: config.timeouts,
            });
            yield* browser.activate(checkoutPage);
          }),
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
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
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

export const retryReservation = ({
  data,
  reservationPath,
  scenario,
  session,
  timeouts,
}: {
  data: CheckoutData;
  reservationPath: string;
  scenario: PaymentTerminalScenario;
  session: E2EBrowserSession;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const expectedSelection = getExpectedRetrySelection(data);
    yield* activateHydratedElement(
      session,
      `#checkout-status-reserve-again[href^="${reservationPath}?"]`,
      { timeoutMs: timeouts.uiTransition }
    );
    yield* waitForPageUrl({
      description: `${scenario.state} payment retry page with the original selection`,
      matches: (url) =>
        isRetryReservationUrl(url, reservationPath, expectedSelection),
      session,
      timeoutMs: timeouts.uiTransition,
    });
    yield* waitForPageCondition(
      session,
      `${scenario.state} payment retry form shows the original selection`,
      isPrefilledReservation,
      toPrefilledReservation(data, { includeContact: false }),
      { timeoutMs: timeouts.uiTransition }
    );
  });

export const assertTerminalStatusPage = ({
  config,
  orderId,
  scenario,
  session,
}: {
  config: Pick<WorkspaceE2EConfig, "baseUrl" | "bypassSecret" | "timeouts">;
  orderId: WorkspaceReservationId;
  scenario: PaymentTerminalScenario;
  session: E2EBrowserSession;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* makeUrl(
      "build payment terminal checkout status URL",
      `${config.baseUrl}/en-US/reservation/status/${orderId}`
    );
    yield* setSearchParams(url, { e2eAt: String(Date.now()) });

    yield* openPage(session, config, url.toString(), { timeoutMs: 60_000 });
    yield* waitForPageText({
      description: `${scenario.state} checkout status copy`,
      matches: (text) =>
        scenario.titlePattern.test(text) && /Try again/i.test(text),
      session,
      timeoutMs: config.timeouts.uiTransition,
    });

    log(`Checkout ${scenario.state} status page validated`);
  });

const isOrderStatusUrl = (value: string, orderId: WorkspaceReservationId) =>
  parseUrl(value)?.pathname.endsWith(`/reservation/status/${orderId}`) === true;

// The customer stays on the status page Nexi returned to; it refreshes while
// the payment is pending and reconciles the order with Nexi.
export const assertReturnedTerminalStatusPage = ({
  orderId,
  scenario,
  session,
  timeouts,
}: {
  orderId: WorkspaceReservationId;
  scenario: PaymentTerminalScenario;
  session: E2EBrowserSession;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const url = yield* readPageUrl(session);
    yield* tryWorkspaceE2ESync("assert returned checkout status order", () =>
      assert(
        url && isOrderStatusUrl(url, orderId),
        "Nexi returned to a different checkout status page"
      )
    );
    yield* waitForPageText({
      description: `${scenario.state} checkout status copy after the Nexi return`,
      matches: (text) =>
        scenario.titlePattern.test(text) && /Try again/i.test(text),
      session,
      timeoutMs: timeouts.uiTransition,
    });

    log(
      `Checkout ${scenario.state} status page validated after the Nexi return`
    );
  });

const validateReconciledTerminalRow = ({
  orderId,
  scenario,
  state,
}: {
  orderId: WorkspaceReservationId;
  scenario: PaymentTerminalScenario;
  state: CheckoutFlowState;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const row = yield* readCheckoutRow(orderId);
    const checkoutRow = yield* tryWorkspaceE2ESync(
      "read reconciled terminal checkout row",
      () => {
        assert(row, "checkout row missing after the Nexi return");
        return row;
      }
    );
    state.checkoutRow = checkoutRow;
    yield* assertPaymentTerminalRow(checkoutRow, scenario);
  });
