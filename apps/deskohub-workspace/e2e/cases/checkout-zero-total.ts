import { Effect } from "effect";
import {
  openBrowserPage,
  switchToBrowserTab,
  waitForBrowserUrl,
} from "../browser";
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
  appliedMessage = "Discount code applied: 100% off 🎉",
  stepIdPrefix = "",
}: {
  readonly appliedMessage?: string;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly run: Runner;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly session: string;
  readonly state: CheckoutFlowState;
  readonly submitReservationScript: string;
  readonly discountCode: string;
  readonly stepIdPrefix?: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const stepId = (id: string) => `${stepIdPrefix}${id}`;
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: Effect.gen(function* () {
        yield* openBrowserPage(config, run, session, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          run,
          session,
          submitReservationScript,
          timeouts: config.timeouts,
        });
      }),
      id: stepId("prepare-zero-total-pay-page"),
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: applyZeroTotalCode(
        config,
        discountCode,
        appliedMessage,
        run,
        session
      ),
      id: stepId("apply-zero-total-code"),
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: submitCheckoutPayment(run, session).pipe(
        Effect.flatMap((checkoutTabId) =>
          switchToBrowserTab(run, session, checkoutTabId)
        ),
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
      id: stepId("complete-internal-payment"),
      timeoutMs: config.timeouts.providerTransition,
    });
    yield* runStep({
      execute: markPreviewFulfillmentDeliveredForE2E(datasourceConfig, orderId),
      id: stepId("complete-zero-total-fulfillment"),
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
      id: stepId("validate-internal-postgres-state"),
      timeoutMs: config.timeouts.datasource,
    });
    state.checkoutRow = checkoutRow;
    const dotyposReservation = yield* runStep({
      execute: validateDotypos(datasourceConfig, data, checkoutRow),
      id: stepId("validate-zero-total-dotypos"),
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
      id: stepId("assert-zero-total-fulfilled-status"),
      timeoutMs: config.timeouts.uiTransition,
    });
    log(`zero-total checkout e2e passed for order ${orderId}`);
  });

const applyZeroTotalCode = (
  config: WorkspaceE2EConfig,
  discountCode: string,
  appliedMessage: string,
  run: Runner,
  session: string
) =>
  applyDiscountCode({
    appliedMessage,
    code: discountCode,
    config,
    run,
    session,
  });
