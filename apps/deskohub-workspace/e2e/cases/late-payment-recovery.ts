import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { openBrowserPage, waitForBrowserUrl } from "../browser";
import { getWorkspaceE2EDateInterval } from "../capacity";
import {
  completeNexiHostedPayment,
  prepareCheckoutPaymentAttempt,
  submitPaymentAndWaitForHostedPage,
} from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { tryWorkspaceE2ESync, type WorkspaceE2EError } from "../errors";
import {
  markPreviewFulfillmentDeliveredForE2E,
  releaseReservationForLatePaymentRecoveryE2E,
  replayNexiWebhook,
  requireProviderSessionRowAfterRedirect,
  validatePostgres,
  waitForLatePaymentRecoveryOutcome,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import {
  cancelDotyposReservation,
  validateDotypos,
  waitForCancelledDotyposReservations,
} from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { assert, log } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2EStepRunner,
} from "../types";
import { isExpectedCheckoutStatusUrl, makeUrl, setSearchParams } from "../urls";
import { assertFulfilledStatusPage } from "./checkout";

export const latePaymentRecoveryScenarios = [
  {
    id: "payment-late-recovery-recreated",
    outcome: { state: "recovered" },
    removeAccountingSnapshot: false,
  },
  {
    id: "payment-late-recovery-refund-required",
    outcome: {
      state: "refund_required",
      failureCode: "late_payment_snapshot_unavailable",
    },
    removeAccountingSnapshot: true,
  },
] as const;

export type LatePaymentRecoveryScenario =
  (typeof latePaymentRecoveryScenarios)[number];

export const executeLatePaymentRecovery = ({
  config,
  data,
  datasourceConfig,
  run,
  runStep,
  scenario,
  session,
  state,
  submitReservationScript,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly scenario: LatePaymentRecoveryScenario;
  readonly session: string;
  readonly state: CheckoutFlowState;
  readonly submitReservationScript: string;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  E2EDatabase | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
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
      id: "prepare-late-payment-checkout",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;

    const hostedPaymentPage = yield* runStep({
      execute: submitPaymentAndWaitForHostedPage({
        run,
        session,
        timeouts: config.timeouts,
      }),
      id: "start-late-payment",
      timeoutMs: config.timeouts.providerTransition,
    });
    const providerSessionRow = yield* runStep({
      execute: requireProviderSessionRowAfterRedirect(orderId, {
        onRow: (row) => {
          state.checkoutRow = row;
        },
        timeoutMs: config.timeouts.browserAction,
      }),
      id: "read-late-payment-provider-session",
      timeoutMs: config.timeouts.datasource,
    });
    const originalDotyposReservationId = yield* tryWorkspaceE2ESync(
      "read original late-payment reservation",
      () => {
        assert(
          providerSessionRow.dotypos_reservation_id,
          "original Dotypos reservation missing"
        );
        return providerSessionRow.dotypos_reservation_id;
      }
    );

    yield* runStep({
      execute: cancelDotyposReservation(
        datasourceConfig,
        originalDotyposReservationId
      ).pipe(
        Effect.andThen(
          waitForCancelledDotyposReservations(
            datasourceConfig,
            [originalDotyposReservationId],
            getWorkspaceE2EDateInterval({
              fromDate: data.date,
              toDate: data.date,
            })
          )
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            state.cleanupComplete = true;
            state.completedDotyposReservationId = originalDotyposReservationId;
          })
        )
      ),
      id: "release-original-late-payment-reservation",
      timeoutMs: config.timeouts.datasource,
    });
    const releasedRow = yield* runStep({
      execute: releaseReservationForLatePaymentRecoveryE2E(
        orderId,
        providerSessionRow.payment_attempt_id,
        {
          removeAccountingSnapshot: scenario.removeAccountingSnapshot,
        }
      ),
      id: "persist-released-late-payment-state",
      timeoutMs: config.timeouts.datasource,
    });
    state.checkoutRow = releasedRow;

    yield* runStep({
      execute: completeNexiHostedPayment({
        data,
        hostedPaymentPage,
        run,
        session,
        timeouts: config.timeouts,
      }),
      id: "complete-late-hosted-payment",
      timeoutMs: config.timeouts.hostedPayment,
    });
    yield* runStep({
      execute: waitForBrowserUrl({
        description: "late-payment checkout status page",
        matches: (url) => isExpectedCheckoutStatusUrl(url, config.expectedHost),
        run,
        session,
        timeoutMs: config.timeouts.providerTransition,
      }).pipe(Effect.asVoid),
      id: "reach-late-payment-status-page",
      timeoutMs: config.timeouts.providerTransition,
    });

    yield* runStep({
      capacity: "provider-verification",
      execute: replayNexiWebhook(config, providerSessionRow).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient)
      ),
      id: "replay-late-payment-webhook",
      timeoutMs: config.timeouts.providerTransition,
    });
    const recoveredRow = yield* runStep({
      execute: waitForLatePaymentRecoveryOutcome(
        datasourceConfig,
        orderId,
        providerSessionRow.payment_attempt_id,
        originalDotyposReservationId,
        scenario.outcome
      ),
      id: "wait-for-late-payment-recovery",
      timeoutMs: config.timeouts.datasource,
    });
    state.checkoutRow = recoveredRow;

    if (scenario.outcome.state === "refund_required") {
      log("Late payment refund-required recovery e2e passed");
      return;
    }

    state.cleanupComplete = false;
    delete state.completedDotyposReservationId;
    yield* runStep({
      execute: markPreviewFulfillmentDeliveredForE2E(datasourceConfig, orderId),
      id: "complete-recovered-test-fulfillment",
      timeoutMs: config.timeouts.datasource,
    });
    const checkoutRow = yield* runStep({
      execute: validatePostgres(datasourceConfig, data, orderId, (row) => {
        state.checkoutRow = row;
      }),
      id: "validate-recovered-postgres-state",
      timeoutMs: config.timeouts.datasource,
    });
    state.checkoutRow = checkoutRow;
    const dotyposReservation = yield* runStep({
      execute: validateDotypos(datasourceConfig, data, checkoutRow),
      id: "validate-recreated-dotypos-reservation",
      timeoutMs: config.timeouts.datasource,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        const statusUrl = yield* makeUrl(
          "build recovered checkout status URL",
          `${config.baseUrl}/${data.locale}/reservation/status/${orderId}`
        );
        yield* setSearchParams(statusUrl, { e2eAt: String(Date.now()) });
        yield* openBrowserPage(config, run, session, statusUrl.toString(), {
          timeoutMs: config.timeouts.browserNavigation,
        });
      }),
      id: "open-recovered-status-page",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: assertFulfilledStatusPage({
        checkoutRow,
        config,
        data,
        dotyposReservation,
        orderId,
        run,
        session,
      }),
      id: "assert-recovered-status-page",
      timeoutMs: config.timeouts.uiTransition,
    });
    log("Late payment reservation recreation e2e passed");
  });
