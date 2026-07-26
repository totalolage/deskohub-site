import { Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import {
  getWorkspaceMeetingRoomPriceForDuration,
} from "@/features/checkout/product-catalog";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  getPrepareMeetingRoomAdvertisedPriceScript,
  getSubmitMeetingRoomReservationScript,
} from "../browser-scripts";
import {
  evalBrowserScript,
  openBrowserPage,
  waitForBrowserText,
} from "../browser";
import {
  loadMeetingRoomAvailability,
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

export const makeMeetingRoomE2ECases = ({
  config,
  datasourceConfig,
  flowStates,
  run,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly datasourceConfig: DatasourceConfig;
  readonly flowStates: CheckoutFlowState[];
  readonly run: Runner;
}): Effect.Effect<
  readonly WorkspaceE2ECase[],
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const slots = yield* selectAvailableMeetingRoomSlots(config, [
      60,
      240,
      60,
      240,
      60,
      1440,
    ]);
    const [
      paidSlot,
      zeroTotalSlot,
      initialReplacementSlot,
      replacementSlot,
      cancelledSlot,
      daySlot,
    ] = slots;
    const requireSlot = (slot: (typeof slots)[number] | undefined, id: string) =>
      tryWorkspaceE2ESync(`require ${id} meeting-room slot`, () => {
        assert(slot, `missing ${id} meeting-room slot`);
        return slot;
      });

    const paidData = makeMeetingRoomCheckoutData(
      config.baseUrl,
      yield* requireSlot(paidSlot, "paid"),
      "meeting-room-paid-60"
    );
    const paidState = trackCheckoutState(flowStates, paidData);
    const zeroTotalData = makeMeetingRoomCheckoutData(
      config.baseUrl,
      yield* requireSlot(zeroTotalSlot, "zero-total"),
      "meeting-room-zero-total-240"
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
      yield* requireSlot(daySlot, "24-hour"),
      "meeting-room-advertised-1440"
    );
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
        execute: ({ runStep, session }) =>
          executeCheckoutFlow({
            config,
            data: paidData,
            datasourceConfig,
            flow: {
              id: "meeting-room-paid-60",
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
        id: "checkout-meeting-room-paid-60",
        timeoutMs: config.timeouts.checkoutCase,
      },
      {
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
        id: "checkout-meeting-room-zero-total-240",
        timeoutMs: config.timeouts.zeroTotalCheckoutCase,
      },
      {
        execute: ({ runStep, session }) =>
          assertReservationReplacement({
            config,
            data: replacementData,
            datasourceConfig,
            initialHoldStep: () => ({
              execute: assertMeetingRoomSlotUnavailable(
                config,
                replacementData
              ).pipe(
                Effect.provideService(HttpClient.HttpClient, httpClient)
              ),
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
        execute: ({ runStep, session }) =>
          assertMeetingRoomDayOption({
            config,
            data: dayData,
            run,
            runStep,
            session,
          }).pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError(
                "run 24-hour meeting-room advertisement e2e case",
                cause
              )
            )
          ),
        id: "meeting-room-advertised-1440",
        timeoutMs: config.timeouts.checkoutStart,
      },
    ];
  });

export const assertMeetingRoomSlotUnavailable = (
  config: WorkspaceE2EConfig,
  data: CheckoutData
): Effect.Effect<
  void,
  WorkspaceE2EError,
  HttpClient.HttpClient
> =>
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
    const durationTitle = getWorkspaceMeetingRoomDurationTitle(
      meetingRoom.durationMinutes,
      data.locale
    );
    const price = formatWorkspaceMoney(
      getWorkspaceMeetingRoomPriceForDuration(meetingRoom.durationMinutes),
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

const assertMeetingRoomDayOption = ({
  config,
  data,
  run,
  runStep,
  session,
}: {
  readonly config: WorkspaceE2EConfig;
  readonly data: CheckoutData;
  readonly run: Runner;
  readonly runStep: Parameters<WorkspaceE2ECase["execute"]>[0]["runStep"];
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* runStep({
      execute: openBrowserPage(config, run, session, data.checkoutUrl, {
        timeoutMs: config.timeouts.browserNavigation,
      }).pipe(Effect.asVoid),
      id: "open-24-hour-meeting-room-form",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: evalBrowserScript(
        "prepare 24-hour meeting-room advertised price",
        run,
        session,
        getPrepareMeetingRoomAdvertisedPriceScript(data),
        { timeoutMs: config.timeouts.browserAction }
      ).pipe(Effect.asVoid),
      id: "prepare-24-hour-meeting-room-advertisement",
      timeoutMs: config.timeouts.checkoutStart,
    });
    yield* runStep({
      execute: waitForBrowserText({
        description: "24-hour meeting-room advertised price",
        matches: (text) =>
          /24 hours/i.test(text) && /CZK/i.test(text) && /1[,\s]000/.test(text),
        run,
        session,
        timeoutMs: config.timeouts.uiTransition,
      }),
      id: "assert-24-hour-meeting-room-advertisement",
      timeoutMs: config.timeouts.uiTransition,
    });
    log("24-hour meeting-room option is available and priced");
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
