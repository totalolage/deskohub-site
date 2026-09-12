import "../../shared/polyfills/temporal";

import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { NexiCorrelationIdSchema } from "@deskohub/nexi";
import { Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { makeMeetingRoomCheckoutData } from "../checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type {
  CheckoutFlowState,
  CheckoutRow,
  WorkspaceE2EStepRunner,
} from "../types";
import {
  assertHeldMeetingRoomReservation,
  assertMeetingRoomSlotAvailability,
  isMeetingRoomUnavailableFromInventory,
  type MeetingRoomE2EPreparation,
  makeMeetingRoomE2ECases,
} from "./meeting-room";

test("keeps the deployed E2E runner independent of generated translations", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./meeting-room.ts", import.meta.url))
  ).text();

  expect(source).not.toContain("product-catalog.i18n");
  expect(source).not.toContain("@/features/i18n");
});

test("keeps a held interval available while another meeting-room table is empty", () => {
  const slot = {
    date: "2099-09-01",
    duration: { unit: "hour", amount: 1 } as const,
    endsAt: "2099-09-01T09:00:00Z",
    startDateTime: "2099-09-01T10:00",
    startsAt: "2099-09-01T08:00:00Z",
  };
  const tables = [
    makeMeetingRoomTable("room-a"),
    makeMeetingRoomTable("room-b"),
  ];
  const reservations = [makeMeetingRoomReservation("room-a")];

  expect(
    Effect.runSync(
      isMeetingRoomUnavailableFromInventory({ reservations, slot, tables })
    )
  ).toBe(false);
});

test("validates an unpaid meeting-room hold without waiting for confirmation", () => {
  const slot = {
    date: "2099-09-01",
    duration: { unit: "hour", amount: 1 } as const,
    endsAt: "2099-09-01T09:00:00Z",
    startDateTime: "2099-09-01T10:00",
    startsAt: "2099-09-01T08:00:00Z",
  };

  expect(() =>
    assertHeldMeetingRoomReservation({
      expected: {
        customerId: DotyposCustomerIdSchema.make("customer-a"),
        reservationId: DotyposReservationIdSchema.make("reservation-a"),
        workspaceReservationId: workspaceReservationIdSchema.make(
          "workspace-reservation-a"
        ),
      },
      reservations: [makeMeetingRoomReservation("room-a")],
      slot,
      tables: [makeMeetingRoomTable("room-a")],
    })
  ).not.toThrow();
});

test("treats a held interval as unavailable when every meeting room is occupied", () => {
  const slot = {
    date: "2099-09-01",
    duration: { unit: "hour", amount: 1 } as const,
    endsAt: "2099-09-01T09:00:00Z",
    startDateTime: "2099-09-01T10:00",
    startsAt: "2099-09-01T08:00:00Z",
  };

  expect(
    Effect.runSync(
      isMeetingRoomUnavailableFromInventory({
        reservations: [makeMeetingRoomReservation("room-a")],
        slot,
        tables: [makeMeetingRoomTable("room-a")],
      })
    )
  ).toBe(true);
});

test("asserts the public interval availability expected from aggregate capacity", async () => {
  const interval = getMeetingRoomReservationInterval("2099-09-01T10:00", {
    unit: "hour",
    amount: 1,
  });
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    {
      date: "2099-09-01",
      duration: { unit: "hour", amount: 1 },
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    }
  );
  const config: WorkspaceE2EConfig = {
    baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    bypassSecret: undefined,
    expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    timeouts: { ...workspaceE2ETimeouts, datasource: 1 },
  };
  const fetchMock = mock(() =>
    Promise.resolve(
      Response.json({
        meetingRoomUnavailable: false,
        unavailableDates: [],
      })
    )
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, fetchMock as typeof globalThis.fetch)
    )
  );

  await expect(
    Effect.runPromise(
      assertMeetingRoomSlotAvailability(config, data, false).pipe(
        Effect.provide(httpClientLayer)
      )
    )
  ).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("runs reservation cookie isolation after paid support failure", async () => {
  const config: WorkspaceE2EConfig = {
    baseUrl: "https://deskohub-workspace-abc123xyz-deskohub.vercel.app",
    bypassSecret: undefined,
    expectedHost: "deskohub-workspace-abc123xyz-deskohub.vercel.app",
    timeouts: workspaceE2ETimeouts,
  };
  const flowStates: CheckoutFlowState[] = [];
  const fetchMock: typeof globalThis.fetch = () =>
    Promise.reject(
      new Error("provider HTTP must not execute in this case test")
    );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );
  const run: Runner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: "",
  });
  const cases = await Effect.runPromise(
    makeMeetingRoomE2ECases({
      config,
      datasourceConfig: {} as DatasourceConfig,
      flowStates,
      preparation: makeMeetingRoomTestPreparation(),
      run,
    }).pipe(Effect.provide(httpClientLayer))
  );
  const paidCase = cases.find(
    ({ id }) => id === "checkout-meeting-room-paid-one-hour"
  );
  expect(paidCase).toBeDefined();
  if (!paidCase) return;
  const paidState = paidCase.checkoutStates[0];
  expect(paidState).toBeDefined();
  if (!paidState) return;

  const paidRow = {
    checkout_attempt_key: checkoutAttemptKeySchema.make("paid-attempt"),
    checkout_session_key: checkoutSessionKeySchema.make("paid-session"),
    correlation_id: NexiCorrelationIdSchema.make("paid-correlation"),
    dotypos_customer_id: DotyposCustomerIdSchema.make("paid-customer"),
    fulfillment_state: "fulfilled",
    payment_state: "paid",
    reservation_id: workspaceReservationIdSchema.make("paid-order"),
  } as CheckoutRow;
  const observedSteps: string[] = [];
  let fulfillmentState: "fulfilled" | "failed" = "fulfilled";
  let replayCount = 0;
  let supportMutationCount = 0;
  let isolationAccepted = false;
  const runStep = ((step) => {
    observedSteps.push(step.id);
    if (step.id === "prepare-checkout-pay-page") {
      paidState.orderId = paidRow.reservation_id;
      return Effect.succeed(paidRow.reservation_id);
    }
    if (step.id === "read-provider-session-row") {
      return Effect.succeed(paidRow);
    }
    if (step.id === "validate-postgres-state") {
      paidState.checkoutRow = paidRow;
      return Effect.succeed(paidRow);
    }
    if (step.id === "replay-payment-webhook") {
      replayCount += 1;
      return Effect.void;
    }
    if (step.id === "mark-fulfillment-failed-for-support-path") {
      supportMutationCount += 1;
      fulfillmentState = "failed";
      return Effect.void;
    }
    if (step.id === "assert-reservation-cookie-isolation") {
      if (
        fulfillmentState !== "failed" ||
        paidRow.payment_state !== "paid" ||
        paidState.checkoutRow?.reservation_id !== paidRow.reservation_id
      ) {
        return Effect.fail(
          workspaceE2EError(
            "reservation cookie isolation ran before paid support failure state"
          )
        );
      }
      isolationAccepted = true;
    }
    return Effect.void;
  }) as WorkspaceE2EStepRunner;

  const exit = await Effect.runPromiseExit(
    paidCase.execute({
      runStep,
      session: "meeting-room-paid-test",
    }) as Effect.Effect<void, WorkspaceE2EError>
  );

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(isolationAccepted).toBe(true);
  expect(supportMutationCount).toBe(1);
  expect(replayCount).toBe(1);
  expect(flowStates).toHaveLength(5);
  expect(paidCase.checkoutStates).toHaveLength(1);
  expect(paidCase.checkoutStates[0]).toBe(flowStates[0]);
  expect(
    observedSteps.indexOf("assert-reservation-cookie-isolation")
  ).toBeGreaterThan(
    observedSteps.indexOf("mark-fulfillment-failed-for-support-path")
  );
});

const makeMeetingRoomTable = (id: string): Table => ({
  display: true,
  enabled: true,
  id,
  name: id,
  seats: "1",
  tags: ["reservation:meeting-room"],
});

const makeMeetingRoomReservation = (tableId: string): Reservation => ({
  _customerId: "customer-a",
  _tableId: tableId,
  endDate: "2099-09-01T09:00:00Z",
  id: "reservation-a",
  note: "Workspace reservation workspace-reservation-a",
  seats: "1",
  startDate: "2099-09-01T08:00:00Z",
  status: "NEW",
});

const meetingRoomTestDurations = [
  { unit: "hour", amount: 1 },
  { unit: "hour", amount: 4 },
  { unit: "hour", amount: 1 },
  { unit: "hour", amount: 4 },
  { unit: "hour", amount: 1 },
  { unit: "day", amount: 1 },
] as const satisfies readonly MeetingRoomReservationDuration[];

const makeMeetingRoomTestPreparation = (): MeetingRoomE2EPreparation => ({
  slots: meetingRoomTestDurations.map((duration, index) => {
    const date = `2099-09-${String(index + 1).padStart(2, "0")}`;
    const startDateTime = `${date}T10:00`;
    const interval = getMeetingRoomReservationInterval(startDateTime, duration);
    if (!interval) throw new Error("meeting-room test interval is invalid");
    return { date, duration, startDateTime, ...interval };
  }),
});
