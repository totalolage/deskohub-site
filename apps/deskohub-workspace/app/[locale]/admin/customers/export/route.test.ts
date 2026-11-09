import "@/shared/testing/workspace-test-env";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type {
  AdministrationCustomerExportInput,
  AdministrationCustomerSummary,
} from "@/features/administration/administration.service";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";

const access = mockAdministratorAccess();

const { AdministrationListSourceUnavailableError, AdministrationService } =
  await import("@/features/administration/administration.service");

const exportInputs: AdministrationCustomerExportInput[] = [];
let exportResult: Effect.Effect<
  readonly AdministrationCustomerSummary[],
  unknown
> = Effect.succeed([]);
AdministrationService.Live = Layer.mock(AdministrationService)({
  exportCustomers: (input) =>
    Effect.suspend(() => {
      exportInputs.push(input);
      return exportResult;
    }) as never,
});

const { GET } = await import("./route");

const requestExport = (query = "", locale = "en-US") =>
  GET(
    new Request(
      `https://deskohub.test/${locale}/admin/customers/export${query}`
    ),
    { params: Promise.resolve({ locale }) }
  );

const customerId = (id: string) =>
  id as AdministrationCustomerSummary["customerId"];

const customers: readonly AdministrationCustomerSummary[] = [
  {
    customer: {
      id: customerId("dotypos-customer-1"),
      displayName: "Jana Nováková",
      hasName: true,
      email: testEmailAddress("export-jana"),
      phone: "+420 777 000 000",
    },
    customerId: customerId("dotypos-customer-1"),
    marketingConsent: "active",
    reservationCount: 3,
    lastActivityAt: "2026-08-01T07:35:00Z",
  },
  {
    customer: {
      id: customerId("dotypos-customer-2"),
      displayName: "Unnamed customer",
      hasName: false,
      email: null,
      phone: null,
    },
    customerId: customerId("dotypos-customer-2"),
    marketingConsent: "withdrawn",
    reservationCount: 1,
    lastActivityAt: "2026-07-15T12:00:00Z",
  },
  {
    // Dotypos doesn't have this customer.
    customer: null,
    customerId: customerId("dotypos-customer-3"),
    marketingConsent: "absent",
    reservationCount: 0,
    lastActivityAt: "2026-06-30T22:30:00Z",
  },
];

beforeEach(() => {
  setSystemTime(new Date("2026-08-11T10:00:00Z"));
  access.set("administrator");
  exportInputs.length = 0;
  exportResult = Effect.succeed(customers);
});

afterEach(() => setSystemTime());

const readCsv = async (response: Response) => {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    byteOrderMark: [...bytes.slice(0, 3)],
    records: new TextDecoder().decode(bytes.slice(3)).split("\r\n"),
  };
};

describe("GET /[locale]/admin/customers/export", () => {
  test("hides the export from anyone the administrator guard refuses, before reading customers", async () => {
    access.set("not-administrator");

    const response = await requestExport("?marketingConsent=active");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(exportInputs).toEqual([]);
  });

  test("downloads the matching customers as a private CSV attachment", async () => {
    const response = await requestExport();
    const { byteOrderMark, records } = await readCsv(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="customers-2026-08-11.csv"'
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(byteOrderMark).toEqual([0xef, 0xbb, 0xbf]);
    expect(records).toEqual([
      "Dotypos customer ID,Name,Email,Phone,Reservations,Last activity,Marketing consent",
      [
        "dotypos-customer-1",
        "Jana Nováková",
        testEmailAddress("export-jana"),
        // Only a plain number keeps its sign; a spaced phone number gets the
        // formula guard.
        "'+420 777 000 000",
        "3",
        "2026-08-01 09:35",
        "Granted",
      ].join(","),
      "dotypos-customer-2,Unnamed customer,,,1,2026-07-15 14:00,Withdrawn",
      "dotypos-customer-3,,,,0,2026-07-01 00:30,Never granted",
      "",
    ]);
  });

  test("writes the headers and labels in the route locale", async () => {
    const { records } = await readCsv(await requestExport("", "cs-CZ"));

    expect(records[0]).toBe(
      "ID zákazníka v Dotyposu,Jméno,E-mail,Telefon,Rezervace,Poslední aktivita,Marketingový souhlas"
    );
    expect(
      records.slice(1, 4).map((record) => record.split(",").at(-1))
    ).toEqual(["Udělen", "Odvolán", "Nikdy neudělen"]);
    expect(records[2]).toContain(",Zákazník bez jména,");
  });

  test("exports the filters and order of the list, without its page", async () => {
    await requestExport(
      "?marketingConsent=withdrawn&sort=reservations&direction=asc&from=2026-08-31&to=2026-08-01&page=3"
    );

    // A reversed range is normalized as the list normalizes it.
    expect(exportInputs).toEqual([
      {
        direction: "asc",
        from: "2026-08-01",
        marketingConsent: "withdrawn",
        sort: "reservations",
        to: "2026-08-31",
      },
    ]);
  });

  test("exports every customer without filters", async () => {
    await requestExport();

    expect(exportInputs).toEqual([
      {
        direction: "desc",
        marketingConsent: undefined,
        sort: "activity",
      },
    ]);
  });

  test("answers 503 with a stable code, and no file, when Dotypos details are unavailable", async () => {
    exportResult = Effect.fail(
      new AdministrationListSourceUnavailableError({
        cause: new Error("Dotypos timed out"),
        source: "booking-dates",
      })
    );

    const response = await requestExport("?from=2026-08-01");

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(await response.json()).toEqual({
      error: "Dotypos details for the export are unavailable.",
      code: "administration_list_source_unavailable",
    });
  });

  test("answers 404 for an unknown locale", async () => {
    const response = await requestExport("", "xx-XX");

    expect(response.status).toBe(404);
    expect(exportInputs).toEqual([]);
  });
});
