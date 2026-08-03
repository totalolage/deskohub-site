import { Effect } from "effect";
import { openBrowserPage, waitForBrowserUrl } from "../browser";
import { applyDiscountCode } from "../checkout/discount-code";
import {
  submitCheckoutPayment,
  submitReservationForPayPage,
} from "../checkout/payment";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  markPreviewFulfillmentDeliveredForE2E,
  validateInternalPostgres,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import { validateDotypos } from "../integrations/dotypos";
import type { Runner } from "../runtime";
import { log } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2EStepRunner,
} from "../types";
import { isExpectedCheckoutStatusUrl } from "../urls";
import { assertFulfilledStatusPage } from "./checkout";

export const executeZeroTotalCheckout = ({
  config,
  data,
  datasourceConfig,
  run,
  runStep,
  session,
  state,
  submitReservationScript,
  discountCode,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
  readonly submitReservationScript: string;
  readonly discountCode: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    state.startedAt = new Date();
    yield* runStep({
      execute: openBrowserPage(config, run, session, data.checkoutUrl, {
        timeoutMs: config.timeouts.browserNavigation,
      }).pipe(Effect.asVoid),
      id: "open-zero-total-checkout",
      timeoutMs: config.timeouts.browserNavigation,
    });
    const orderId = yield* runStep({
      execute: submitReservationForPayPage({
        onOrderId: (startedOrderId) => {
          state.orderId = startedOrderId;
        },
        run,
        session,
        submitReservationScript,
        timeouts: config.timeouts,
      }),
      id: "prepare-zero-total-pay-page",
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: applyZeroTotalCode(config, discountCode, run, session),
      id: "apply-zero-total-code",
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: submitCheckoutPayment(run, session).pipe(
        Effect.andThen(
          waitForBrowserUrl({
            description: "zero-total checkout status page",
            matches: (url) =>
              isExpectedCheckoutStatusUrl(url, config.expectedHost),
            run,
            session,
            timeoutMs: config.timeouts.providerTransition,
          })
        ),
        Effect.asVoid
      ),
      id: "complete-internal-payment",
      timeoutMs: config.timeouts.providerTransition,
    });
    yield* runStep({
      execute: markPreviewFulfillmentDeliveredForE2E(datasourceConfig, orderId),
      id: "complete-zero-total-fulfillment",
      timeoutMs: config.timeouts.datasource,
    });
    const checkoutRow = yield* runStep({
      execute: validateInternalPostgres(
        datasourceConfig,
        data,
        orderId,
        (row) => {
          state.checkoutRow = row;
        }
      ),
      id: "validate-internal-postgres-state",
      timeoutMs: config.timeouts.datasource,
    });
    state.checkoutRow = checkoutRow;
    const dotyposReservation = yield* runStep({
      execute: validateDotypos(datasourceConfig, data, checkoutRow),
      id: "validate-zero-total-dotypos",
      timeoutMs: config.timeouts.datasource,
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
      id: "assert-zero-total-fulfilled-status",
      timeoutMs: config.timeouts.uiTransition,
    });
    log(`zero-total checkout e2e passed for order ${orderId}`);
  });

const applyZeroTotalCode = (
  config: WorkspaceE2EConfig,
  discountCode: string,
  run: Runner,
  session: string
) =>
  applyDiscountCode({
    appliedMessage: "Discount code applied: 100% off 🎉",
    code: discountCode,
    config,
    run,
    session,
  });
