import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { getSubmitCoworkReservationScript } from "../browser-scripts";
import {
  checkoutFlows,
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectAvailableCoworkDates,
} from "../checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { toWorkspaceE2EError, type WorkspaceE2EError } from "../errors";
import {
  discountCodeFixtures,
  seedDiscountE2EFixtures,
} from "../integrations/discount-fixtures";
import type { E2EDatabase } from "../integrations/database.service";
import type { Runner } from "../runtime";
import { log } from "../runtime";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import { executeZeroTotalCheckout } from "./checkout-zero-total";
import { assertContactForm } from "./contact";
import { makeDiscountE2ECases } from "./discounts";
import { assertLocaleSwitcher } from "./locale";
import { makeMeetingRoomE2ECases } from "./meeting-room";
import {
  assertPaymentTerminalPath,
  getPaymentTerminalScenarios,
} from "./payment-terminal";
import { assertReservationReplacement } from "./reservation-reuse";

export const makeWorkspaceE2ECases = ({
  config,
  datasourceConfig,
  flowStates,
  run,
}: {
  config: WorkspaceE2EConfig;
  datasourceConfig: DatasourceConfig;
  flowStates: CheckoutFlowState[];
  run: Runner;
}): Effect.Effect<
  readonly WorkspaceE2ECase[],
  WorkspaceE2EError,
  HttpClient.HttpClient | E2EDatabase
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    yield* seedDiscountE2EFixtures;
    const terminalScenarios = getPaymentTerminalScenarios();
    const checkoutDates = yield* selectAvailableCoworkDates(
      config,
      checkoutFlows.length + terminalScenarios.length + 2
    );
    const cases: WorkspaceE2ECase[] = [
      {
        execute: ({ runStep, session }) =>
          assertLocaleSwitcher({ config, run, runStep, session }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run locale switch e2e case", cause)
            )
          ),
        id: "locale-switch",
        timeoutMs: config.timeouts.localeCase,
      },
      {
        execute: ({ runStep, session }) =>
          assertContactForm({ config, run, runStep, session }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run contact form e2e case", cause)
            )
          ),
        id: "contact-form",
        timeoutMs: config.timeouts.contactCase,
      },
    ];
    let nextDateIndex = 0;

    for (const scenario of terminalScenarios) {
      const date = yield* requireCheckoutDate(checkoutDates, nextDateIndex);
      const data = makeCoworkCheckoutData(
        config.baseUrl,
        date,
        `cowork-${scenario.state}`
      );
      nextDateIndex += 1;
      const state = trackCheckoutState(flowStates, data);
      cases.push({
        execute: ({ runStep, session }) =>
          assertPaymentTerminalPath({
            config,
            data,
            datasourceConfig,
            reservationPath: "/en-US/reservation/cowork",
            run,
            runStep,
            scenario,
            session,
            state,
            submitReservationScript:
              getSubmitCoworkReservationScript(data),
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                `run ${scenario.state} payment e2e case`,
                cause
              )
            )
          ),
        id: `payment-${scenario.state}`,
        timeoutMs: config.timeouts.paymentTerminalCase,
      });
    }

    const reservationReplacementDate = yield* requireCheckoutDate(
      checkoutDates,
      nextDateIndex
    );
    const reservationReplacementData = makeCoworkCheckoutData(
      config.baseUrl,
      reservationReplacementDate,
      "cowork-reservation-replacement"
    );
    nextDateIndex += 1;
    const reservationReplacementState = trackCheckoutState(
      flowStates,
      reservationReplacementData
    );
    cases.push({
      execute: ({ runStep, session }) =>
        assertReservationReplacement({
          config,
          data: reservationReplacementData,
          datasourceConfig,
          replacementData: reservationReplacementData,
          reservationPath: "/en-US/reservation/cowork",
          run,
          runStep,
          session,
          state: reservationReplacementState,
          submitReservationScript: getSubmitCoworkReservationScript,
        }).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run reservation replacement e2e case", cause)
          )
        ),
      id: "reservation-replacement",
      timeoutMs: config.timeouts.checkoutCase,
    });

    const zeroTotalDate = yield* requireCheckoutDate(
      checkoutDates,
      nextDateIndex
    );
    const zeroTotalData = makeCoworkCheckoutData(
      config.baseUrl,
      zeroTotalDate,
      "cowork-zero-total"
    );
    nextDateIndex += 1;
    const zeroTotalState = trackCheckoutState(flowStates, zeroTotalData);
    cases.push({
      execute: ({ runStep, session }) =>
        executeZeroTotalCheckout({
          config,
          data: zeroTotalData,
          datasourceConfig,
          run,
          runStep,
          session,
          state: zeroTotalState,
          submitReservationScript:
            getSubmitCoworkReservationScript(zeroTotalData),
          discountCode: discountCodeFixtures.zeroTotal.code,
        }).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run zero-total checkout e2e case", cause)
          )
        ),
      id: "checkout-zero-total",
      timeoutMs: config.timeouts.zeroTotalCheckoutCase,
    });

    for (const flow of checkoutFlows) {
      const date = yield* requireCheckoutDate(checkoutDates, nextDateIndex);
      const data = yield* flow.makeData(config, datasourceConfig, date);
      nextDateIndex += 1;
      if (!data) {
        log(`${flow.id} checkout e2e skipped`);
        continue;
      }

      const state = trackCheckoutState(flowStates, data);
      cases.push({
        execute: ({ runStep, session }) =>
          executeCheckoutFlow({
            config,
            data,
            datasourceConfig,
            flow,
            run,
            runStep,
            session,
            state,
          }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.mapError((cause) =>
              toWorkspaceE2EError(`run ${flow.id} checkout e2e case`, cause)
            )
          ),
        id: `checkout-${flow.id}`,
        timeoutMs: config.timeouts.checkoutCase,
      });
    }

    cases.push(
      ...(yield* makeMeetingRoomE2ECases({
        config,
        datasourceConfig,
        flowStates,
        run,
      }))
    );

    cases.push(
      ...(yield* makeDiscountE2ECases({
        config,
        datasourceConfig,
        excludedDates: new Set(checkoutDates),
        flowStates,
        run,
      }))
    );

    return cases;
  });

const trackCheckoutState = (
  flowStates: CheckoutFlowState[],
  data: CheckoutData
) => {
  const state: CheckoutFlowState = { data };
  flowStates.push(state);
  return state;
};
