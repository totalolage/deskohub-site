import "../../shared/polyfills/temporal";

import { expect, test } from "bun:test";
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
import { isWorkspaceE2ETimeout } from "../errors";
import { workspaceE2ENonPaymentCaseIds } from "../playwright-checkout/case-catalog";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutFlowState } from "../types";
import {
  assertHeldMeetingRoomReservation,
  assertMeetingRoomSlotAvailability,
  isMeetingRoomUnavailableFromInventory,
  meetingRoomE2ECoreSlotCount,
} from "./meeting-room";
import { makeReservationLinkE2ECases } from "./reservation-links";

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

const assertPublicMeetingRoomAvailability = ({
  expectedUnavailable,
  publicUnavailable,
}: {
  readonly expectedUnavailable: boolean;
  readonly publicUnavailable: boolean;
}) => {
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
  const fetchMock: typeof globalThis.fetch = (_input, _init) =>
    Promise.resolve(
      Response.json({
        meetingRoomUnavailable: publicUnavailable,
        unavailableDates: [],
      })
    );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );

  return assertMeetingRoomSlotAvailability(
    config,
    data,
    expectedUnavailable
  ).pipe(Effect.provide(httpClientLayer));
};

test.each([false, true])(
  "accepts public availability that matches aggregate capacity (unavailable: %p)",
  async (unavailable) => {
    await Effect.runPromise(
      assertPublicMeetingRoomAvailability({
        expectedUnavailable: unavailable,
        publicUnavailable: unavailable,
      })
    );
  }
);

test.each([
  { expectedUnavailable: true, publicUnavailable: false },
  { expectedUnavailable: false, publicUnavailable: true },
])(
  "fails when public availability contradicts aggregate capacity (%p)",
  async (availability) => {
    const error = await Effect.runPromise(
      Effect.flip(assertPublicMeetingRoomAvailability(availability))
    );

    expect(isWorkspaceE2ETimeout(error)).toBe(true);
  }
);

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
    }).pipe(Effect.provide(FetchHttpClient.layer))
  );

  const expectedLinkCaseIds = workspaceE2ENonPaymentCaseIds.filter((caseId) =>
    caseId.startsWith("reservation-link-")
  );
  // The catalog orders cases by duration for scheduling, not construction.
  expect(cases.map(({ id }) => id).sort()).toEqual(
    [...expectedLinkCaseIds].sort()
  );
  for (const workspaceE2ECase of cases) {
    expect(workspaceE2ENonPaymentCaseIds).toContain(workspaceE2ECase.id);
  }

  const [enCase] = cases;
  expect(enCase.checkoutStates).toHaveLength(2);
  const [originalState, replacementState] = enCase.checkoutStates;
  expect(originalState.data).not.toBe(replacementState.data);
  expect(originalState.data.checkoutUrl).not.toBe(
    replacementState.data.checkoutUrl
  );
  expect(originalState.data.email).toBe(replacementState.data.email);
  expect(flowStates).toHaveLength(4);
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
    }).pipe(Effect.provide(FetchHttpClient.layer))
  );
  expect(Exit.isSuccess(exit)).toBe(false);
});
