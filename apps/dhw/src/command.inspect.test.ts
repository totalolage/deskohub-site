import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import { CliAccessToken, CliSessionId } from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "./api/workspace-admin-api-client.service";
import { AuthenticationService } from "./authentication/authentication.service";
import { dhwCommand } from "./command";
import { DhwConfig } from "./config/dhw-config.service";

type AdminApi = WorkspaceAdminApiClient["Service"];

const accessToken = Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43));
const session = {
  id: Schema.decodeUnknownSync(CliSessionId)(
    "01980000-0000-7000-8000-000000000000"
  ),
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.3.0",
  buildTarget: "development" as const,
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
};

/**
 * Runs `dhw` in process against an API whose authenticated reads answer with
 * the given responses, and records each call's arguments after the token.
 */
const runInspection = async (
  args: ReadonlyArray<string>,
  responses: { readonly [Method in keyof AdminApi]?: unknown }
) => {
  const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = [];
  const output: string[] = [];
  const api = Object.fromEntries(
    Object.entries(responses).map(([method, response]) => [
      method,
      (_accessToken: unknown, ...parameters: ReadonlyArray<unknown>) =>
        Effect.sync(() => {
          calls.push([method, ...parameters]);
          return response;
        }),
    ])
  );
  const layer = Layer.mergeAll(
    Layer.succeed(WorkspaceAdminApiClient, api as unknown as AdminApi),
    Layer.succeed(AuthenticationService, {
      current: Effect.succeed(
        Option.some({ accessToken: Redacted.make(accessToken), session })
      ),
      save: () => Effect.void,
      clear: Effect.succeed(true),
    }),
    Layer.succeed(Console.Console, {
      ...globalThis.console,
      log: (...parts: ReadonlyArray<unknown>) => {
        output.push(parts.join(" "));
      },
    } satisfies Console.Console)
  ).pipe(
    Layer.provideMerge(
      Layer.succeed(DhwConfig, {
        baseUrl: new URL("https://workspace.example.test"),
        requestHeaders: {},
        isCi: true,
        stateDirectory: join(
          process.env.TMPDIR ?? "/tmp",
          "dhw-inspection-test"
        ),
        updateChecksDisabled: true,
      })
    ),
    Layer.provideMerge(BunServices.layer)
  );

  await Command.runWith(dhwCommand, { version: "1.3.0" })(args).pipe(
    Effect.provide(layer),
    Effect.runPromise
  );
  return { calls, output };
};

const page = { total: 2, page: 1, pageCount: 3 };

describe("dhw reservations", () => {
  const reservations = {
    ...page,
    items: [
      {
        id: "reservation-1",
        date: "2026-08-10",
        startsAt: "2026-08-10T09:00",
        typeLabel: "Cowork",
        customer: { displayName: "Synthetic Customer" },
        customerId: "customer-1",
        status: { label: "Complete" },
      },
      {
        id: "reservation-2",
        date: null,
        startsAt: "2026-08-11T09:00",
        typeLabel: "Meeting room",
        customer: null,
        customerId: "customer-2",
        status: { label: "In progress" },
      },
      {
        id: "reservation-3",
        date: null,
        startsAt: null,
        typeLabel: "Office",
        customer: null,
        customerId: "customer-3",
        status: { label: "Cancelled" },
      },
    ],
  };

  test("lists reservations with every filter passed through the decoded query", async () => {
    const { calls, output } = await runInspection(
      [
        "--json",
        "reservations",
        "list",
        "--customer",
        "customer-1",
        "--date",
        "2026-08-10",
        "--direction",
        "asc",
        "--page",
        "2",
        "--sort",
        "date",
        "--status",
        "needs_refund",
        "--type",
        "office",
      ],
      { listReservations: reservations }
    );

    expect(calls).toEqual([
      [
        "listReservations",
        {
          customerId: "customer-1",
          date: "2026-08-10",
          direction: "asc",
          page: 2,
          sort: "date",
          status: "needs_refund",
          type: "office",
        },
      ],
    ]);
    expect(output).toEqual([JSON.stringify(reservations)]);
  });

  test("lists reservation rows with their date and customer fallbacks", async () => {
    const { calls, output } = await runInspection(["reservations", "list"], {
      listReservations: reservations,
    });

    expect(calls).toEqual([["listReservations", {}]]);
    expect(output).toEqual([
      "Reservations: 2 total · page 1/3",
      "reservation-1\t2026-08-10\tCowork\tSynthetic Customer\tComplete",
      "reservation-2\t2026-08-11T09:00\tMeeting room\tcustomer-2\tIn progress",
      "reservation-3\tUnknown\tOffice\tcustomer-3\tCancelled",
    ]);
  });

  test("finds a reservation by identifier", async () => {
    const found = { reservationId: "reservation-1" };

    const json = await runInspection(
      ["--json", "reservations", "find", "payment-1"],
      { findReservation: found }
    );
    const text = await runInspection(["reservations", "find", "payment-1"], {
      findReservation: found,
    });
    const missing = await runInspection(["reservations", "find", "nothing"], {
      findReservation: { reservationId: null },
    });

    expect(json.calls).toEqual([["findReservation", "payment-1"]]);
    expect(json.output).toEqual([JSON.stringify(found)]);
    expect(text.output).toEqual(["reservation-1"]);
    expect(missing.output).toEqual(["No reservation matched."]);
  });

  test("lists a customer's reservations on the requested page", async () => {
    const json = await runInspection(
      ["--json", "customers", "reservations", "customer-1", "--page", "2"],
      { listCustomerReservations: reservations }
    );
    const text = await runInspection(
      ["customers", "reservations", "customer-1"],
      { listCustomerReservations: reservations }
    );

    expect(json.calls).toEqual([
      ["listCustomerReservations", "customer-1", { page: 2 }],
    ]);
    expect(json.output).toEqual([JSON.stringify(reservations)]);
    expect(text.calls).toEqual([
      ["listCustomerReservations", "customer-1", {}],
    ]);
    expect(text.output).toEqual([
      "Reservations: 2 total · page 1/3",
      "reservation-1\t2026-08-10\tCowork\tSynthetic Customer\tComplete",
      "reservation-2\t2026-08-11T09:00\tMeeting room\tcustomer-2\tIn progress",
      "reservation-3\tUnknown\tOffice\tcustomer-3\tCancelled",
    ]);
  });
});

describe("dhw bookings", () => {
  const bookings = {
    ...page,
    items: [
      {
        id: "booking-1",
        startsAt: "2026-08-10T09:00",
        tableName: "Table 1",
        customer: { displayName: "Synthetic Customer" },
        customerId: "customer-1",
        statusLabel: "Confirmed",
      },
      {
        id: "booking-2",
        startsAt: "2026-08-11T09:00",
        tableName: null,
        customer: null,
        customerId: "customer-2",
        statusLabel: "Pending",
      },
      {
        id: "booking-3",
        startsAt: "2026-08-12T09:00",
        tableName: null,
        customer: null,
        customerId: null,
        statusLabel: "Cancelled",
      },
    ],
  };

  test("lists bookings with the date and page filters", async () => {
    const { calls, output } = await runInspection(
      ["--json", "bookings", "list", "--date", "2026-08-10", "--page", "2"],
      { listBookings: bookings }
    );

    expect(calls).toEqual([["listBookings", { date: "2026-08-10", page: 2 }]]);
    expect(output).toEqual([JSON.stringify(bookings)]);
  });

  test("lists booking rows with table and customer fallbacks", async () => {
    const { calls, output } = await runInspection(["bookings", "list"], {
      listBookings: bookings,
    });

    expect(calls).toEqual([["listBookings", {}]]);
    expect(output).toEqual([
      "Bookings: 2 total · page 1/3",
      "booking-1\t2026-08-10T09:00\tTable 1\tSynthetic Customer\tConfirmed",
      "booking-2\t2026-08-11T09:00\tUnassigned\tcustomer-2\tPending",
      "booking-3\t2026-08-12T09:00\tUnassigned\tUnknown customer\tCancelled",
    ]);
  });

  test("shows a booking and its Workspace reservation", async () => {
    const linked = {
      booking: {
        ...bookings.items[0],
        endsAt: "2026-08-10T11:00",
      },
      references: { workspaceReservationId: "reservation-1" },
    };
    const unlinked = {
      booking: { ...bookings.items[2], endsAt: "2026-08-12T11:00" },
      references: { workspaceReservationId: null },
    };

    const json = await runInspection(
      ["--json", "bookings", "get", "booking-1"],
      {
        getBooking: linked,
      }
    );
    const text = await runInspection(["bookings", "get", "booking-1"], {
      getBooking: linked,
    });
    const sparse = await runInspection(["bookings", "get", "booking-3"], {
      getBooking: {
        ...unlinked,
        booking: { ...unlinked.booking, customerId: "customer-3" },
      },
    });
    const anonymous = await runInspection(["bookings", "get", "booking-3"], {
      getBooking: unlinked,
    });

    expect(json.calls).toEqual([["getBooking", "booking-1"]]);
    expect(json.output).toEqual([JSON.stringify(linked)]);
    expect(text.output).toEqual([
      "booking-1\t2026-08-10T09:00\t2026-08-10T11:00\tTable 1\tSynthetic Customer\tConfirmed",
      "Workspace reservation: reservation-1",
    ]);
    expect(sparse.output).toEqual([
      "booking-3\t2026-08-12T09:00\t2026-08-12T11:00\tUnassigned\tcustomer-3\tCancelled",
    ]);
    expect(anonymous.output).toEqual([
      "booking-3\t2026-08-12T09:00\t2026-08-12T11:00\tUnassigned\tUnknown customer\tCancelled",
    ]);
  });
});

describe("dhw payment provider records", () => {
  const linkedOrder = {
    orderId: "order-1",
    providerStatus: "PAID",
    link: { stateLabel: "Paid", reservationId: "reservation-1" },
  };
  const unlinkedOrder = {
    orderId: "order-2",
    providerStatus: "CANCELLED",
    link: null,
  };
  const operation = {
    operationId: "operation-1",
    operationTime: "2026-08-10T09:00:00Z",
    operationType: "PAYMENT",
    operationResult: "SUCCESS",
    orderId: "order-1",
    linkedReservationId: "reservation-1",
  };
  const unknownOperation = {
    operationId: null,
    operationTime: null,
    operationType: null,
    operationResult: null,
    orderId: null,
    linkedReservationId: null,
  };

  test("lists orders in the date range", async () => {
    const orders = {
      items: [linkedOrder, unlinkedOrder],
      truncated: true,
      providerAvailable: true,
    };

    const json = await runInspection(
      [
        "--json",
        "orders",
        "list",
        "--from",
        "2026-08-01",
        "--to",
        "2026-08-31",
      ],
      { listOrders: orders }
    );
    const text = await runInspection(["orders", "list"], {
      listOrders: orders,
    });
    const unavailable = await runInspection(["orders", "list"], {
      listOrders: { items: [], truncated: false, providerAvailable: false },
    });

    expect(json.calls).toEqual([
      ["listOrders", { from: "2026-08-01", to: "2026-08-31" }],
    ]);
    expect(json.output).toEqual([JSON.stringify(orders)]);
    expect(text.calls).toEqual([["listOrders", {}]]);
    expect(text.output).toEqual([
      "Orders: 2+ · provider available",
      "order-1\tPAID\tPaid\treservation-1",
      "order-2\tCANCELLED\tNot linked\tNo reservation",
    ]);
    expect(unavailable.output).toEqual(["Orders: 0 · provider unavailable"]);
  });

  test("shows an order and its provider operations", async () => {
    const order = {
      ...linkedOrder,
      provider: { operations: [operation, operation] },
    };

    const json = await runInspection(["--json", "orders", "get", "order-1"], {
      getOrder: order,
    });
    const text = await runInspection(["orders", "get", "order-1"], {
      getOrder: order,
    });
    const unlinked = await runInspection(["orders", "get", "order-2"], {
      getOrder: { ...unlinkedOrder, provider: null },
    });

    expect(json.calls).toEqual([["getOrder", "order-1"]]);
    expect(json.output).toEqual([JSON.stringify(order)]);
    expect(text.output).toEqual([
      "order-1\tPAID\tPaid\treservation-1",
      "2 provider operations",
    ]);
    expect(unlinked.output).toEqual([
      "order-2\tCANCELLED\tNot linked\tNo reservation",
    ]);
  });

  test("lists operations with every filter", async () => {
    const operations = {
      items: [operation, unknownOperation],
      truncated: false,
      providerAvailable: true,
    };

    const json = await runInspection(
      [
        "--json",
        "operations",
        "list",
        "--from",
        "2026-08-01",
        "--to",
        "2026-08-31",
        "--channel",
        "card",
        "--operation-type",
        "PAYMENT",
      ],
      { listOperations: operations }
    );
    const text = await runInspection(["operations", "list"], {
      listOperations: operations,
    });
    const truncated = await runInspection(["operations", "list"], {
      listOperations: { items: [], truncated: true, providerAvailable: false },
    });

    expect(json.calls).toEqual([
      [
        "listOperations",
        {
          from: "2026-08-01",
          to: "2026-08-31",
          channel: "card",
          operationType: "PAYMENT",
        },
      ],
    ]);
    expect(json.output).toEqual([JSON.stringify(operations)]);
    expect(text.calls).toEqual([["listOperations", {}]]);
    expect(text.output).toEqual([
      "Operations: 2 · provider available",
      "operation-1\t2026-08-10T09:00:00Z\tPAYMENT\tSUCCESS\torder-1\treservation-1",
      "Unknown operation\tUnknown time\tUnknown type\tUnknown result\tNo order\tNo reservation",
    ]);
    expect(truncated.output).toEqual(["Operations: 0+ · provider unavailable"]);
  });

  test("shows an operation with its order and reservation", async () => {
    const detail = {
      operationId: "operation-1",
      providerStatus: "FOUND",
      operation,
      linkedReservationId: "reservation-1",
    };

    const json = await runInspection(
      ["--json", "operations", "get", "operation-1"],
      { getOperation: detail }
    );
    const text = await runInspection(["operations", "get", "operation-1"], {
      getOperation: detail,
    });
    const missing = await runInspection(["operations", "get", "operation-2"], {
      getOperation: {
        operationId: "operation-2",
        providerStatus: "NOT_FOUND",
        operation: null,
        linkedReservationId: null,
      },
    });
    const partial = await runInspection(["operations", "get", "operation-3"], {
      getOperation: {
        operationId: "operation-3",
        providerStatus: "FOUND",
        operation: unknownOperation,
        linkedReservationId: null,
      },
    });

    expect(json.calls).toEqual([["getOperation", "operation-1"]]);
    expect(json.output).toEqual([JSON.stringify(detail)]);
    expect(text.output).toEqual([
      "operation-1\tFOUND\tPAYMENT\tSUCCESS\torder-1\treservation-1",
    ]);
    expect(missing.output).toEqual([
      "operation-2\tNOT_FOUND\tUnknown type\tUnknown result\tNo order\tNo reservation",
    ]);
    expect(partial.output).toEqual([
      "operation-3\tFOUND\tUnknown type\tUnknown result\tNo order\tNo reservation",
    ]);
  });
});

describe("dhw invoices", () => {
  const invoiceId = "01980000-0000-7000-8000-000000000019";
  const invoice = (
    id: string,
    delivery: {
      readonly customer: string;
      readonly internal: string;
    },
    needsAttention: boolean
  ) => ({
    id,
    invoiceNumber: `2026-${id.slice(-4)}`,
    issuedAt: "2026-08-10",
    customerName: "Synthetic Customer",
    total: "1000",
    currency: "CZK",
    paymentStatus: "due",
    delivery,
    needsAttention,
  });
  const accepted = { customer: "accepted", internal: "accepted" };

  test("lists invoices with sort, direction, and page", async () => {
    const invoices = {
      ...page,
      items: [
        invoice("01980000-0000-7000-8000-000000000001", accepted, false),
        invoice(
          "01980000-0000-7000-8000-000000000002",
          { customer: "failed", internal: "accepted" },
          true
        ),
        invoice(
          "01980000-0000-7000-8000-000000000003",
          { customer: "accepted", internal: "processing" },
          false
        ),
        invoice(
          "01980000-0000-7000-8000-000000000004",
          { customer: "processing", internal: "accepted" },
          false
        ),
      ],
    };

    const json = await runInspection(
      [
        "--json",
        "invoices",
        "list",
        "--sort",
        "total",
        "--direction",
        "desc",
        "--page",
        "2",
      ],
      { listInvoices: invoices }
    );
    const text = await runInspection(["invoices", "list"], {
      listInvoices: invoices,
    });

    expect(json.calls).toEqual([
      ["listInvoices", { sort: "total", direction: "desc", page: 2 }],
    ]);
    expect(json.output).toEqual([JSON.stringify(invoices)]);
    expect(text.calls).toEqual([["listInvoices", {}]]);
    expect(text.output).toEqual([
      "Invoices: 2 total · page 1/3",
      "01980000-0000-7000-8000-000000000001\t2026-0001\t2026-08-10\tSynthetic Customer\t1000 CZK\tdue\tSent",
      "01980000-0000-7000-8000-000000000002\t2026-0002\t2026-08-10\tSynthetic Customer\t1000 CZK\tdue\tNeeds resend",
      "01980000-0000-7000-8000-000000000003\t2026-0003\t2026-08-10\tSynthetic Customer\t1000 CZK\tdue\tSending",
      "01980000-0000-7000-8000-000000000004\t2026-0004\t2026-08-10\tSynthetic Customer\t1000 CZK\tdue\tSending",
    ]);
  });

  test("shows an invoice and its lines", async () => {
    const detail = {
      ...invoice(invoiceId, accepted, false),
      source: "administration",
      lines: [
        { description: "Synthetic service", price: "800" },
        { description: "Synthetic extra", price: "200" },
      ],
    };

    const json = await runInspection(["--json", "invoices", "get", invoiceId], {
      getInvoice: detail,
    });
    const text = await runInspection(["invoices", "get", invoiceId], {
      getInvoice: detail,
    });

    expect(json.calls).toEqual([["getInvoice", invoiceId]]);
    expect(json.output).toEqual([JSON.stringify(detail)]);
    expect(text.output).toEqual([
      "2026-0019\t2026-08-10\tSynthetic Customer\t1000 CZK\tdue\tadministration\tSent",
      "Synthetic service\t800",
      "Synthetic extra\t200",
    ]);
  });

  test("retries invoice delivery once confirmed", async () => {
    const json = await runInspection(
      ["--json", "invoices", "resend", invoiceId, "--yes"],
      { resendInvoice: { changed: true } }
    );
    const retried = await runInspection(
      ["invoices", "resend", invoiceId, "--yes"],
      { resendInvoice: { changed: true } }
    );
    const unchanged = await runInspection(
      ["invoices", "resend", invoiceId, "--yes"],
      { resendInvoice: { changed: false } }
    );

    expect(json.calls).toEqual([["resendInvoice", invoiceId]]);
    expect(json.output).toEqual([JSON.stringify({ changed: true })]);
    expect(retried.output).toEqual([
      `Retried delivery for invoice ${invoiceId}.`,
    ]);
    expect(unchanged.output).toEqual([
      `Invoice ${invoiceId} had no retryable delivery.`,
    ]);
  });
});

describe("dhw customers", () => {
  const withEmail = {
    displayName: "Email Customer",
    email: testEmailAddress("customer"),
    phone: "+420 600 000 001",
  };
  const withPhone = {
    displayName: "Phone Customer",
    email: null,
    phone: "+420 600 000 002",
  };
  const withoutContact = {
    displayName: "Quiet Customer",
    email: null,
    phone: null,
  };

  test("lists customers with their contact fallbacks", async () => {
    const customers = {
      ...page,
      items: [
        { customerId: "customer-1", customer: withEmail },
        { customerId: "customer-2", customer: withPhone },
        { customerId: "customer-3", customer: withoutContact },
        { customerId: "customer-4", customer: null },
      ].map((item, index) => ({
        ...item,
        reservationCount: index + 1,
        lastActivityAt: "2026-08-10T09:00:00Z",
      })),
    };

    const json = await runInspection(
      ["--json", "customers", "list", "--page", "2"],
      { listCustomers: customers }
    );
    const text = await runInspection(["customers", "list"], {
      listCustomers: customers,
    });

    expect(json.calls).toEqual([["listCustomers", { page: 2 }]]);
    expect(json.output).toEqual([JSON.stringify(customers)]);
    expect(text.calls).toEqual([["listCustomers", {}]]);
    expect(text.output).toEqual([
      "Customers: 2 total · page 1/3",
      `customer-1\tEmail Customer\t${withEmail.email}\t1 reservations\t2026-08-10T09:00:00Z`,
      "customer-2\tPhone Customer\t+420 600 000 002\t2 reservations\t2026-08-10T09:00:00Z",
      "customer-3\tQuiet Customer\tNo contact details\t3 reservations\t2026-08-10T09:00:00Z",
      "customer-4\tDetails unavailable\tNo contact details\t4 reservations\t2026-08-10T09:00:00Z",
    ]);
  });

  test("searches customers and flags ambiguous matches", async () => {
    const ambiguous = {
      kind: "ambiguous",
      customers: [
        { id: "customer-1", ...withEmail },
        { id: "customer-2", ...withPhone },
        { id: "customer-3", ...withoutContact },
      ],
    };

    const json = await runInspection(
      ["--json", "customers", "search", "Customer"],
      { searchCustomers: ambiguous }
    );
    const text = await runInspection(["customers", "search", "Customer"], {
      searchCustomers: ambiguous,
    });
    const exact = await runInspection(["customers", "search", "Email"], {
      searchCustomers: {
        kind: "exact",
        customers: [{ id: "customer-1", ...withEmail }],
      },
    });
    const none = await runInspection(["customers", "search", "Nobody"], {
      searchCustomers: { kind: "none", customers: [] },
    });

    expect(json.calls).toEqual([["searchCustomers", { query: "Customer" }]]);
    expect(json.output).toEqual([JSON.stringify(ambiguous)]);
    expect(text.output).toEqual([
      "Multiple customers matched:",
      `customer-1\tEmail Customer\t${withEmail.email}`,
      "customer-2\tPhone Customer\t+420 600 000 002",
      "customer-3\tQuiet Customer\tNo contact details",
    ]);
    expect(exact.output).toEqual([
      `customer-1\tEmail Customer\t${withEmail.email}`,
    ]);
    expect(none.output).toEqual(["No customer matched."]);
  });

  test("shows a customer's profile, discount activity, and favorite product", async () => {
    const detail = (
      customer: typeof withEmail | typeof withPhone | typeof withoutContact
    ) => ({
      profile: {
        customer: { id: "customer-1", ...customer },
        codes: [{}, {}],
        claims: [{}],
      },
      activity: {
        stats: { reservationCount: 4, favoriteProduct: "Cowork" },
      },
    });

    const json = await runInspection(
      ["--json", "customers", "get", "customer-1"],
      { getCustomer: detail(withEmail) }
    );
    const email = await runInspection(["customers", "get", "customer-1"], {
      getCustomer: detail(withEmail),
    });
    const phone = await runInspection(["customers", "get", "customer-1"], {
      getCustomer: detail(withPhone),
    });
    const quiet = await runInspection(["customers", "get", "customer-1"], {
      getCustomer: detail(withoutContact),
    });

    expect(json.calls).toEqual([["getCustomer", "customer-1"]]);
    expect(json.output).toEqual([JSON.stringify(detail(withEmail))]);
    expect(email.output).toEqual([
      `customer-1\tEmail Customer\t${withEmail.email}`,
      "4 reservations · 2 discount codes · 1 code claims",
      "Favorite product: Cowork",
    ]);
    expect(phone.output[0]).toBe(
      "customer-1\tPhone Customer\t+420 600 000 002"
    );
    expect(quiet.output[0]).toBe(
      "customer-1\tQuiet Customer\tNo contact details"
    );
  });

  test("shows a customer without live details or a favorite product", async () => {
    const { output } = await runInspection(["customers", "get", "customer-9"], {
      getCustomer: {
        profile: null,
        activity: { stats: { reservationCount: 0, favoriteProduct: null } },
      },
    });

    expect(output).toEqual([
      "customer-9\tLive customer details unavailable",
      "0 reservations · 0 discount codes · 0 code claims",
    ]);
  });
});

describe("dhw discounts, codes, vouchers, and sales", () => {
  const money = (value: number) => ({ value, exponent: 2, currency: "CZK" });
  const discounts = [
    {
      id: "discount-1",
      labels: { "en-US": "Summer", "cs-CZ": "Léto" },
      adjustment: { kind: "percentage", basisPoints: 1250 },
      products: [{ kind: "cowork", tier: "day" }, { kind: "cowork" }],
      codeCount: 2,
    },
    {
      id: "discount-2",
      labels: { "en-US": "Fixed", "cs-CZ": "Pevná" },
      adjustment: { kind: "fixed", amount: money(15_000) },
      products: [{ kind: "meeting-room" }, { kind: "office" }],
      codeCount: 0,
    },
    {
      id: "discount-3",
      labels: { "en-US": "Small", "cs-CZ": "Malá" },
      adjustment: { kind: "fixed", amount: money(9950) },
      products: [{ kind: "office" }],
      codeCount: 1,
    },
  ];
  const limitedCode = {
    id: "code-1",
    code: "SUMMER",
    discountId: "discount-1",
    enabled: true,
    remainingUses: 5,
    maxUsesPerCustomer: 1,
    validFrom: "2026-08-01",
    validUntil: "2026-08-31",
    serviceDateFrom: "2026-08-03",
    serviceDateUntil: "2026-08-28",
  };
  const openCode = {
    id: "code-2",
    code: "ORPHAN",
    discountId: "discount-missing",
    enabled: false,
    remainingUses: null,
    maxUsesPerCustomer: null,
    validFrom: null,
    validUntil: null,
    serviceDateFrom: null,
    serviceDateUntil: null,
  };
  // Each code line ends with its service dates after these fields.
  const codeLineFieldCount = 6;
  const codeLineWithoutServiceDates = (line: string) =>
    line.split("\t").slice(0, codeLineFieldCount).join("\t");
  const plainDatePattern = /\d{4}-\d{2}-\d{2}/;
  const voucher = {
    id: "voucher-1",
    code: "GIFT",
    issuedCredit: money(50_000),
    remainingCredit: money(12_550),
    enabled: true,
    validFrom: "2026-08-01",
    validUntil: "2026-12-31",
  };
  const spentVoucher = {
    id: "voucher-2",
    code: "SPENT",
    issuedCredit: money(20_000),
    remainingCredit: money(0),
    enabled: false,
    validFrom: null,
    validUntil: null,
  };
  const calendar = {
    from: "2026-08-01",
    to: "2026-08-31",
    unavailable: false,
    events: [
      {
        eventReference: "event-1",
        start: "2026-08-10",
        end: "2026-08-12",
        title: "Summer sale",
        association: { kind: "linked" },
      },
    ],
  };
  const dashboard = {
    discounts,
    codes: [limitedCode, openCode],
    vouchers: [voucher, spentVoucher],
    calendar,
  };
  const audienceAndClaims = {
    customers: [
      {
        customerId: "customer-1",
        customer: { displayName: "Synthetic Customer" },
      },
      { customerId: "customer-2", customer: null },
    ],
    claims: [
      {
        state: "redeemed",
        appliedAmount: money(10_000),
        dotyposCustomerId: "customer-1",
        workspaceReservationId: "reservation-1",
        reservedAt: "2026-08-10T09:00:00Z",
        redeemedAt: "2026-08-10T10:00:00Z",
        releasedAt: null,
      },
      {
        state: "released",
        appliedAmount: null,
        dotyposCustomerId: "customer-2",
        workspaceReservationId: "reservation-2",
        reservedAt: "2026-08-11T09:00:00Z",
        redeemedAt: null,
        releasedAt: "2026-08-11T10:00:00Z",
      },
      {
        state: "reserved",
        appliedAmount: money(500),
        dotyposCustomerId: "customer-1",
        workspaceReservationId: "reservation-3",
        reservedAt: "2026-08-12T09:00:00Z",
        redeemedAt: null,
        releasedAt: null,
      },
    ],
  };
  const claimRows = [
    "Claims\t3",
    "redeemed\t100 CZK\tcustomer-1\treservation-1\t2026-08-10T09:00:00Z\t2026-08-10T10:00:00Z",
    "released\tAmount unavailable\tcustomer-2\treservation-2\t2026-08-11T09:00:00Z\t2026-08-11T10:00:00Z",
    "reserved\t5 CZK\tcustomer-1\treservation-3\t2026-08-12T09:00:00Z\tPending",
  ];

  test("lists discounts with their adjustment and product targets", async () => {
    const json = await runInspection(["--json", "discounts", "list"], {
      getDiscountDashboard: dashboard,
    });
    const text = await runInspection(["discounts", "list"], {
      getDiscountDashboard: dashboard,
    });

    expect(json.output).toEqual([JSON.stringify(discounts)]);
    expect(text.output).toEqual([
      "Discounts: 3",
      "discount-1\tSummer\t12.5%\tcowork:day,cowork\t2 codes",
      "discount-2\tFixed\t150 CZK\tmeeting-room,office\t0 codes",
      "discount-3\tSmall\t99.5 CZK\toffice\t1 codes",
    ]);
  });

  test("lists codes with their discount label, state, limits, and service dates", async () => {
    const json = await runInspection(["--json", "codes", "list"], {
      getDiscountDashboard: dashboard,
    });
    const text = await runInspection(["codes", "list"], {
      getDiscountDashboard: dashboard,
    });

    const [header, ...rows] = text.output;
    const [limitedServiceDates, openServiceDates] = rows.map(
      (row) => row.split("\t")[codeLineFieldCount]
    );

    expect(json.output).toEqual([JSON.stringify(dashboard.codes)]);
    expect([header, ...rows.map(codeLineWithoutServiceDates)]).toEqual([
      "Discount codes: 2",
      "code-1\tSUMMER\tSummer\tEnabled\t5 globally\t1 per customer",
      "code-2\tORPHAN\tdiscount-missing\tDisabled\tUnlimited globally\tUnlimited per customer",
    ]);
    expect(limitedServiceDates).toContain("2026-08-03");
    expect(limitedServiceDates).toContain("2026-08-28");
    expect(openServiceDates).toBeString();
    expect(openServiceDates).not.toMatch(plainDatePattern);
  });

  test("shows a code with its service dates, validity, audience, and claims", async () => {
    const detail = {
      code: limitedCode,
      discountLabel: "Summer",
      ...audienceAndClaims,
    };

    const json = await runInspection(["--json", "codes", "get", "code-1"], {
      getDiscountCode: detail,
    });
    const text = await runInspection(["codes", "get", "code-1"], {
      getDiscountCode: detail,
    });
    const open = await runInspection(["codes", "get", "code-2"], {
      getDiscountCode: {
        code: openCode,
        discountLabel: "Orphan",
        customers: [],
        claims: [],
      },
    });

    expect(json.calls).toEqual([["getDiscountCode", "code-1"]]);
    expect(json.output).toEqual([JSON.stringify(detail)]);
    const [codeLine = "", serviceDateRow = "", ...detailRows] = text.output;
    const [openCodeLine = "", openServiceDateRow = "", ...openDetailRows] =
      open.output;

    expect(codeLineWithoutServiceDates(codeLine)).toBe(
      "code-1\tSUMMER\tSummer\tEnabled\t5 globally\t1 per customer"
    );
    expect(serviceDateRow.split("\t").slice(1)).toEqual([
      "2026-08-03",
      "2026-08-28",
    ]);
    expect(codeLineWithoutServiceDates(openCodeLine)).toBe(
      "code-2\tORPHAN\tOrphan\tDisabled\tUnlimited globally\tUnlimited per customer"
    );
    expect(openServiceDateRow).not.toMatch(plainDatePattern);
    expect(detailRows).toEqual([
      "Validity\t2026-08-01\t2026-08-31",
      "Audience\t2 customers",
      "Customer\tcustomer-1\tSynthetic Customer",
      "Customer\tcustomer-2\tUnavailable",
      ...claimRows,
    ]);
    expect(openDetailRows).toEqual([
      "Validity\tNo start\tNo end",
      "Audience\tUnrestricted",
      "Claims\t0",
    ]);
  });

  test("lists vouchers with their credit and state", async () => {
    const json = await runInspection(["--json", "vouchers", "list"], {
      getDiscountDashboard: dashboard,
    });
    const text = await runInspection(["vouchers", "list"], {
      getDiscountDashboard: dashboard,
    });

    expect(json.output).toEqual([JSON.stringify(dashboard.vouchers)]);
    expect(text.output).toEqual([
      "Vouchers: 2",
      "voucher-1\tGIFT\t500 CZK\t125.5 CZK\tEnabled",
      "voucher-2\tSPENT\t200 CZK\t0 CZK\tDisabled",
    ]);
  });

  test("shows a voucher with its validity, audience, and claims", async () => {
    const detail = { voucher, ...audienceAndClaims };

    const json = await runInspection(
      ["--json", "vouchers", "get", "voucher-1"],
      { getVoucher: detail }
    );
    const text = await runInspection(["vouchers", "get", "voucher-1"], {
      getVoucher: detail,
    });
    const spent = await runInspection(["vouchers", "get", "voucher-2"], {
      getVoucher: { voucher: spentVoucher, customers: [], claims: [] },
    });

    expect(json.calls).toEqual([["getVoucher", "voucher-1"]]);
    expect(json.output).toEqual([JSON.stringify(detail)]);
    expect(text.output).toEqual([
      "voucher-1\tGIFT\t500 CZK issued\t125.5 CZK remaining\tEnabled",
      "Validity\t2026-08-01\t2026-12-31",
      "Audience\t2 customers",
      "Customer\tcustomer-1\tSynthetic Customer",
      "Customer\tcustomer-2\tUnavailable",
      ...claimRows,
    ]);
    expect(spent.output).toEqual([
      "voucher-2\tSPENT\t200 CZK issued\t0 CZK remaining\tDisabled",
      "Validity\tNo start\tNo end",
      "Audience\tUnrestricted",
      "Claims\t0",
    ]);
  });

  test("lists calendar sales and flags an unavailable calendar", async () => {
    const json = await runInspection(["--json", "sales", "list"], {
      getDiscountDashboard: dashboard,
    });
    const text = await runInspection(["sales", "list"], {
      getDiscountDashboard: dashboard,
    });
    const unavailable = await runInspection(["sales", "list"], {
      getDiscountDashboard: {
        ...dashboard,
        calendar: { ...calendar, unavailable: true, events: [] },
      },
    });

    expect(json.output).toEqual([JSON.stringify(calendar)]);
    expect(text.output).toEqual([
      "Calendar sales: 1 · 2026-08-01 to 2026-08-31",
      "event-1\t2026-08-10\t2026-08-12\tSummer sale\tlinked",
    ]);
    expect(unavailable.output).toEqual([
      "Calendar sales: 0 · 2026-08-01 to 2026-08-31 · unavailable",
    ]);
  });
});

describe("dhw discount mutation results", () => {
  const storedDiscountId = "01980000-0000-7000-8000-000000000003";
  const result = (fields: object) => ({
    createdDiscountId: null,
    createdCodeId: null,
    createdVoucherId: null,
    ...fields,
  });

  test("reports each mutation with the identifier it created", async () => {
    const deleted = await runInspection(
      ["discounts", "delete", storedDiscountId, "--yes"],
      { mutateDiscounts: result({ kind: "delete-discount" }) }
    );
    const discount = await runInspection(
      ["discounts", "delete", storedDiscountId, "--yes"],
      {
        mutateDiscounts: result({
          kind: "create-discount",
          createdDiscountId: "discount-9",
        }),
      }
    );
    const code = await runInspection(
      ["discounts", "delete", storedDiscountId, "--yes"],
      {
        mutateDiscounts: result({
          kind: "create-code",
          createdCodeId: "code-9",
        }),
      }
    );
    const voucher = await runInspection(
      ["discounts", "delete", storedDiscountId, "--yes"],
      {
        mutateDiscounts: result({
          kind: "create-voucher",
          createdVoucherId: "voucher-9",
        }),
      }
    );

    expect(deleted.calls).toEqual([
      [
        "mutateDiscounts",
        expect.any(String),
        { kind: "delete-discount", id: storedDiscountId },
      ],
    ]);
    expect(deleted.output).toEqual(["Discount deleted."]);
    expect(discount.output).toEqual(["Discount created. discount-9"]);
    expect(code.output).toEqual(["Discount code created. code-9"]);
    expect(voucher.output).toEqual(["Voucher created. voucher-9"]);
  });
});

describe("dhw sessions", () => {
  test("lists CLI sessions with their expiry and status", async () => {
    const sessions = [
      {
        ...session,
        id: "session-active",
        expiresAt: "2999-01-01T00:00:00.000Z",
        revokedAt: null,
      },
      { ...session, id: "session-forever", expiresAt: null, revokedAt: null },
      {
        ...session,
        id: "session-expired",
        expiresAt: "2020-01-01T00:00:00.000Z",
        revokedAt: null,
      },
      {
        ...session,
        id: "session-revoked",
        expiresAt: "2020-01-01T00:00:00.000Z",
        revokedAt: "2019-12-01T00:00:00.000Z",
      },
    ];

    const json = await runInspection(["--json", "sessions", "list"], {
      listSessions: sessions,
    });
    const text = await runInspection(["sessions", "list"], {
      listSessions: sessions,
    });

    expect(json.output).toEqual([JSON.stringify(sessions)]);
    const row = (id: string, expiry: string, status: string) =>
      [
        id,
        "test client",
        "1.3.0",
        "development",
        "2026-08-10T10:00:00.000Z",
        expiry,
        status,
      ].join("\t");
    expect(text.output).toEqual([
      "CLI sessions: 4",
      row("session-active", "2999-01-01T00:00:00.000Z", "Active"),
      row("session-forever", "Never expires", "Active"),
      row("session-expired", "2020-01-01T00:00:00.000Z", "Expired"),
      row("session-revoked", "2020-01-01T00:00:00.000Z", "Revoked"),
    ]);
  });
});
