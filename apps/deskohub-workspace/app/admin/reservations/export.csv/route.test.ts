import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import {
  type AdministrationReservationListInput,
  AdministrationService,
  ReservationExportRangeUnavailableError,
} from "@/features/administration/administration.service";
import { AdministrationServiceMock } from "@/features/administration/administration.service.mock";

const events: string[] = [];
let authorized = true;
let exportOutcome: "success" | "range-unavailable" = "success";
const exportInputs: AdministrationReservationListInput[] = [];

const reservation = {
  createdAt: "2026-08-10T08:00:00Z",
  customer: { displayName: "Synthetic Customer" },
  date: "2026-08-12",
  id: "workspace-reservation-synthetic",
  latestPayment: null,
  startsAt: "2026-08-12T09:00:00Z",
  status: { label: "Complete" },
  type: "meeting-room",
  typeLabel: "Meeting room",
} as never;

const productionAdministrationLive = AdministrationService.Live;
const makeAdministrationLayer = () =>
  AdministrationServiceMock({
    exportReservations: (input) => {
      events.push("export");
      exportInputs.push(input);
      if (exportOutcome === "range-unavailable") {
        return Effect.fail(
          new ReservationExportRangeUnavailableError({
            message: "private range",
          })
        );
      }
      return Effect.succeed([reservation]);
    },
  });

mock.module(
  "@/shared/administrator/administrator-authorization.server",
  () => ({
    requireAdministratorAuthorization: Effect.sync(() => {
      events.push("authorize");
      return authorized ? "operator" : null;
    }),
  })
);

mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect: () => (effect: Effect.Effect<unknown>) =>
    Effect.runPromise(effect),
}));

const { GET } = await import("./route");

const request = (query = "") =>
  new Request(`https://workspace.test/admin/reservations/export.csv${query}`);

beforeEach(() => {
  events.length = 0;
  exportInputs.length = 0;
  authorized = true;
  exportOutcome = "success";
  AdministrationService.Live = makeAdministrationLayer();
});

afterAll(() => {
  AdministrationService.Live = productionAdministrationLive;
});

describe("GET /admin/reservations/export.csv", () => {
  test("authorizes before any reservation export read", async () => {
    authorized = false;

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(events).toEqual(["authorize"]);
  });

  test("returns the safe CSV attachment with private no-store headers", async () => {
    const response = await GET(request("?page=7&customerId=dotypos-customer"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="reservations-export.csv"'
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    expect(body).toContain("Reservation ID,Booking date,Status,Customer");
    expect(body).toContain("workspace-reservation-synthetic");
    expect(body).toContain("Synthetic Customer");
    expect(exportInputs).toEqual([
      {
        customerId: "dotypos-customer",
        direction: "desc",
        sort: "created",
        status: undefined,
        type: undefined,
      },
    ]);
    expect(events).toEqual(["authorize", "export"]);
  });

  test("rejects malformed narrowing filters without reading reservation data", async () => {
    const response = await GET(request("?status=unknown"));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("csv");
    expect(exportInputs).toHaveLength(0);
    expect(events).toEqual(["authorize"]);
  });

  test("returns an unavailable non-CSV response when booking-date filtering fails", async () => {
    exportOutcome = "range-unavailable";

    const response = await GET(request("?from=2026-08-06"));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain(
      "booking dates are temporarily unavailable"
    );
    expect(events).toEqual(["authorize", "export"]);
  });
});
