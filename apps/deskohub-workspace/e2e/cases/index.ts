import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import {
  formatWorkspaceE2EAllocation,
  type WorkspaceE2EDateAllocation,
} from "../allocation";
import { getSubmitCoworkReservationScript } from "../browser-scripts";
import { workspaceE2EMaximumSameDateCoworkReservations } from "../capacity";
import {
  checkoutFlows,
  makeCoworkCheckoutData,
  requireCheckoutDate,
  selectCoworkDates,
} from "../checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { toWorkspaceE2EError, type WorkspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import {
  discountCodeFixtures,
  seedDiscountE2EFixtures,
} from "../integrations/discount-fixtures";
import type { Runner } from "../runtime";
import { log } from "../runtime";
import { E2ETelemetryService } from "../services/telemetry";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import { executeZeroTotalCheckout } from "./checkout-zero-total";
import { assertContactForm } from "./contact";
import { makeDiscountE2ECases, prepareDiscountE2E } from "./discounts";
import { assertLocaleSwitcher } from "./locale";
import { makeMeetingRoomE2ECases, prepareMeetingRoomE2E } from "./meeting-room";
import {
  assertPaymentTerminalPath,
  getPaymentTerminalScenarios,
} from "./payment-terminal";
import { assertReservationReplacement } from "./reservation-reuse";

export const makeWorkspaceE2ECases = ({
  allocation,
  config,
  datasourceConfig,
  flowStates,
  run,
}: {
  allocation: WorkspaceE2EDateAllocation;
  config: WorkspaceE2EConfig;
  datasourceConfig: DatasourceConfig;
  flowStates: CheckoutFlowState[];
  run: Runner;
}): Effect.Effect<
  readonly WorkspaceE2ECase[],
  WorkspaceE2EError,
  HttpClient.HttpClient | E2EDatabase | E2ETelemetryService
> =>
  Effect.gen(function* () {
    const telemetry = yield* E2ETelemetryService;
    log(`Using workspace e2e ${formatWorkspaceE2EAllocation(allocation)}`);
    const preparation = yield* Effect.all(
      {
        availability: Effect.all(
          {
            discounts: telemetry.tracePhase({
              effect: prepareDiscountE2E(config, datasourceConfig, allocation),
              phaseId: "cowork-availability-preparation",
            }),
            meetingRoom: telemetry.tracePhase({
              effect: prepareMeetingRoomE2E(config, allocation),
              phaseId: "meeting-room-availability-preparation",
            }),
          },
          { concurrency: "unbounded" }
        ),
        fixtures: telemetry.tracePhase({
          effect: seedDiscountE2EFixtures,
          phaseId: "fixture-seeding",
        }),
      },
      { concurrency: "unbounded" }
    );

    return yield* telemetry.tracePhase({
      effect: Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient;
        const terminalScenarios = getPaymentTerminalScenarios();
        const checkoutDates = yield* selectCoworkDates(
          preparation.availability.discounts.availableBasicDates,
          checkoutFlows.length + terminalScenarios.length + 2,
          {
            allocation,
            maximumReservationsPerDate:
              workspaceE2EMaximumSameDateCoworkReservations.basic,
            selectionLabel: "tier:basic",
          }
        );
        const cases: WorkspaceE2ECase[] = [
          {
            checkoutStates: [],
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
            checkoutStates: [],
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
            checkoutStates: [state],
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
                submitReservationScript: getSubmitCoworkReservationScript(data),
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
          checkoutStates: [reservationReplacementState],
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
                toWorkspaceE2EError(
                  "run reservation replacement e2e case",
                  cause
                )
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
          checkoutStates: [zeroTotalState],
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
            checkoutStates: [state],
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
            preparation: preparation.availability.meetingRoom,
            run,
          }))
        );

        cases.push(
          ...(yield* makeDiscountE2ECases({
            allocation,
            config,
            datasourceConfig,
            excludedDates: new Set(checkoutDates),
            flowStates,
            preparation: preparation.availability.discounts,
            run,
          }))
        );

        return cases;
      }),
      phaseId: "case-construction",
    });
  });

const trackCheckoutState = (
  flowStates: CheckoutFlowState[],
  data: CheckoutData
) => {
  const state: CheckoutFlowState = { data };
  flowStates.push(state);
  return state;
};
