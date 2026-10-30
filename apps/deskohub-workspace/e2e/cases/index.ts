import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import { workspaceE2EMaximumSameDateCoworkReservations } from "../capacity";
import {
  checkoutFlows,
  makeCoworkCheckoutData,
  requireCheckoutDate,
  reuseCoworkCheckoutContact,
  selectCoworkDates,
} from "../checkout/data";
import {
  toReservationSelectionPreparation,
  toReservationStep,
} from "../checkout/reservation-form-preparation";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { toWorkspaceE2EError, type WorkspaceE2EError } from "../errors";
import { discountCodeFixtures } from "../integrations/discount-fixtures";
import type { E2EDotyposDiscountGroup } from "../integrations/dotypos";
import { planWorkspaceE2EReferralCases } from "../referrals/plan";
import { log } from "../runtime";
import { E2ETelemetryService } from "../services/telemetry";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import { planAgentBookingCase } from "./agent-booking";
import { executeCheckoutFlow } from "./checkout";
import { executeZeroTotalCheckout } from "./checkout-zero-total";
import { assertContactForm } from "./contact";
import {
  type DiscountAvailabilityE2EPreparation,
  makeDiscountE2ECases,
} from "./discounts";
import {
  executeLatePaymentRecovery,
  latePaymentRecoveryScenarios,
} from "./late-payment-recovery";
import { assertLocaleSwitcher } from "./locale";
import {
  type MeetingRoomE2EPreparation,
  makeMeetingRoomE2ECases,
} from "./meeting-room";
import { makeOfficeE2ECases, type OfficeE2EPreparation } from "./office";
import {
  assertPaymentTerminalPath,
  getPaymentTerminalScenarios,
} from "./payment-terminal";
import { planReferralSomeoneElsePaymentCase } from "./referral-someone-else-payment";
import { makeReservationLinkE2ECases } from "./reservation-links";
import { assertReservationReplacement } from "./reservation-reuse";
import { makeReservationUrlStateE2ECases } from "./reservation-url-state";
import { planSignedOutVerificationCase } from "./signed-out-verification";

export type WorkspaceE2EPreparation = {
  readonly customerDiscountGroup: E2EDotyposDiscountGroup;
  readonly discounts: DiscountAvailabilityE2EPreparation;
  readonly meetingRoom: MeetingRoomE2EPreparation;
  readonly office: OfficeE2EPreparation | undefined;
};

export const makeWorkspaceE2ECases = ({
  allocation,
  config,
  datasourceConfig,
  flowStates,
  preparation,
  traceConstruction = true,
}: {
  allocation: WorkspaceE2EDateAllocation;
  config: WorkspaceE2EConfig;
  datasourceConfig: DatasourceConfig;
  flowStates: CheckoutFlowState[];
  preparation: WorkspaceE2EPreparation;
  traceConstruction?: boolean;
}): Effect.Effect<
  readonly WorkspaceE2ECase[],
  WorkspaceE2EError,
  HttpClient.HttpClient | E2ETelemetryService
> =>
  Effect.gen(function* () {
    const discountPreparation = {
      ...preparation.discounts,
      customerDiscountGroup: preparation.customerDiscountGroup,
    };

    const construction = Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const terminalScenarios = getPaymentTerminalScenarios();
      const checkoutDates = yield* selectCoworkDates(
        discountPreparation.availableBasicDates,
        checkoutFlows.length +
          terminalScenarios.length +
          latePaymentRecoveryScenarios.length +
          3,
        {
          allocation,
          maximumReservationsPerDate:
            workspaceE2EMaximumSameDateCoworkReservations["open-space"],
          selectionLabel: "open-space",
        }
      );
      const cases: WorkspaceE2ECase[] = [
        {
          checkoutStates: [],
          execute: ({ run, runStep, session }) =>
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
          execute: ({ run, runStep, session }) =>
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
          execute: ({ run, runStep, session }) =>
            assertPaymentTerminalPath({
              config,
              data,
              reservationPath: "/en-US/reservation/cowork",
              run,
              runStep,
              scenario,
              session,
              state,
              preparation: toReservationStep(data),
            }).pipe(
              Effect.mapError((cause) =>
                toWorkspaceE2EError(
                  `run ${scenario.state} payment e2e case`,
                  cause
                )
              )
            ),
          id: scenario.id,
          // A real hosted payment may take the sandbox restart.
          timeoutMs:
            scenario.trigger === "injected"
              ? config.timeouts.paymentTerminalCase
              : config.timeouts.checkoutCase,
        });
      }

      for (const scenario of latePaymentRecoveryScenarios) {
        const date = yield* requireCheckoutDate(checkoutDates, nextDateIndex);
        const data = makeCoworkCheckoutData(config.baseUrl, date, scenario.id);
        nextDateIndex += 1;
        const state = trackCheckoutState(flowStates, data);
        cases.push({
          checkoutStates: [state],
          execute: ({ run, runStep, session }) =>
            executeLatePaymentRecovery({
              config,
              data,
              datasourceConfig,
              run,
              runStep,
              scenario,
              session,
              state,
              preparation: toReservationStep(data),
            }).pipe(
              Effect.provideService(HttpClient.HttpClient, httpClient),
              Effect.mapError((cause) =>
                toWorkspaceE2EError(`run ${scenario.id} e2e case`, cause)
              )
            ),
          id: scenario.id,
          timeoutMs: config.timeouts.checkoutCase * 2,
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
      const editedReservationReplacementDates = yield* selectCoworkDates(
        discountPreparation.availableBasicDates,
        1,
        {
          allocation,
          excludedDates: new Set([reservationReplacementDate]),
          selectionLabel: "reservation-replacement",
        }
      );
      const editedReservationReplacementDate = yield* requireCheckoutDate(
        editedReservationReplacementDates,
        0
      );
      const editedReservationReplacementData = reuseCoworkCheckoutContact(
        config.baseUrl,
        editedReservationReplacementDate,
        reservationReplacementData
      );
      const reservationReplacementState = trackCheckoutState(
        flowStates,
        reservationReplacementData
      );
      cases.push({
        checkoutStates: [reservationReplacementState],
        execute: ({ run, runStep, session }) =>
          assertReservationReplacement({
            config,
            data: reservationReplacementData,
            datasourceConfig,
            toSelectionPreparation: toReservationSelectionPreparation,
            replacementData: editedReservationReplacementData,
            reservationPath: "/en-US/reservation/cowork",
            run,
            runStep,
            session,
            state: reservationReplacementState,
            toReservationPreparation: toReservationStep,
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
        checkoutStates: [zeroTotalState],
        execute: ({ run, runStep, session }) =>
          executeZeroTotalCheckout({
            config,
            data: zeroTotalData,
            datasourceConfig,
            run,
            runStep,
            session,
            state: zeroTotalState,
            preparation: toReservationStep(zeroTotalData),
            discountCode: discountCodeFixtures.zeroTotal.code,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run zero-total checkout e2e case", cause)
            )
          ),
        id: "checkout-zero-total",
        timeoutMs: config.timeouts.zeroTotalCheckoutCase,
      });

      // The automation journey books its own zero-total reservation; its
      // binder wraps this checkout in the admin flow and the engine waits.
      const automationDate = yield* requireCheckoutDate(
        checkoutDates,
        nextDateIndex
      );
      const automationData = makeCoworkCheckoutData(
        config.baseUrl,
        automationDate,
        "cowork-automation"
      );
      nextDateIndex += 1;
      const automationState = trackCheckoutState(flowStates, automationData);
      cases.push({
        checkoutStates: [automationState],
        execute: ({ run, runStep, session }) =>
          executeZeroTotalCheckout({
            config,
            data: automationData,
            datasourceConfig,
            run,
            runStep,
            session,
            state: automationState,
            stepIdPrefix: "automation-",
            preparation: toReservationStep(automationData),
            discountCode: discountCodeFixtures.zeroTotal.code,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("run automation reservation checkout", cause)
            )
          ),
        id: "automation-reservation-booked",
        timeoutMs: config.timeouts.automationReservationCase,
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
          execute: ({ run, runStep, session }) =>
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

      const referralPlan = yield* planWorkspaceE2EReferralCases({
        allocation,
        availableBasicDates: discountPreparation.availableBasicDates,
        config,
        excludedDates: new Set(checkoutDates),
        trackCheckoutState: (data) => trackCheckoutState(flowStates, data),
      });
      cases.push(...referralPlan.cases);

      cases.push(
        ...(yield* makeMeetingRoomE2ECases({
          config,
          datasourceConfig,
          flowStates,
          preparation: preparation.meetingRoom,
        }))
      );

      cases.push(
        ...(yield* makeReservationLinkE2ECases({
          config,
          datasourceConfig,
          flowStates,
          preparation: preparation.meetingRoom,
        }))
      );

      cases.push(
        ...(yield* makeReservationUrlStateE2ECases({
          allocation,
          config,
          datasourceConfig,
          preparation: {
            discounts: discountPreparation,
            meetingRoom: preparation.meetingRoom,
            office: preparation.office,
          },
        }))
      );

      cases.push(
        ...(yield* makeOfficeE2ECases({
          config,
          datasourceConfig,
          flowStates,
          preparation: preparation.office,
        }))
      );

      cases.push(
        ...(yield* makeDiscountE2ECases({
          allocation,
          config,
          datasourceConfig,
          excludedDates: new Set([...checkoutDates, ...referralPlan.dates]),
          flowStates,
          preparation: discountPreparation,
        }))
      );

      cases.push(
        yield* planReferralSomeoneElsePaymentCase({
          allocation,
          availableBasicDates: discountPreparation.availableBasicDates,
          config,
          flowStates,
        })
      );

      cases.push(
        yield* planSignedOutVerificationCase({
          allocation,
          availableBasicDates: discountPreparation.availableBasicDates,
          config,
          flowStates,
        })
      );

      cases.push(
        yield* planAgentBookingCase({
          allocation,
          availableBasicDates: discountPreparation.availableBasicDates,
          config,
          flowStates,
        })
      );

      return cases;
    });

    if (!traceConstruction) return yield* construction;
    const telemetry = yield* E2ETelemetryService;
    return yield* telemetry.tracePhase({
      effect: construction,
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
