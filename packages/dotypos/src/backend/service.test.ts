import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger, Predicate, References } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { makeDotyposRuntimeConfigLayer } from "../config";
import type { Category, Customer, Reservation } from "../generated/effect.gen";
import { DotyposService } from "./service";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  cloudId: "cloud-id",
  branchId: "branch-id",
  employeeId: "employee-id",
  apiUrl: "https://dotypos.example.test",
  apiTimeout: 1000,
  reservationTableIds: ["table-id"],
};

const customer = (overrides: Partial<Customer> = {}): Customer => ({
  _cloudId: config.cloudId,
  id: "customer-id",
  firstName: "Ada",
  points: null,
  flags: "0",
  display: true,
  deleted: false,
  ...overrides,
});

const reservation = (overrides: Partial<Reservation> = {}): Reservation => ({
  id: "reservation-id",
  _branchId: config.branchId,
  _cloudId: config.cloudId,
  _customerId: "customer-id",
  _tableId: "table-id",
  startDate: "2026-06-20T10:00:00.000Z",
  endDate: "2026-06-20T12:00:00.000Z",
  seats: "2",
  status: "NEW",
  ...overrides,
});

const category = (overrides: Partial<Category> = {}): Category => ({
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
      customerId: " customer-id ",
      tableId: " table-id ",
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

    expect(result.id).toBe("reservation-id");
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
        _customerId: "customer-id",
        _tableId: "table-id",
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
        return yield* dotypos.confirmReservation(" reservation-id ");
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
  test('accepts "10" and ignores out-of-range discounts', async () => {
    const discounts: Record<string, string | number> = {
      ten: "10",
      zero: 0,
      tooHigh: 101,
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
          dotypos.getCustomerDiscount(customer({ _discountGroupId: "ten" })),
          dotypos.getCustomerDiscount(customer({ _discountGroupId: "zero" })),
          dotypos.getCustomerDiscount(
            customer({ _discountGroupId: "tooHigh" })
          ),
        ]);
      }),
      fetchMock
    );

    expect(result).toEqual([
      {
        source: "dotypos-discount-group",
        discountGroupId: "ten",
        percent: 10,
      },
      undefined,
      undefined,
    ]);
  });
});

describe("DotyposService reservation listing", () => {
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
