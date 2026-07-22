import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import {
  checkoutFlows,
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectAvailableCoworkDates,
} from "../checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { toWorkspaceE2EError, type WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { log } from "../runtime";
import { getWorkspaceE2ETimeoutMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import { assertContactForm } from "./contact";
import { assertLocaleSwitcher } from "./locale";
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
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const terminalScenarios = getPaymentTerminalScenarios();
    const checkoutDates = yield* selectAvailableCoworkDates(
      config,
      checkoutFlows.length + terminalScenarios.length + 1
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
        timeoutMs: getWorkspaceE2ETimeoutMs("localeCase"),
      },
      {
        execute: ({ runStep, session }) =>
          assertContactForm({ config, run, runStep, session }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run contact form e2e case", cause)
            )
          ),
        id: "contact-form",
        timeoutMs: getWorkspaceE2ETimeoutMs("contactCase"),
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
            run,
            runStep,
            scenario,
            session,
            state,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                `run ${scenario.state} payment e2e case`,
                cause
              )
            )
          ),
        id: `payment-${scenario.state}`,
        timeoutMs: getWorkspaceE2ETimeoutMs("paymentTerminalCase"),
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
          run,
          runStep,
          session,
          state: reservationReplacementState,
        }).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("run reservation replacement e2e case", cause)
          )
        ),
      id: "reservation-replacement",
      timeoutMs: getWorkspaceE2ETimeoutMs("checkoutCase"),
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
        timeoutMs: getWorkspaceE2ETimeoutMs("checkoutCase"),
      });
    }

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
