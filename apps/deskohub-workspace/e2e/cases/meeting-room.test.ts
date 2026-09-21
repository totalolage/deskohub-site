import "../../shared/polyfills/temporal";

import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { makeMeetingRoomCheckoutData } from "../checkout/data";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { workspaceE2ENonPaymentCaseIds } from "../playwright-checkout/case-catalog";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutFlowState } from "../types";
import {
  assertHeldMeetingRoomReservation,
  assertMeetingRoomSlotAvailability,
  isMeetingRoomUnavailableFromInventory,
  meetingRoomE2ECoreSlotCount,
  meetingRoomE2EDurations,
} from "./meeting-room";
import { makeReservationLinkE2ECases } from "./reservation-links";

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
  let fetchCallCount = 0;
  const fetchMock: typeof globalThis.fetch = (_input, _init) => {
    fetchCallCount += 1;
    return Promise.resolve(
      Response.json({
        meetingRoomUnavailable: false,
        unavailableDates: [],
      })
    );
  };
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );

  await expect(
    Effect.runPromise(
      assertMeetingRoomSlotAvailability(config, data, false).pipe(
        Effect.provide(httpClientLayer)
      )
    )
  ).resolves.toBeUndefined();
  expect(fetchCallCount).toBe(1);
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

const linkCaseConfig: WorkspaceE2EConfig = {
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: undefined,
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
};

const linkCaseDatasourceConfig: DatasourceConfig = {
  databaseUrl: "postgresql://preview.example.test/workspace",
  databaseUrlUnpooled: "postgresql://preview-direct.example.test/workspace",
  dotypos: {
    apiTimeout: 5_000,
    apiUrl: "https://dotypos.example.test",
    branchId: "branch",
    clientId: "client",
    clientSecret: "client-secret",
    cloudId: "cloud",
    employeeId: "employee",
    refreshToken: "refresh-token",
  },
  expectedCurrency: "EUR",
  nexiApiOrigin: "https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp",
  timeouts: workspaceE2ETimeouts,
};

const linkCaseRunner: Runner = async () => ({
  exitCode: 0,
  stderr: "",
  stdout: "",
});

const makeReservationLinkPreparationSlot = (index: number) => {
  const day = String(index + 1).padStart(2, "0");
  const date = `2099-09-${day}`;
  const startDateTime = `${date}T10:00`;
  const interval = getMeetingRoomReservationInterval(startDateTime, {
    unit: "hour",
    amount: 1,
  });
  expect(interval).toBeDefined();
  return {
    date,
    duration: { unit: "hour", amount: 1 } as const,
    startDateTime,
    ...interval!,
  };
};

test("constructs reservation-link cases from the reserved preparation partition", async () => {
  expect(meetingRoomE2EDurations).toHaveLength(meetingRoomE2ECoreSlotCount + 4);
  const preparation = {
    slots: Array.from({ length: meetingRoomE2ECoreSlotCount + 4 }, (_, index) =>
      makeReservationLinkPreparationSlot(index)
    ),
  };
  const flowStates: CheckoutFlowState[] = [];
  const cases = await Effect.runPromise(
    makeReservationLinkE2ECases({
      config: linkCaseConfig,
      datasourceConfig: linkCaseDatasourceConfig,
      flowStates,
      preparation,
      run: linkCaseRunner,
    }).pipe(Effect.provide(FetchHttpClient.layer))
  );

  const expectedLinkCaseIds = workspaceE2ENonPaymentCaseIds.filter((caseId) =>
    caseId.startsWith("reservation-link-")
  );
  expect(cases.map(({ id }) => id)).toEqual([...expectedLinkCaseIds]);
  for (const workspaceE2ECase of cases) {
    expect(workspaceE2ENonPaymentCaseIds).toContain(workspaceE2ECase.id);
  }

  // The original and replacement holds are separate cleanup resources: the
  // en-US case owns both flow states with their own data and order owners.
  const [enCase] = cases;
  expect(enCase.checkoutStates).toHaveLength(2);
  const [originalState, replacementState] = enCase.checkoutStates;
  expect(originalState.data).not.toBe(replacementState.data);
  expect(originalState.data.checkoutUrl).not.toBe(
    replacementState.data.checkoutUrl
  );
  expect(originalState.data.email).toBe(replacementState.data.email);
  expect(flowStates).toHaveLength(4);
  // Both case-owned flow states are registered in the shared cleanup list.
  expect(flowStates[0]).toBe(originalState);
  expect(flowStates[1]).toBe(replacementState);
  expect(flowStates.filter(({ data }) => data.locale === "cs-CZ")).toHaveLength(
    1
  );
});

test("fails reservation-link construction when the preparation partition is short", async () => {
  const preparation = {
    slots: Array.from({ length: meetingRoomE2ECoreSlotCount + 3 }, (_, index) =>
      makeReservationLinkPreparationSlot(index)
    ),
  };
  const exit = await Effect.runPromiseExit(
    makeReservationLinkE2ECases({
      config: linkCaseConfig,
      datasourceConfig: linkCaseDatasourceConfig,
      flowStates: [],
      preparation,
      run: linkCaseRunner,
    }).pipe(Effect.provide(FetchHttpClient.layer))
  );
  expect(Exit.isSuccess(exit)).toBe(false);
});
