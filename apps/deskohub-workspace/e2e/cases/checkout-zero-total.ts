import { Effect } from "effect";
import { openPage, waitForPageUrl } from "../browser";
import type { OpenE2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import { applyDiscountCode } from "../checkout/discount-code";
import {
  submitCheckoutPayment,
  submitReservationForPayPage,
} from "../checkout/payment";
import type { ReservationFormPreparation } from "../checkout/reservation-form-preparation";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  markPreviewFulfillmentDeliveredForE2E,
  validateInternalPostgres,
} from "../integrations/database";
import type { E2EDatabase } from "../integrations/database.service";
import { validateDotypos } from "../integrations/dotypos";
import { log } from "../runtime";
import type { CheckoutData, CheckoutFlowState } from "../types";
import { isExpectedCheckoutStatusUrl } from "../urls";
import { assertFulfilledStatusPage } from "./checkout";

export const executeZeroTotalCheckout = ({
  config,
  data,
  datasourceConfig,
  runStep,
  openSession,
  state,
  preparation,
  discountCode,
  appliedMessage = "Promotion applied: 100% off 🎉",
  stepIdPrefix = "",
}: {
  readonly appliedMessage?: string;
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly datasourceConfig: DatasourceConfig;
  readonly runStep: WorkspaceE2EStepRunner;
  readonly openSession: OpenE2EBrowserSession;
  readonly state: CheckoutFlowState;
  readonly preparation: ReservationFormPreparation;
  readonly discountCode: string;
  readonly stepIdPrefix?: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const stepId = (id: string) => `${stepIdPrefix}${id}`;
    state.startedAt = new Date();
    const orderId = yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* openSession;
        yield* openPage(browser, config, data.checkoutUrl, {
          timeoutMs: config.timeouts.browserNavigation,
        });
        return yield* submitReservationForPayPage({
          data,
          onOrderId: (startedOrderId) => {
            state.orderId = startedOrderId;
          },
          preparation,
          session: browser,
          timeouts: config.timeouts,
        });
      }),
      id: stepId("prepare-zero-total-pay-page"),
      timeoutMs: config.timeouts.checkoutStart,
    });
    state.orderId = orderId;
    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* openSession;
        yield* applyDiscountCode({
          appliedMessage,
          code: discountCode,
          config,
          session: browser,
        });
      }),
      id: stepId("apply-zero-total-code"),
      timeoutMs: config.timeouts.uiTransition,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        const browser = yield* openSession;
        const checkoutPage = yield* submitCheckoutPayment(
          browser,
          config.timeouts
        );
        yield* browser.activate(checkoutPage);
        yield* waitForPageUrl({
          description: "zero-total checkout status page",
          matches: (url) =>
            isExpectedCheckoutStatusUrl(url, config.expectedHost),
          session: browser,
          timeoutMs: config.timeouts.providerTransition,
        });
      }),
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
        openSession,
      }),
      id: stepId("assert-zero-total-fulfilled-status"),
      timeoutMs: config.timeouts.uiTransition,
    });
    log(`zero-total checkout e2e passed for order ${orderId}`);
  });
