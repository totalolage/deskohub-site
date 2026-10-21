import "@/shared/testing/workspace-test-env";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Data, Effect, Layer } from "effect";
import type { AdministrationReservationExportInput } from "@/features/administration/administration.service";

class TestUnauthorizedError extends Data.TaggedError(
  "AdministratorUnauthorizedError"
)<{ readonly message: string }> {}

let authorization: Effect.Effect<unknown, unknown> = Effect.void;

mock.module(
  "@/features/administrators/server/administrator-authorization.server",
  () => ({
    authorizeAdministratorPage: async () => {},
    requireAdministratorAuthorization: Effect.suspend(() => authorization),
  })
);

const { AdministrationListSourceUnavailableError, AdministrationService } =
  await import("@/features/administration/administration.service");

const exportInputs: AdministrationReservationExportInput[] = [];
let exportResult: Effect.Effect<readonly unknown[], unknown> = Effect.succeed(
  []
);
AdministrationService.Live = Layer.mock(AdministrationService)({
  exportReservations: (input) =>
    Effect.suspend(() => {
      exportInputs.push(input);
      return exportResult;
    }) as never,
});

const { GET } = await import("./route");

const requestExport = (query = "", locale = "en-US") =>
  GET(
    new Request(
      `https://deskohub.test/${locale}/admin/reservations/export${query}`
    ),
    { params: Promise.resolve({ locale }) }
  );

const reservation = {
  id: "0198-export-reservation",
  dotyposReservationId: "dotypos-booking-1",
  customerId: "dotypos-customer-1",
  customer: {
    id: "dotypos-customer-1",
    displayName: "Jana Nováková",
    hasName: true,
    email: testEmailAddress("export-jana"),
    phone: "+420 777 000 000",
  },
  liveDetailsAvailable: true,
  startsAt: "2026-08-20T08:00:00Z",
  endsAt: "2026-08-20T10:00:00Z",
  date: "2026-08-20",
  type: "meeting-room",
  product: { kind: "meeting-room" },
  typeLabel: "Meeting room",
  purpose: "business",
  status: { code: "complete", group: "complete", label: "Complete" },
  statusNote: null,
  statusNoteCode: null,
  createdAt: "2026-08-01T07:30:00Z",
  latestPayment: {
    id: "payment-attempt-1",
    state: "paid",
    refundState: "not_required",
    providerOrderId: null,
    provider: "nexi",
    providerLabel: "Nexi",
    stateLabel: "Paid",
    failureCode: null,
    amount: { value: 125_050, exponent: 2, currency: "CZK" },
    refundedAmount: null,
    refundedAt: null,
    createdAt: "2026-08-01T07:30:00Z",
    providerOrderCreatedAt: null,
    updatedAt: "2026-08-01T07:35:00Z",
  },
  updatedAt: "2026-08-01T07:35:00Z",
};

beforeEach(() => {
  setSystemTime(new Date("2026-08-11T10:00:00Z"));
  authorization = Effect.void;
  exportInputs.length = 0;
  exportResult = Effect.succeed([reservation]);
});

afterEach(() => setSystemTime());

const readCsv = async (response: Response) => {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    byteOrderMark: [...bytes.slice(0, 3)],
    records: new TextDecoder().decode(bytes.slice(3)).split("\r\n"),
  };
};

describe("GET /[locale]/admin/reservations/export", () => {
  test("hides the export from anyone the administrator guard refuses, before reading reservations", async () => {
    authorization = Effect.fail(
      new TestUnauthorizedError({
        message: "signed out or not an administrator",
      })
    );

    const response = await requestExport("?status=complete");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(exportInputs).toEqual([]);
  });

  test("downloads the matching reservations as a private CSV attachment", async () => {
    const response = await requestExport();
    const { byteOrderMark, records } = await readCsv(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="reservations-2026-08-11.csv"'
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(byteOrderMark).toEqual([0xef, 0xbb, 0xbf]);
    expect(records[0]).toBe(
      "Reservation ID,Dotypos booking ID,Start,End,Status,Attention,Dotypos customer ID,Customer,Email,Phone,Product,Created,Payment status,Payment amount,Payment currency"
    );
    expect(records[1]).toBe(
      [
        "0198-export-reservation",
        "dotypos-booking-1",
        "2026-08-20 10:00",
        "2026-08-20 12:00",
        "Complete",
        "",
        "dotypos-customer-1",
        "Jana Nováková",
        testEmailAddress("export-jana"),
        // Only a plain number keeps its sign; a spaced phone number gets the
        // formula guard.
        "'+420 777 000 000",
        "Meeting Room",
        "2026-08-01 09:30",
        "Paid",
        "1250.5",
        "CZK",
      ].join(",")
    );
    expect(records.slice(2)).toEqual([""]);
  });

  test("writes the headers and labels in the route locale", async () => {
    const { records } = await readCsv(await requestExport("", "cs-CZ"));

    expect(records[0]).toBe(
      "ID rezervace,ID rezervace v Dotyposu,Začátek,Konec,Stav,Upozornění,ID zákazníka v Dotyposu,Zákazník,E-mail,Telefon,Produkt,Vytvořeno,Stav platby,Částka platby,Měna platby"
    );
    expect(records[1]).not.toContain(",Complete,");
  });

  test("exports the filters and order of the list, without its page", async () => {
    await requestExport(
      "?customerId=dotypos-customer-1&status=complete&type=office&sort=date&direction=asc&from=2026-08-01&to=2026-08-31&page=3"
    );

    expect(exportInputs).toEqual([
      {
        customerId: "dotypos-customer-1",
        direction: "asc",
        from: "2026-08-01",
        sort: "date",
        status: "complete",
        to: "2026-08-31",
        type: "office",
      },
    ]);
  });

  test("applies the list's default date range", async () => {
    await requestExport();

    expect(exportInputs).toEqual([
      {
        customerId: undefined,
        direction: "desc",
        from: "2026-01-01",
        sort: "created",
        status: undefined,
        type: undefined,
      },
    ]);
  });

  test("answers 503 with a stable code, and no file, when Dotypos details are unavailable", async () => {
    exportResult = Effect.fail(
      new AdministrationListSourceUnavailableError({
        cause: new Error("Dotypos timed out"),
        source: "customer-details",
      })
    );

    const response = await requestExport();

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(await response.json()).toEqual({
      error: "Dotypos details for the export are unavailable.",
      code: "administration_list_source_unavailable",
    });
  });

  test("answers 500 without a file when the export fails otherwise", async () => {
    exportResult = Effect.fail(new Error("database unavailable"));

    const response = await requestExport();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "The export failed." });
  });

  test("answers 404 for an unknown locale", async () => {
    const response = await requestExport("", "xx-XX");

    expect(response.status).toBe(404);
    expect(exportInputs).toEqual([]);
  });
});
