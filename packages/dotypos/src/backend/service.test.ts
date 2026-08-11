import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger, Predicate, References, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  DotyposRuntimeConfigSchema,
  makeDotyposRuntimeConfigLayer,
} from "../config";
import type {
  Category,
  Customer,
  Reservation,
  Table,
} from "../generated/effect.gen";
import {
  DotyposCategorySchema,
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  DotyposDiscountGroupIdSchema,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
  DotyposTableIdSchema,
  DotyposTableSchema,
} from "../types";
import { DotyposService } from "./service";

const config = Schema.decodeUnknownSync(DotyposRuntimeConfigSchema)({
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  cloudId: "cloud-id",
  branchId: "branch-id",
  employeeId: "employee-id",
  apiUrl: "https://dotypos.example.test",
  apiTimeout: 1000,
  reservationTableIds: ["table-id"],
});

const dotyposCustomerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema);
const dotyposDiscountGroupId = Schema.decodeUnknownSync(
  DotyposDiscountGroupIdSchema
);
const dotyposReservationId = Schema.decodeUnknownSync(
  DotyposReservationIdSchema
);
const dotyposTableId = Schema.decodeUnknownSync(DotyposTableIdSchema);

const omitUndefinedProperties = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, property]) => property !== undefined)
  );

const customer = (overrides: Partial<Customer> = {}) =>
  Schema.decodeUnknownSync(DotyposCustomerSchema)(
    omitUndefinedProperties({
      _cloudId: config.cloudId,
      id: "customer-id",
      firstName: "Ada",
      points: null,
      flags: "0",
      display: true,
      deleted: false,
      ...overrides,
    })
  );

const reservation = (overrides: Partial<Reservation> = {}) =>
  Schema.decodeUnknownSync(DotyposReservationSchema)({
    id: "reservation-id",
    _branchId: config.branchId,
    _cloudId: config.cloudId,
    _customerId: dotyposCustomerId("customer-id"),
    _tableId: dotyposTableId("table-id"),
    startDate: "2026-06-20T10:00:00.000Z",
    endDate: "2026-06-20T12:00:00.000Z",
    seats: "2",
    status: "NEW",
    ...overrides,
  });

const table = (overrides: Partial<Table> = {}) =>
  Schema.decodeUnknownSync(DotyposTableSchema)({
    id: "table-id",
    _cloudId: config.cloudId,
    name: "Table 1",
    display: true,
    enabled: true,
    ...overrides,
  });

const category = (overrides: Partial<Category> = {}) =>
  Schema.decodeUnknownSync(DotyposCategorySchema)({
    id: "category-id",
    _cloudId: config.cloudId,
    name: "Coffee",
    tags: null,
    ...overrides,
  });

type FetchCall = [RequestInfo | URL, RequestInit?];

type CapturedLog = {
  readonly message: unknown;
  readonly annotations: Readonly<Record<string, unknown>>;
};

const captureLogs = (logs: CapturedLog[]) =>
  Logger.make((options) => {
    logs.push({
      message: options.message,
      annotations: options.fiber.getRef(
        References.CurrentLogAnnotations
      ) as Readonly<Record<string, unknown>>,
    });
  });

const logText = (value: unknown) => JSON.stringify(value);

const messageParts = (message: unknown): readonly unknown[] =>
  Array.isArray(message) ? message : [message];

const getRequest = ([input, init]: FetchCall) =>
  input instanceof Request ? input : new Request(input, init);

const getUrl = (call: FetchCall) => getRequest(call).url;

const getMethod = (call: FetchCall) => getRequest(call).method;

const getHeader = (call: FetchCall, name: string) =>
  getRequest(call).headers.get(name);

const readJsonBody = async (call: FetchCall) =>
  JSON.parse(await getRequest(call).clone().text());

const mockDotyposFetch = (
  handler: (request: Request) => Response | Promise<Response>
) => {
  const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(getRequest([input, init]))
  );
  return fetchMock as unknown as typeof globalThis.fetch & typeof fetchMock;
};

const tokenResponse = () => Response.json({ accessToken: "access-token" });

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, DotyposService>,
  fetchMock: typeof globalThis.fetch
) => {
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );
  const serviceLayer = DotyposService.DefaultWithoutDependencies.pipe(
    Layer.provide(
      Layer.merge(makeDotyposRuntimeConfigLayer(config), httpClientLayer)
    )
  );

  return Effect.runPromise(effect.pipe(Effect.provide(serviceLayer)));
};

describe("DotyposService customer lookup", () => {
  test("fuzzily searches customer names and email without duplicates", async () => {
    const ada = customer({
      id: "ada",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
    });
    const company = customer({
      id: "analytical-engines",
      companyName: "Analytical Engines",
      email: "team@analytical.example",
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname !== "/clouds/cloud-id/customers") {
        return new Response("Not found", { status: 404 });
      }
      const filter = url.searchParams.get("filter");
      if (filter === "firstName|like|ada") {
        return Response.json({ data: [ada] });
      }
      if (filter === "email|like|ada") {
        return Response.json({ data: [ada, company] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.searchCustomers("  ada  ");
      }),
      fetchMock
    );

    expect(result).toEqual([ada, company]);
    expect(
      fetchMock.mock.calls
        .map((call) => new URL(getUrl(call as FetchCall)))
        .filter(({ pathname }) => pathname.endsWith("/customers"))
        .map((url) => url.searchParams.get("filter"))
        .toSorted()
    ).toEqual([
      "companyName|like|ada",
      "email|like|ada",
      "firstName|like|ada",
      "lastName|like|ada",
    ]);
  });

  test("follows every page of fuzzy customer search results", async () => {
    const firstPageCustomer = customer({ id: "first-page" });
    const secondPageCustomer = customer({ id: "second-page" });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname !== "/clouds/cloud-id/customers") {
        return new Response("Not found", { status: 404 });
      }
      if (url.searchParams.get("filter") !== "firstName|like|ada") {
        return new Response("Not found", { status: 404 });
      }
      return url.searchParams.get("page") === "2"
        ? Response.json({ data: [secondPageCustomer], nextPage: null })
        : Response.json({ data: [firstPageCustomer], nextPage: "2" });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.searchCustomers("ada");
      }),
      fetchMock
    );

    expect(result).toEqual([firstPageCustomer, secondPageCustomer]);
    expect(
      fetchMock.mock.calls
        .map((call) => new URL(getUrl(call as FetchCall)))
        .filter(
          (url) =>
            url.pathname.endsWith("/customers") &&
            url.searchParams.get("filter") === "firstName|like|ada"
        )
        .map((url) => url.searchParams.get("page"))
    ).toEqual(["1", "2"]);
  });

  test("requests a token once, searches by exact email, and sends bearer auth", async () => {
    const matched = customer({ id: "email-match", email: "ada@example.com" });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json({
          data: [
            customer({ id: "partial", email: "not-ada@example.com" }),
            matched,
          ],
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        const first = yield* dotypos.findCustomer(
          {
            firstName: "Ada",
            email: "ada@example.com",
          },
          undefined
        );
        yield* dotypos.findCustomer(
          {
            firstName: "Ada",
            email: "ada@example.com",
          },
          undefined
        );
        return first;
      }),
      fetchMock
    );

    expect(result).toEqual({
      _tag: "Matched",
      customer: matched,
      matches: [matched],
    });

    const tokenCalls = fetchMock.mock.calls.filter((call) =>
      getUrl(call as FetchCall).endsWith("/signin/token")
    ) as FetchCall[];
    expect(tokenCalls).toHaveLength(1);
    const tokenCall = tokenCalls[0]!;
    expect(getMethod(tokenCall)).toBe("POST");
    expect(getHeader(tokenCall, "Authorization")).toBe("User refresh-token");
    expect(await readJsonBody(tokenCall)).toEqual({ _cloudId: "cloud-id" });

    const searchCall = fetchMock.mock.calls.find((call) =>
      getUrl(call as FetchCall).includes("/customers")
    ) as FetchCall;
    const searchUrl = new URL(getUrl(searchCall));
    expect(searchUrl.searchParams.get("filter")).toBe(
      "email|like|ada@example.com"
    );
    expect(searchUrl.searchParams.get("limit")).toBe("100");
    expect(getHeader(searchCall, "Authorization")).toBe("Bearer access-token");
  });

  test("accepts nullable customer tags", async () => {
    const matched = customer({
      id: "email-match",
      email: "ada@example.com",
      tags: null,
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json({ data: [matched] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          {
            firstName: "Ada",
            email: "ada@example.com",
          },
          undefined
        );
      }),
      fetchMock
    );

    expect(result).toEqual({
      _tag: "Matched",
      customer: matched,
      matches: [matched],
    });
  });

  test("does not cache failed token fetches", async () => {
    const matched = customer({ id: "email-match", email: "ada@example.com" });
    let tokenAttempts = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") {
        tokenAttempts += 1;
        if (tokenAttempts === 1) {
          return Response.json(
            { error: "server", error_description: "Server error", code: 500 },
            { status: 500 }
          );
        }
        return tokenResponse();
      }
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json({ data: [matched] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          {
            firstName: "Ada",
            email: "ada@example.com",
          },
          undefined
        );
      }),
      fetchMock
    );

    expect(result).toEqual({
      _tag: "Matched",
      customer: matched,
      matches: [matched],
    });
    expect(tokenAttempts).toBe(2);
  });

  test("maps customer search 404 to no match", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json(
          { error: "not_found", error_description: "No customers", code: 404 },
          { status: 404 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          {
            firstName: "Ada",
            email: "ada@example.com",
          },
          undefined
        );
      }),
      fetchMock
    );

    expect(result).toEqual({ _tag: "NotFound", matches: [] });
  });

  test("keeps matched customer usable when update fails", async () => {
    const matched = customer({
      id: "customer-id",
      firstName: "Ada",
      email: "ada@example.com",
      lastName: undefined,
    });
    let updateAttempts = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") return Response.json({ data: [matched] });
      }
      if (url.pathname === "/clouds/cloud-id/customers/customer-id") {
        if (request.method === "PUT") {
          updateAttempts += 1;
          return Response.json(
            { error: "server", error_description: "Server error", code: 500 },
            { status: 500 }
          );
        }
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer(
          {
            firstName: "Ada",
            lastName: "Lovelace",
            email: "ada@example.com",
          },
          undefined
        );
      }),
      fetchMock
    );

    expect(result).toEqual(matched);
    expect(updateAttempts).toBeGreaterThan(1);
  });

  test("logs createCustomer failures with provider details", async () => {
    const logs: CapturedLog[] = [];
    const providerDescription = `firstName=Ada; lastName=Lovelace; email=ada.secret@example.com; phone=+420 777 123 456; ${"x".repeat(700)}`;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") return Response.json({ data: [] });
        if (request.method === "POST") {
          return Response.json(
            {
              error: "validation_failed",
              error_description: providerDescription,
              code: 400,
            },
            { status: 400 }
          );
        }
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer(
          {
            firstName: "Ada",
            lastName: "Lovelace",
            email: "ada.secret@example.com",
            phone: "+420 777 123 456",
          },
          undefined
        );
      }).pipe(Effect.result, Effect.provide(Logger.layer([captureLogs(logs)]))),
      fetchMock
    );

    expect(Predicate.isTagged(result, "Failure")).toBe(true);
    if (!Predicate.isTagged(result, "Failure")) return;
    expect(Predicate.isTagged(result.failure, "ExternalAPIError")).toBe(true);
    if (!Predicate.isTagged(result.failure, "ExternalAPIError")) return;

    expect(result.failure).toMatchObject({
      _tag: "ExternalAPIError",
      service: "Dotypos",
      operation: "createCustomer",
      statusCode: 400,
      message: "Dotypos API request failed",
      providerError: {
        error: "validation_failed",
        errorDescription: providerDescription,
        code: 400,
      },
    });
    expect(result.failure.cause).toBeUndefined();

    const failureLog = logs.find((log) =>
      messageParts(log.message).includes("Dotypos customer creation failed")
    );
    expect(failureLog).toBeDefined();
    if (!failureLog) return;

    const payload = messageParts(failureLog.message).find(
      (part): part is Record<string, unknown> =>
        typeof part === "object" && part !== null
    );
    expect(payload).toMatchObject({
      errorTag: "ExternalAPIError",
      operation: "createCustomer",
      statusCode: 400,
      providerError: {
        error: "validation_failed",
        errorDescription: providerDescription,
        code: 400,
      },
      createCustomerRequestFields: [
        "_cloudId",
        "addressLine1",
        "barcode",
        "companyId",
        "companyName",
        "deleted",
        "display",
        "firstName",
        "flags",
        "headerPrint",
        "hexColor",
        "internalNote",
        "lastName",
        "email",
        "phone",
        "points",
        "tags",
        "vatId",
        "zip",
        "expireDate",
      ],
    });
    expect(failureLog.annotations).toMatchObject({
      lookupFields: ["email", "phone"],
      customerInputFields: ["firstName", "lastName", "email", "phone"],
      createCustomerRequestFields: [
        "_cloudId",
        "addressLine1",
        "barcode",
        "companyId",
        "companyName",
        "deleted",
        "display",
        "firstName",
        "flags",
        "headerPrint",
        "hexColor",
        "internalNote",
        "lastName",
        "email",
        "phone",
        "points",
        "tags",
        "vatId",
        "zip",
        "expireDate",
      ],
    });

    const annotations = logText(failureLog.annotations);
    expect(annotations).not.toContain("ada.secret@example.com");
    expect(annotations).not.toContain("+420 777 123 456");
    expect(annotations).not.toContain("Ada");
    expect(annotations).not.toContain("Lovelace");
    expect(annotations).not.toContain(providerDescription);
  });

  test("creates customers with Dotypos-required defaults", async () => {
    const created = customer({
      id: "created-customer",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "+420777123456",
    });
    const fetchMock = mockDotyposFetch(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") return Response.json({ data: [] });
        if (request.method === "POST") return Response.json([created]);
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer(
          {
            firstName: "Ada",
            lastName: "Lovelace",
            email: "ada@example.com",
            phone: "+420 777 123 456",
          },
          undefined
        );
      }),
      fetchMock
    );

    expect(result).toEqual(created);

    const createCall = fetchMock.mock.calls.find(
      (call) =>
        getMethod(call as FetchCall) === "POST" &&
        getUrl(call as FetchCall).includes("/customers")
    ) as FetchCall;
    expect(await readJsonBody(createCall)).toEqual([
      {
        _cloudId: config.cloudId,
        addressLine1: "",
        barcode: "",
        companyId: "",
        companyName: "",
        deleted: false,
        display: true,
        firstName: "Ada",
        flags: "0",
        headerPrint: "",
        hexColor: "#000000",
        internalNote: "",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "+420777123456",
        points: "0",
        tags: [],
        vatId: "",
        zip: "",
        expireDate: null,
      },
    ]);
  });

  test("does not create or reuse a customer when lookup is ambiguous", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") {
          return Response.json({
            data: [
              customer({ id: "first", email: "ada@example.com" }),
              customer({ id: "second", email: "ada@example.com" }),
            ],
          });
        }
        if (request.method === "POST") throw new Error("unused");
      }
      return new Response("Not found", { status: 404 });
    });

    const error = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer(
          {
            firstName: "Ada",
            email: "ada@example.com",
          },
          undefined
        );
      }).pipe(Effect.flip),
      fetchMock
    );

    expect(Predicate.isTagged(error, "ValidationError")).toBe(true);
  });

  test("ignores deleted customers when checking lookup ambiguity", async () => {
    const active = customer({ id: "active", email: "ada@example.com" });
    const deleted = customer({
      deleted: true,
      id: "deleted",
      email: "ada@example.com",
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") {
          return Response.json({ data: [active, deleted] });
        }
        if (request.method === "POST") throw new Error("unused");
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer(
          {
            firstName: "Ada",
            email: "ada@example.com",
          },
          undefined
        );
      }),
      fetchMock
    );

    expect(result).toEqual(active);
  });
});

describe("DotyposService reservations", () => {
  test("preserves a not-found status when the error body is undocumented", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations/missing") {
        return Response.json(["Reservation not found"], { status: 404 });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .getReservation(dotyposReservationId("missing"))
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(Predicate.isTagged(result, "Failure")).toBe(true);
    if (Predicate.isTagged(result, "Failure")) {
      expect(result.failure).toMatchObject({
        _tag: "ExternalAPIError",
        operation: "getReservation",
        statusCode: 404,
      });
    }
  });

  test("reads only the reservation when checking its status", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "GET"
      ) {
        return Response.json(reservation({ status: "CANCELLED" }));
      }
      return new Response("Not found", { status: 404 });
    });

    const status = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getReservationStatus(
          dotyposReservationId(" reservation-id ")
        );
      }),
      fetchMock
    );

    expect(status).toBe("CANCELLED");
    expect(
      fetchMock.mock.calls.filter((call) =>
        getUrl(call as FetchCall).includes("/customers/")
      )
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter((call) =>
        getUrl(call as FetchCall).includes("/reservations/reservation-id")
      )
    ).toHaveLength(1);
  });

  test("creates reservations with the generated array payload and retries empty responses", async () => {
    let reservationAttempts = 0;
    const fetchMock = mockDotyposFetch(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations" &&
        request.method === "POST"
      ) {
        reservationAttempts += 1;
        if (reservationAttempts === 1) {
          return Response.json([]);
        }
        return Response.json([reservation()]);
      }
      return new Response("Not found", { status: 404 });
    });

    const input = {
      customerId: dotyposCustomerId(" customer-id "),
      tableId: dotyposTableId(" table-id "),
      startDate: new Date("2026-06-20T10:00:00.000Z"),
      endDate: new Date("2026-06-20T12:00:00.000Z"),
      seats: 2,
      status: "NEW" as const,
      note: " setup note ",
    };

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.createReservation(input);
      }),
      fetchMock
    );

    expect(result.id).toBe(dotyposReservationId("reservation-id"));
    expect(reservationAttempts).toBe(2);

    const createCall = fetchMock.mock.calls.find(
      (call) =>
        getMethod(call as FetchCall) === "POST" &&
        getUrl(call as FetchCall).includes("/reservations")
    ) as FetchCall;
    expect(await readJsonBody(createCall)).toEqual([
      {
        _branchId: config.branchId,
        _cloudId: config.cloudId,
        _customerId: dotyposCustomerId("customer-id"),
        _tableId: dotyposTableId("table-id"),
        _employeeId: config.employeeId,
        startDate: input.startDate.getTime(),
        endDate: input.endDate.getTime(),
        seats: 2,
        status: "NEW",
        flags: 0,
        note: "setup note",
      },
    ]);
  });

  test("confirms by reading ETag and patching with If-Match", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "GET"
      ) {
        return Response.json(reservation(), {
          headers: { etag: '"reservation-etag"' },
        });
      }
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "PATCH"
      ) {
        return Response.json(reservation({ status: "CONFIRMED" }));
      }
      return new Response("Not found", { status: 404 });
    });

    await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.confirmReservation(
          dotyposReservationId(" reservation-id ")
        );
      }),
      fetchMock
    );

    const patchCall = fetchMock.mock.calls.find(
      (call) => getMethod(call as FetchCall) === "PATCH"
    ) as FetchCall;
    expect(getHeader(patchCall, "If-Match")).toBe('"reservation-etag"');
    expect(getHeader(patchCall, "Authorization")).toBe("Bearer access-token");
    expect(await readJsonBody(patchCall)).toEqual({ status: "CONFIRMED" });
  });

  test("updates a reservation note with an ETag-protected patch", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "GET"
      ) {
        return Response.json(reservation(), {
          headers: { etag: '"reservation-etag"' },
        });
      }
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "PATCH"
      ) {
        return Response.json(reservation({ note: "accepted quote" }));
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.updateReservation({
          reservationId: dotyposReservationId(" reservation-id "),
          note: " accepted quote ",
        });
      }),
      fetchMock
    );

    expect(result.note).toBe("accepted quote");
    const patchCall = fetchMock.mock.calls.find(
      (call) => getMethod(call as FetchCall) === "PATCH"
    ) as FetchCall;
    expect(getHeader(patchCall, "If-Match")).toBe('"reservation-etag"');
    expect(await readJsonBody(patchCall)).toEqual({ note: "accepted quote" });
  });

  test("rejects an empty reservation update note before calling Dotypos", async () => {
    const fetchMock = mockDotyposFetch(() => {
      throw new Error("unused");
    });

    const errors = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .updateReservation({
            reservationId: dotyposReservationId("reservation-id"),
            note: " ",
          })
          .pipe(Effect.flip);
      }),
      fetchMock
    );

    expect(errors._tag).toBe("ValidationError");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fails without patching when the reservation ETag is missing", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "GET"
      ) {
        return Response.json(reservation());
      }
      return new Response("Not found", { status: 404 });
    });

    const error = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .updateReservation({
            reservationId: dotyposReservationId("reservation-id"),
            note: "accepted quote",
          })
          .pipe(Effect.flip);
      }),
      fetchMock
    );

    expect(error).toMatchObject({
      _tag: "ExternalAPIError",
      operation: "getReservation",
      message: "Reservation ETag header was missing.",
    });
    expect(
      fetchMock.mock.calls.some(
        (call) => getMethod(call as FetchCall) === "PATCH"
      )
    ).toBe(false);
  });
});

describe("DotyposService categories", () => {
  test("accepts nullable category tags", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/categories") {
        return Response.json({ data: [category()] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getCategories();
      }),
      fetchMock
    );

    expect(result).toEqual([category()]);
  });
});

describe("DotyposService customer discounts", () => {
  test("loads every discount group page", async () => {
    const requestedPages: string[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/discount-groups") {
        const page = url.searchParams.get("page") ?? "1";
        requestedPages.push(page);
        return Response.json(
          page === "1"
            ? {
                data: [
                  {
                    id: "ten",
                    discountPercent: "10",
                    deleted: false,
                    name: "Ten percent",
                  },
                ],
                nextPage: "2",
              }
            : {
                data: [
                  {
                    id: "twenty",
                    discountPercent: "20",
                    deleted: false,
                    name: "Twenty percent",
                  },
                ],
                nextPage: null,
              }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getDiscountGroups();
      }),
      fetchMock
    );

    expect(
      result.map(({ id, discountPercent }) => ({ id, discountPercent }))
    ).toEqual([
      { id: dotyposDiscountGroupId("ten"), discountPercent: "10" },
      { id: dotyposDiscountGroupId("twenty"), discountPercent: "20" },
    ]);
    expect(requestedPages).toEqual(["1", "2"]);
  });

  test("preserves a later-page discount group failure", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/discount-groups") {
        const page = url.searchParams.get("page") ?? "1";
        if (page === "1") {
          return Response.json({
            data: [
              {
                id: "ten",
                discountPercent: "10",
                deleted: false,
                name: "Ten percent",
              },
            ],
            nextPage: "2",
          });
        }
        return Response.json(
          { error: "not_found", error_description: "Not found" },
          { status: 404 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const error = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getDiscountGroups().pipe(Effect.flip);
      }),
      fetchMock
    );

    expect(error).toMatchObject({
      _tag: "ExternalAPIError",
      operation: "getDiscountGroups",
      statusCode: 404,
    });
  });

  test("assigns a customer discount group with the current ETag", async () => {
    const requests: Request[] = [];
    const fetchMock = mockDotyposFetch(async (request) => {
      requests.push(request.clone());
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/customers/customer-id" &&
        request.method === "GET"
      ) {
        return Response.json(customer(), {
          headers: { ETag: '"customer-version"' },
        });
      }
      if (
        url.pathname === "/clouds/cloud-id/customers/customer-id" &&
        request.method === "PATCH"
      ) {
        return Response.json(
          customer({ _discountGroupId: dotyposDiscountGroupId("group-id") })
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.setCustomerDiscountGroup(
          dotyposCustomerId("customer-id"),
          dotyposDiscountGroupId("group-id")
        );
      }),
      fetchMock
    );

    const patchRequest = requests.find(({ method }) => method === "PATCH");
    expect(patchRequest).toBeDefined();
    expect(patchRequest?.headers.get("if-match")).toBe('"customer-version"');
    expect(await patchRequest?.json()).toEqual({
      _discountGroupId: dotyposDiscountGroupId("group-id"),
    });
    expect(result._discountGroupId).toBe(dotyposDiscountGroupId("group-id"));
  });

  test("loads a customer's generated discount group by customer ID", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers/customer-id") {
        return Response.json(
          customer({ _discountGroupId: dotyposDiscountGroupId("group-id") })
        );
      }
      if (url.pathname === "/clouds/cloud-id/discount-groups/group-id") {
        return Response.json({ discountPercent: "12.5" });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getCustomerDiscountGroup({
          customerId: dotyposCustomerId("customer-id"),
        });
      }),
      fetchMock
    );

    expect(result).toEqual({
      discountGroupId: dotyposDiscountGroupId("group-id"),
      discountPercent: "12.5",
    });
  });

  test('accepts "10" and ignores out-of-range discounts', async () => {
    const discounts: Record<string, string> = {
      ten: "10",
      zero: "0",
      tooHigh: "101",
    };
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      const match = url.pathname.match(/\/discount-groups\/(.+)$/);
      if (match) {
        const discountGroupId = match[1]!;
        return Response.json({
          id: discountGroupId,
          discountPercent: discounts[discountGroupId],
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* Effect.all([
          dotypos.getCustomerDiscount(
            customer({ _discountGroupId: dotyposDiscountGroupId("ten") })
          ),
          dotypos.getCustomerDiscount(
            customer({ _discountGroupId: dotyposDiscountGroupId("zero") })
          ),
          dotypos.getCustomerDiscount(
            customer({ _discountGroupId: dotyposDiscountGroupId("tooHigh") })
          ),
        ]);
      }),
      fetchMock
    );

    expect(result).toEqual([
      {
        source: "dotypos-discount-group",
        discountGroupId: dotyposDiscountGroupId("ten"),
        percent: 10,
      },
      undefined,
      undefined,
    ]);
  });
});

describe("DotyposService reservation listing", () => {
  test("filters active reservations by half-open overlap", async () => {
    const interval = {
      startDate: new Date("2026-06-20T10:00:00.000Z"),
      endDate: new Date("2026-06-20T12:00:00.000Z"),
    };
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        return Response.json({ data: [reservation()] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listActiveReservationsOverlapping(interval);
      }),
      fetchMock
    );

    expect(result).toHaveLength(1);
    const request = fetchMock.mock.calls
      .map((call) => new URL(getUrl(call as FetchCall)))
      .find((url) => url.pathname === "/clouds/cloud-id/reservations");
    expect(request?.searchParams.get("filter")).toBe(
      [
        "status|in|NEW,CONFIRMED",
        `startDate|lt|${interval.endDate.getTime()}`,
        `endDate|gt|${interval.startDate.getTime()}`,
      ].join(";")
    );
  });

  test("keeps the default reservation listing unfiltered", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        return Response.json({ data: [] });
      }
      return new Response("Not found", { status: 404 });
    });

    await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations();
      }),
      fetchMock
    );

    const request = fetchMock.mock.calls
      .map((call) => new URL(getUrl(call as FetchCall)))
      .find((url) => url.pathname === "/clouds/cloud-id/reservations");
    expect(request?.searchParams.has("filter")).toBe(false);
  });

  test("treats a first-page 404 as an empty reservation list", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        return Response.json(
          { error: "not_found", error_description: "Not found" },
          { status: 404 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations();
      }),
      fetchMock
    );

    expect(result).toEqual([]);
  });

  test("treats a first-page 404 with a null body as empty", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        return Response.json(null, { status: 404 });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listActiveReservationsOverlapping({
          startDate: new Date("2026-06-20T10:00:00Z"),
          endDate: new Date("2026-06-20T12:00:00Z"),
        });
      }),
      fetchMock
    );

    expect(result).toEqual([]);
  });

  test("accepts nullable reservation notes", async () => {
    const liveReservation = {
      ...reservation(),
      note: null,
    };
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        return Response.json({ data: [liveReservation] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations();
      }),
      fetchMock
    );

    expect(result).toEqual([liveReservation]);
  });

  test("accepts live whole-second UTC reservation timestamps", async () => {
    const liveReservation = reservation({
      startDate: "2026-06-20T10:00:00Z",
      endDate: "2026-06-20T12:00:00Z",
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        return Response.json({ data: [liveReservation] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations();
      }),
      fetchMock
    );

    expect(result).toEqual([liveReservation]);
  });

  test("accepts reservation timestamps with an ISO 8601 numeric offset", async () => {
    const offsetReservation = reservation({
      startDate: "2026-06-20T12:00:00.000+02:00",
      endDate: "2026-06-20T14:00:00.000+02:00",
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        return Response.json({ data: [offsetReservation] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations();
      }),
      fetchMock
    );

    expect(result).toEqual([offsetReservation]);
  });

  test("loads every reservation page", async () => {
    const firstReservation = reservation({ id: "reservation-1" });
    const secondReservation = reservation({ id: "reservation-2" });
    const requestedPages: string[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        const page = url.searchParams.get("page") ?? "1";
        requestedPages.push(page);

        return Response.json(
          page === "1"
            ? {
                currentPage: "1",
                perPage: "100",
                totalItemsOnPage: "1",
                totalItemsCount: "2",
                firstPage: "1",
                lastPage: "2",
                nextPage: "2",
                prevPage: null,
                data: [firstReservation],
              }
            : {
                currentPage: "2",
                perPage: "100",
                totalItemsOnPage: "1",
                totalItemsCount: "2",
                firstPage: "1",
                lastPage: "2",
                nextPage: null,
                prevPage: "1",
                data: [secondReservation],
              }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations();
      }),
      fetchMock
    );

    expect(result).toEqual([firstReservation, secondReservation]);
    expect(requestedPages).toEqual(["1", "2"]);
  });

  test("filters reservations with domain-shaped options", async () => {
    const requestedQueries: URLSearchParams[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        requestedQueries.push(url.searchParams);
        return Response.json({ data: [] });
      }
      return new Response("Not found", { status: 404 });
    });

    await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations({
          customerId: dotyposCustomerId("customer-id"),
          startsAtOrAfter: "2026-08-04T00:00:00+02:00",
          startsBefore: "2026-08-05T00:00:00+02:00",
          order: "startDateDescending",
        });
      }),
      fetchMock
    );

    expect(requestedQueries).toHaveLength(1);
    expect(requestedQueries[0]?.get("filter")).toBe(
      "_customerId|eq|customer-id;startDate|gteq|2026-08-04T00:00:00+02:00;startDate|lt|2026-08-05T00:00:00+02:00"
    );
    expect(requestedQueries[0]?.get("sort")).toBe("-startDate");
  });

  test("rejects reservation filter delimiters", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .listReservations({
            customerId: dotyposCustomerId("customer|eq|other"),
          })
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ValidationError" },
    });
  });

  test("preserves a later-page 404 as an API error", async () => {
    const firstReservation = reservation({ id: "reservation-1" });
    const requestedPages: string[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        const page = url.searchParams.get("page") ?? "1";
        requestedPages.push(page);

        return page === "1"
          ? Response.json({
              currentPage: "1",
              perPage: "100",
              totalItemsOnPage: "1",
              totalItemsCount: "2",
              firstPage: "1",
              lastPage: "2",
              nextPage: "2",
              prevPage: null,
              data: [firstReservation],
            })
          : Response.json(
              { error: "not_found", error_description: "Not found" },
              { status: 404 }
            );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations().pipe(Effect.result);
      }),
      fetchMock
    );

    expect(Predicate.isTagged(result, "Failure")).toBe(true);
    if (Predicate.isTagged(result, "Failure")) {
      expect(result.failure).toMatchObject({
        _tag: "ExternalAPIError",
        operation: "listReservations",
        statusCode: 404,
      });
    }
    expect(requestedPages).toEqual(["1", "2"]);
  });

  test("preserves typed Dotypos API errors", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations") {
        return Response.json(
          { error: "forbidden", error_description: "Forbidden", code: 403 },
          { status: 403 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations().pipe(Effect.result);
      }),
      fetchMock
    );

    expect(Predicate.isTagged(result, "Failure")).toBe(true);
    if (Predicate.isTagged(result, "Failure")) {
      expect(result.failure).toMatchObject({
        _tag: "ExternalAPIError",
        service: "Dotypos",
        operation: "listReservations",
        statusCode: 403,
      });
    }
  });
});

describe("DotyposService table listing", () => {
  test("loads every table page", async () => {
    const firstTable = table({ id: "table-1", name: "Table 1" });
    const secondTable = table({ id: "table-2", name: "Table 2" });
    const requestedPages: string[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/tables") {
        const page = url.searchParams.get("page") ?? "1";
        requestedPages.push(page);

        return Response.json(
          page === "1"
            ? {
                currentPage: "1",
                perPage: "100",
                totalItemsOnPage: "1",
                totalItemsCount: "2",
                firstPage: "1",
                lastPage: "2",
                nextPage: "2",
                prevPage: null,
                data: [firstTable],
              }
            : {
                currentPage: "2",
                perPage: "100",
                totalItemsOnPage: "1",
                totalItemsCount: "2",
                firstPage: "1",
                lastPage: "2",
                nextPage: null,
                prevPage: "1",
                data: [secondTable],
              }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getTables();
      }),
      fetchMock
    );

    expect(result).toEqual([firstTable, secondTable]);
    expect(requestedPages).toEqual(["1", "2"]);
  });
});
