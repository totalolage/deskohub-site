import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { getWorkspaceMeetingRoomPriceForDuration } from "@/features/checkout/product-catalog";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import type { WorkspaceE2EDateAllocation } from "../allocation";
import { waitForBrowserText } from "../browser";
import { getSubmitMeetingRoomReservationScript } from "../browser-scripts";
import {
  loadMeetingRoomAvailability,
  type MeetingRoomCheckoutSlot,
  makeMeetingRoomCheckoutData,
  reuseMeetingRoomCheckoutContact,
  selectAvailableMeetingRoomSlots,
} from "../checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import { discountCodeFixtures } from "../integrations/discount-fixtures";
import { pollUntil } from "../polling";
import type { Runner } from "../runtime";
import { assert, log } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2ECase,
} from "../types";
import { executeCheckoutFlow } from "./checkout";
import { executeZeroTotalCheckout } from "./checkout-zero-total";
import {
  assertPaymentTerminalPath,
  getPaymentTerminalScenarios,
} from "./payment-terminal";
import { assertReservationReplacement } from "./reservation-reuse";

const meetingRoomE2EDurations = [
  { unit: "hour", amount: 1 },
  { unit: "hour", amount: 4 },
  { unit: "hour", amount: 1 },
  { unit: "hour", amount: 4 },
  { unit: "hour", amount: 1 },
  { unit: "day", amount: 1 },
] as const satisfies readonly MeetingRoomReservationDuration[];

export type MeetingRoomE2EPreparation = {
  readonly slots: readonly MeetingRoomCheckoutSlot[];
};

export const prepareMeetingRoomE2E = (
  config: WorkspaceE2EConfig,
  allocation: WorkspaceE2EDateAllocation
): Effect.Effect<
  MeetingRoomE2EPreparation,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  selectAvailableMeetingRoomSlots(
    config,
    meetingRoomE2EDurations,
    allocation
  ).pipe(Effect.map((slots) => ({ slots })));

export const makeMeetingRoomE2ECases = ({
  config,
  datasourceConfig,
  flowStates,
  preparation,
  run,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly flowStates: CheckoutFlowState[];
  readonly preparation: MeetingRoomE2EPreparation;
  readonly run: Runner;
}): Effect.Effect<
  readonly WorkspaceE2ECase[],
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const { slots } = preparation;
    const [
      paidSlot,
      zeroTotalSlot,
      initialReplacementSlot,
      replacementSlot,
      cancelledSlot,
      daySlot,
    ] = slots;
    const requireSlot = (
      slot: (typeof slots)[number] | undefined,
      id: string
    ) =>
      tryWorkspaceE2ESync(`require ${id} meeting-room slot`, () => {
        assert(slot, `missing ${id} meeting-room slot`);
        return slot;
      });

    const paidData = makeMeetingRoomCheckoutData(
      config.baseUrl,
      yield* requireSlot(paidSlot, "paid"),
      "meeting-room-paid-one-hour"
    );
    const paidState = trackCheckoutState(flowStates, paidData);
    const zeroTotalData = makeMeetingRoomCheckoutData(
      config.baseUrl,
      yield* requireSlot(zeroTotalSlot, "zero-total"),
      "meeting-room-zero-total-four-hours"
    );
    const zeroTotalState = trackCheckoutState(flowStates, zeroTotalData);
    const replacementData = makeMeetingRoomCheckoutData(
      config.baseUrl,
      yield* requireSlot(initialReplacementSlot, "initial replacement"),
      "meeting-room-replacement"
    );
    const editedReplacementData = reuseMeetingRoomCheckoutContact(
      config.baseUrl,
      yield* requireSlot(replacementSlot, "edited replacement"),
      replacementData
    );
    const replacementState = trackCheckoutState(flowStates, replacementData);
    const cancelledData = makeMeetingRoomCheckoutData(
      config.baseUrl,
      yield* requireSlot(cancelledSlot, "cancelled"),
      "meeting-room-cancelled"
    );
    const cancelledState = trackCheckoutState(flowStates, cancelledData);
    const dayData = makeMeetingRoomCheckoutData(
      config.baseUrl,
      yield* requireSlot(daySlot, "whole-day"),
      "meeting-room-paid-whole-day"
    );
    const dayState = trackCheckoutState(flowStates, dayData);
    const cancelledScenario = yield* tryWorkspaceE2ESync(
      "select cancelled meeting-room payment scenario",
      () => {
        const scenario = getPaymentTerminalScenarios().find(
          ({ state }) => state === "cancelled"
        );
        assert(scenario, "cancelled payment scenario missing");
        return scenario;
      }
    );

    return [
      {
        checkoutStates: [paidState],
        execute: ({ runStep, session }) =>
          executeCheckoutFlow({
            config,
            data: paidData,
            datasourceConfig,
            flow: {
              id: "meeting-room-paid-one-hour",
              submitReservationScript: getSubmitMeetingRoomReservationScript,
            },
            payPageStep: () => ({
              execute: assertMeetingRoomPayPage(config, paidData, run, session),
              id: "assert-meeting-room-pay-summary",
              timeoutMs: config.timeouts.uiTransition,
            }),
            run,
            runStep,
            session,
            state: paidState,
          }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run paid meeting-room checkout e2e case",
                cause
              )
            )
          ),
        id: "checkout-meeting-room-paid-one-hour",
        timeoutMs: config.timeouts.checkoutCase,
      },
      {
        checkoutStates: [zeroTotalState],
        execute: ({ runStep, session }) =>
          executeZeroTotalCheckout({
            config,
            data: zeroTotalData,
            datasourceConfig,
            discountCode: discountCodeFixtures.zeroTotal.code,
            run,
            runStep,
            session,
            state: zeroTotalState,
            submitReservationScript:
              getSubmitMeetingRoomReservationScript(zeroTotalData),
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run zero-total meeting-room checkout e2e case",
                cause
              )
            )
          ),
        id: "checkout-meeting-room-zero-total-four-hours",
        timeoutMs: config.timeouts.zeroTotalCheckoutCase,
      },
      {
        checkoutStates: [replacementState],
        execute: ({ runStep, session }) =>
          assertReservationReplacement({
            config,
            data: replacementData,
            datasourceConfig,
            initialHoldStep: () => ({
              execute: assertMeetingRoomSlotUnavailable(
                config,
                replacementData
              ).pipe(Effect.provideService(HttpClient.HttpClient, httpClient)),
              id: "assert-held-meeting-room-slot-unavailable",
              timeoutMs: config.timeouts.datasource,
            }),
            replacementData: editedReplacementData,
            reservationPath: "/en-US/reservation/meeting-room",
            run,
            runStep,
            session,
            state: replacementState,
            submitReservationScript: getSubmitMeetingRoomReservationScript,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run meeting-room reservation replacement e2e case",
                cause
              )
            )
          ),
        id: "meeting-room-reservation-replacement",
        timeoutMs: config.timeouts.checkoutCase,
      },
      {
        checkoutStates: [cancelledState],
        execute: ({ runStep, session }) =>
          assertPaymentTerminalPath({
            config,
            data: cancelledData,
            datasourceConfig,
            reservationPath: "/en-US/reservation/meeting-room",
            run,
            runStep,
            scenario: cancelledScenario,
            session,
            state: cancelledState,
            submitReservationScript:
              getSubmitMeetingRoomReservationScript(cancelledData),
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run cancelled meeting-room payment e2e case",
                cause
              )
            )
          ),
        id: "payment-meeting-room-cancelled",
        timeoutMs: config.timeouts.paymentTerminalCase,
      },
      {
        checkoutStates: [dayState],
        execute: ({ runStep, session }) =>
          executeCheckoutFlow({
            config,
            data: dayData,
            datasourceConfig,
            flow: {
              id: "meeting-room-paid-whole-day",
              submitReservationScript: getSubmitMeetingRoomReservationScript,
            },
            payPageStep: () => ({
              execute: assertMeetingRoomPayPage(config, dayData, run, session),
              id: "assert-whole-day-meeting-room-pay-summary",
              timeoutMs: config.timeouts.uiTransition,
            }),
            run,
            runStep,
            session,
            state: dayState,
          }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run paid whole-day meeting-room checkout e2e case",
                cause
              )
            )
          ),
        id: "checkout-meeting-room-paid-whole-day",
        timeoutMs: config.timeouts.checkoutCase,
      },
    ];
  });

export const assertMeetingRoomSlotUnavailable = (
  config: WorkspaceE2EConfig,
  data: CheckoutData
): Effect.Effect<void, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const slot = yield* getMeetingRoomSlot(data);
    const availability = yield* pollUntil(
      loadMeetingRoomAvailability(config, slot).pipe(
        Effect.map((result) =>
          result.meetingRoomUnavailable ? result : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "held meeting-room slot availability",
        timeoutMs: config.timeouts.datasource,
      }
    );
    yield* tryWorkspaceE2ESync(
      "assert held meeting-room slot unavailable",
      () => {
        assert(
          availability.meetingRoomUnavailable,
          "held meeting-room slot remained publicly available"
        );
      }
    );
    log("Held meeting-room slot is unavailable");
  });

const assertMeetingRoomPayPage = (
  config: WorkspaceE2EConfig,
  data: CheckoutData,
  run: Runner,
  session: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const meetingRoom = yield* getMeetingRoomSlot(data);
    const durationTitle = isMeetingRoomWholeDayReservationDuration(
      meetingRoom.duration
    )
      ? "Meeting room - whole day"
      : `Meeting room - ${meetingRoom.duration.amount} ${
          meetingRoom.duration.amount === 1 ? "hour" : "hours"
        }`;
    const price = formatWorkspaceMoney(
      getWorkspaceMeetingRoomPriceForDuration(meetingRoom.duration),
      data.locale
    ).replaceAll(/\s+/g, " ");

    yield* waitForBrowserText({
      description: "meeting-room pay summary",
      matches: (text) => {
        const normalized = text.replaceAll(/\s+/g, " ");
        return (
          /Meeting Room/i.test(normalized) &&
          normalized.includes(durationTitle) &&
          normalized.includes(price)
        );
      },
      run,
      session,
      timeoutMs: config.timeouts.uiTransition,
    });
    log("Meeting-room pay summary validated");
  });

const getMeetingRoomSlot = (data: CheckoutData) =>
  tryWorkspaceE2ESync("read meeting-room checkout slot", () => {
    assert(data.meetingRoom, "meeting-room checkout interval missing");
    return {
      date: data.date,
      ...data.meetingRoom,
    };
  });

const trackCheckoutState = (
  flowStates: CheckoutFlowState[],
  data: CheckoutData
) => {
  const state: CheckoutFlowState = { data };
  flowStates.push(state);
  return state;
};
