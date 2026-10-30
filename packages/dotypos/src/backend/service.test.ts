import { describe, expect, mock, test } from "bun:test";
import { EMAIL_TEST_DOMAIN, testEmailAddress } from "@deskohub/test-email";
import {
  Effect,
  Fiber,
  Layer,
  Logger,
  Option,
  Predicate,
  References,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { dotyposApiTimeoutDefaultMilliseconds } from "../api-timeout";
import {
  DotyposRuntimeConfigSchema,
  makeDotyposRuntimeConfigLayer,
} from "../config";
import type {
  Category,
  Customer,
  DotyposClient,
  Reservation,
  Table,
} from "../generated/effect.gen";
import { dotyposIdReadBatchSize, dotyposIdReadRequests } from "../id-reads";
import {
  DotyposTimestampFromString,
  DotyposTimestampSchema,
} from "../timestamp";
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
import { DotyposAccessToken, DotyposGeneratedClient } from "./api";
import { dotyposRequestProfiles } from "./request-profiles";
import {
  CustomerVersionSelection,
  DotyposService,
  type IDotyposService,
} from "./service";

const adaAddress = testEmailAddress("ada");
const mixedCaseAdaAddress = testEmailAddress("Ada");
const upperLocalAdaAddress = testEmailAddress("ADA");
const adaUpperDomainAddress = `${adaAddress.slice(0, adaAddress.indexOf("@"))}@${EMAIL_TEST_DOMAIN.toUpperCase()}`;
const mixedCaseAdaUpperDomainAddress = `${mixedCaseAdaAddress.slice(0, mixedCaseAdaAddress.indexOf("@"))}@${EMAIL_TEST_DOMAIN.toUpperCase()}`;
const adaPrivateAddress = testEmailAddress("ada.private");
const adaSecretAddress = testEmailAddress("ada.secret");
const billingAddress = testEmailAddress("billing");
const graceAdaAddress = testEmailAddress("grace.ada");
const gracePrivateAddress = testEmailAddress("grace.private");
const notAdaAddress = testEmailAddress("not-ada");
const teamAddress = testEmailAddress("team");

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

const makeServiceLayer = (
  fetchMock: typeof globalThis.fetch,
  serviceConfig = config
) => {
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );
  return DotyposService.Default.pipe(
    Layer.provide(DotyposGeneratedClient.Default),
    Layer.provide(DotyposAccessToken.Default),
    Layer.provide(
      Layer.merge(makeDotyposRuntimeConfigLayer(serviceConfig), httpClientLayer)
    )
  );
};

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, DotyposService>,
  fetchMock: typeof globalThis.fetch
) =>
  Effect.runPromise(effect.pipe(Effect.provide(makeServiceLayer(fetchMock))));

/**
 * Runs on a TestClock that advances in steps far shorter than the request
 * timeout until the effect finishes, so retry backoff elapses instantly. Only
 * for fetch mocks that answer without real-time delays: a mock that waits on a
 * real timer would hit the request timeout.
 */
const runWithServiceRetryingInstantly = <A, E>(
  effect: Effect.Effect<A, E, DotyposService>,
  fetchMock: typeof globalThis.fetch
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* effect.pipe(
        Effect.provide(makeServiceLayer(fetchMock)),
        Effect.forkChild
      );
      while (fiber.pollUnsafe() === undefined) {
        yield* TestClock.adjust("10 millis");
      }
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()))
  );

const runWithServiceClient = <A, E>(
  effect: Effect.Effect<A, E, DotyposService>,
  client: DotyposClient
) => {
  const serviceLayer = DotyposService.Default.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(DotyposGeneratedClient, { client }),
        makeDotyposRuntimeConfigLayer(config)
      )
    )
  );

  return Effect.runPromise(effect.pipe(Effect.provide(serviceLayer)));
};

const makePaginatedClient = (
  loadPage: (
    operation: "getTables" | "listReservations",
    page: number
  ) => unknown
): DotyposClient =>
  // Bypass generated decoding to exercise this runtime boundary with invalid provider values.
  ({
    getTables: (_cloudId: string, options?: { params?: { page?: number } }) =>
      Effect.succeed(loadPage("getTables", options?.params?.page ?? 1)),
    listReservations: (
      _cloudId: string,
      options?: { params?: { page?: number } }
    ) =>
      Effect.succeed(loadPage("listReservations", options?.params?.page ?? 1)),
  }) as unknown as DotyposClient;

describe("DotyposService customer lookup", () => {
  test("retries rate-limited customer reads", async () => {
    let attempts = 0;
    const expected = customer();
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers/customer-id") {
        attempts += 1;
        return attempts === 1
          ? Response.json(
              {
                error: "rate_limited",
                error_description: "Too many requests",
                code: 429,
              },
              { status: 429 }
            )
          : Response.json(expected);
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getCustomer(dotyposCustomerId("customer-id"));
      }),
      fetchMock
    );

    expect(result).toEqual(Option.some(expected));
    expect(attempts).toBe(2);
  });

  test("reads a customer Dotypos answers 404 for as none with one request", async () => {
    let customerRequests = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers/missing") {
        customerRequests += 1;
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getCustomer(dotyposCustomerId("missing"));
      }),
      fetchMock
    );

    expect(result).toEqual(Option.none());
    expect(customerRequests).toBe(1);
  });

  test("fails a customer read when the access-token request answers 404", async () => {
    const fetchMock = mockDotyposFetch(
      () => new Response("Not found", { status: 404 })
    );

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .getCustomer(dotyposCustomerId("customer-id"))
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposRejected",
        reason: "unauthorized",
        operation: "getCustomer",
        request: "customer.get",
        httpStatus: 404,
      },
    });
  });

  test("fuzzily searches customer names and email without duplicates", async () => {
    const ada = customer({
      id: "ada",
      firstName: "Ada",
      lastName: "Lovelace",
      email: adaAddress,
    });
    const company = customer({
      id: "analytical-engines",
      companyName: "Analytical Engines",
      email: teamAddress,
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

  test("fetches a token once, searches by exact email, and sends bearer auth", async () => {
    const matched = customer({ id: "email-match", email: adaAddress });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json({
          data: [customer({ id: "partial", email: notAdaAddress }), matched],
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
            email: adaAddress,
          },
          undefined
        );
        yield* dotypos.findCustomer(
          {
            firstName: "Ada",
            email: adaAddress,
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

    expect(
      fetchMock.mock.calls.filter((call) =>
        getUrl(call as FetchCall).endsWith("/signin/token")
      )
    ).toHaveLength(1);

    const searchCall = fetchMock.mock.calls.find((call) =>
      getUrl(call as FetchCall).includes("/customers")
    ) as FetchCall;
    expect(new URL(getUrl(searchCall)).searchParams.get("filter")).toBe(
      `email|like|${adaAddress};deleted|in|0,1`
    );
    expect(getHeader(searchCall, "Authorization")).toBe("Bearer access-token");
  });

  test("single-flights concurrent token requests", async () => {
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    let tokenCalls = 0;
    const fetchMock = mockDotyposFetch(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") {
        tokenCalls += 1;
        if (tokenCalls === 2) releaseToken();
        await Promise.race([
          tokenGate,
          new Promise((resolve) => setTimeout(resolve, 25)),
        ]);
        return tokenResponse();
      }
      if (url.pathname.startsWith("/clouds/cloud-id/customers/")) {
        return Response.json(customer({ id: url.pathname.split("/").at(-1) }));
      }
      return new Response("Not found", { status: 404 });
    });

    await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        yield* Effect.all(
          [
            dotypos.getCustomer(dotyposCustomerId("customer-1")),
            dotypos.getCustomer(dotyposCustomerId("customer-2")),
          ],
          { concurrency: "unbounded" }
        );
      }),
      fetchMock
    );

    expect(tokenCalls).toBe(1);
  });

  test("loads a customer set with one provider request", async () => {
    const first = customer({ id: "customer-1" });
    const second = customer({ id: "customer-2" });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json({ data: [first, second] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        const customers = yield* dotypos.getCustomersByIds([
          dotyposCustomerId("customer-1"),
          dotyposCustomerId("customer-2"),
          dotyposCustomerId("customer-1"),
        ]);
        yield* dotypos.getCustomersByIds([]);
        return customers;
      }),
      fetchMock
    );

    expect([...result.values()]).toEqual([first, second]);
    const customerCalls = fetchMock.mock.calls
      .map((call) => new URL(getUrl(call as FetchCall)))
      .filter(({ pathname }) => pathname === "/clouds/cloud-id/customers");
    expect(customerCalls).toHaveLength(1);
    expect(customerCalls[0]?.searchParams.get("filter")).toBe(
      "id|in|customer-1,customer-2;deleted|in|0,1"
    );
  });

  test("accepts nullable customer tags", async () => {
    const matched = customer({
      id: "email-match",
      email: adaAddress,
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
            email: adaAddress,
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
    const matched = customer({ id: "email-match", email: adaAddress });
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

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          {
            firstName: "Ada",
            email: adaAddress,
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
            email: adaAddress,
          },
          undefined
        );
      }),
      fetchMock
    );

    expect(result).toEqual({ _tag: "NotFound", matches: [] });
  });

  test("reports deleted-only exact-email matches as Deleted and requests deleted customers in the filter", async () => {
    const deleted = customer({
      id: "deleted-match",
      email: adaAddress,
      deleted: true,
    });
    const filters: (string | null)[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        filters.push(url.searchParams.get("filter"));
        return Response.json({ data: [deleted] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          { firstName: "Ada", email: adaAddress },
          { lookupFields: ["email"] }
        );
      }),
      fetchMock
    );

    expect(filters).toEqual([`email|like|${adaAddress};deleted|in|0,1`]);
    expect(result).toEqual({ _tag: "Deleted", matches: [deleted] });
  });

  test("prefers the active exact-email match among deleted candidates", async () => {
    const deleted = customer({
      id: "deleted-match",
      email: adaAddress,
      deleted: true,
    });
    const active = customer({ id: "active-match", email: adaAddress });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json({ data: [deleted, active] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          { firstName: "Ada", email: adaAddress },
          { lookupFields: ["email"] }
        );
      }),
      fetchMock
    );

    expect(result).toEqual({
      _tag: "Matched",
      customer: active,
      matches: [active],
    });
  });

  test("finds an active exact-email match on a later page behind a full first page of deleted customers", async () => {
    const active = customer({ id: "active-match", email: adaAddress });
    const firstPageDeleted = Array.from({ length: 100 }, (_, index) =>
      customer({
        id: `deleted-${index}`,
        email: adaAddress,
        deleted: true,
      })
    );
    const requestedPages: (string | null)[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        const page = url.searchParams.get("page");
        requestedPages.push(page);
        return page === "2"
          ? Response.json({ data: [active], nextPage: null })
          : Response.json({ data: firstPageDeleted, nextPage: "2" });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          { firstName: "Ada", email: adaAddress },
          { lookupFields: ["email"] }
        );
      }),
      fetchMock
    );

    expect(requestedPages).toEqual(["1", "2"]);
    expect(result).toEqual({
      _tag: "Matched",
      customer: active,
      matches: [active],
    });
  });

  test("reports ambiguity when exact-email matches span two pages", async () => {
    const first = customer({
      id: "first-page-match",
      email: adaAddress,
    });
    const second = customer({
      id: "second-page-match",
      email: adaAddress,
    });
    const requestedPages: (string | null)[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        const page = url.searchParams.get("page");
        requestedPages.push(page);
        return page === "2"
          ? Response.json({ data: [second], nextPage: null })
          : Response.json({ data: [first], nextPage: "2" });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          { firstName: "Ada", email: adaAddress },
          { lookupFields: ["email"] }
        );
      }),
      fetchMock
    );

    expect(requestedPages).toEqual(["1", "2"]);
    expect(result).toEqual({
      _tag: "Ambiguous",
      matches: [first, second],
    });
  });

  test("fails closed when a later customer lookup page errors", async () => {
    const first = customer({
      id: "first-page-match",
      email: adaAddress,
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return url.searchParams.get("page") === "2"
          ? Response.json(
              { error: "server", error_description: "Server error", code: 500 },
              { status: 500 }
            )
          : Response.json({ data: [first], nextPage: "2" });
      }
      return new Response("Not found", { status: 404 });
    });

    const error = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .findCustomer(
            { firstName: "Ada", email: adaAddress },
            { lookupFields: ["email"] }
          )
          .pipe(Effect.flip);
      }),
      fetchMock
    );

    expect(error).toMatchObject({
      _tag: "DotyposUnavailable",
      reason: "server",
      operation: "findCustomer",
      request: "customers.lookup",
      httpStatus: 500,
    });
  });

  test("keeps findOrCreateCustomer creating a fresh customer when only deleted exact-email matches exist", async () => {
    const deleted = customer({
      id: "deleted-match",
      email: adaAddress,
      deleted: true,
    });
    const created = customer({
      id: "freshly-created",
      email: adaAddress,
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") {
          return Response.json({ data: [deleted] });
        }
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
            email: adaAddress,
            phone: "+420 601 111 222",
          },
          { lookupFields: ["email"] }
        );
      }),
      fetchMock
    );

    expect(result).toEqual(created);
  });

  test("keeps matched customer usable when update fails", async () => {
    const matched = customer({
      id: "customer-id",
      firstName: "Ada",
      email: adaAddress,
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

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer(
          {
            firstName: "Ada",
            lastName: "Lovelace",
            email: adaAddress,
          },
          undefined
        );
      }),
      fetchMock
    );

    expect(result).toEqual(matched);
    expect(updateAttempts).toBeGreaterThan(1);
  });

  test("keeps provider error details out of createCustomer logs", async () => {
    const logs: CapturedLog[] = [];
    const providerDescription = `firstName=Ada; lastName=Lovelace; email=${adaSecretAddress}; phone=+420 777 123 456; ${"x".repeat(700)}`;
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
            email: adaSecretAddress,
            phone: "+420 777 123 456",
          },
          undefined
        );
      }).pipe(Effect.result, Effect.provide(Logger.layer([captureLogs(logs)]))),
      fetchMock
    );

    expect(Predicate.isTagged(result, "Failure")).toBe(true);
    if (!Predicate.isTagged(result, "Failure")) return;
    expect(Predicate.isTagged(result.failure, "DotyposRejected")).toBe(true);
    if (!Predicate.isTagged(result.failure, "DotyposRejected")) return;

    expect(result.failure).toMatchObject({
      _tag: "DotyposRejected",
      reason: "invalid-request",
      operation: "findOrCreateCustomer",
      request: "customer.createAfterLookup",
      httpStatus: 400,
    });

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
      errorTag: "DotyposRejected",
      operation: "createCustomer",
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
    expect(annotations).not.toContain(adaSecretAddress);
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
      email: adaAddress,
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
            email: adaAddress,
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
        email: adaAddress,
        phone: "+420777123456",
        points: "0",
        tags: [],
        vatId: "",
        zip: "",
        expireDate: null,
      },
    ]);
  });

  test("creates and updates invoice customer details without a phone, leaving the stored phone untouched", async () => {
    const created = customer({
      id: "invoice-customer",
      firstName: "",
      companyName: "Analytical Engines",
      email: billingAddress,
    });
    const updated = customer({
      ...created,
      addressLine1: "42 Engine Street",
      city: "London",
      zip: "SW1A 1AA",
      country: "GB",
    });
    const fetchMock = mockDotyposFetch(async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json([created]);
      }
      if (
        url.pathname === "/clouds/cloud-id/customers/invoice-customer" &&
        request.method === "GET"
      ) {
        return Response.json(created, { headers: { ETag: '"customer-v1"' } });
      }
      if (
        url.pathname === "/clouds/cloud-id/customers/invoice-customer" &&
        request.method === "PATCH"
      ) {
        return Response.json(updated);
      }
      return new Response("Not found", { status: 404 });
    });

    const details = {
      firstName: "",
      lastName: "",
      email: billingAddress,
      addressLine1: "42 Engine Street",
      addressLine2: "",
      city: "London",
      zip: "SW1A 1AA",
      country: "GB",
      companyName: "Analytical Engines",
      companyId: "12345678",
      vatId: "",
    };
    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        const newCustomer = yield* dotypos.createCustomer(details);
        const savedCustomer = yield* dotypos.updateCustomerDetails(
          dotyposCustomerId("invoice-customer"),
          details
        );
        return { newCustomer, savedCustomer };
      }),
      fetchMock
    );

    expect(result).toEqual({ newCustomer: created, savedCustomer: updated });
    const createCall = fetchMock.mock.calls.find(
      (call) =>
        getMethod(call as FetchCall) === "POST" &&
        getUrl(call as FetchCall).endsWith("/customers")
    ) as FetchCall;
    expect((await readJsonBody(createCall))[0]).toMatchObject({
      email: billingAddress,
      phone: "",
      addressLine1: "42 Engine Street",
      companyName: "Analytical Engines",
    });
    const updateCall = fetchMock.mock.calls.find(
      (call) => getMethod(call as FetchCall) === "PATCH"
    ) as FetchCall;
    const updateBody = await readJsonBody(updateCall);
    expect(updateBody).toMatchObject({
      email: billingAddress,
      addressLine1: "42 Engine Street",
      companyName: "Analytical Engines",
    });
    expect(updateBody).not.toHaveProperty("phone");
  });

  test.each([
    { label: "unparseable", phone: "not a phone", expectedPhone: undefined },
    { label: "valid", phone: "777 123 456", expectedPhone: "+420777123456" },
  ])(
    "updates invoice customer details with a $label phone",
    async ({ phone, expectedPhone }) => {
      const stored = customer({
        id: "invoice-customer",
        email: billingAddress,
        phone: "+420777000111",
      });
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        if (url.pathname === "/clouds/cloud-id/customers/invoice-customer") {
          if (request.method === "GET") {
            return Response.json(stored, {
              headers: { ETag: '"customer-v1"' },
            });
          }
          if (request.method === "PATCH") return Response.json(stored);
        }
        return new Response("Not found", { status: 404 });
      });

      await runWithService(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.updateCustomerDetails(
            dotyposCustomerId("invoice-customer"),
            {
              firstName: "Ada",
              lastName: "Lovelace",
              email: billingAddress,
              phone,
              addressLine1: "42 Engine Street",
              addressLine2: "",
              city: "London",
              zip: "SW1A 1AA",
              country: "GB",
              companyName: "",
              companyId: "",
              vatId: "",
            }
          );
        }),
        fetchMock
      );

      const updateCall = fetchMock.mock.calls.find(
        (call) => getMethod(call as FetchCall) === "PATCH"
      ) as FetchCall;
      const updateBody = await readJsonBody(updateCall);
      if (expectedPhone === undefined) {
        expect(updateBody).not.toHaveProperty("phone");
      } else {
        expect(updateBody.phone).toBe(expectedPhone);
      }
    }
  );

  test("does not retry the non-idempotent invoice customer creation request", async () => {
    let createAttempts = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/customers" &&
        request.method === "POST"
      ) {
        createAttempts += 1;
        return Response.json(
          { error: "server", error_description: "Server error", code: 500 },
          { status: 500 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .createCustomer({
            firstName: "Ada",
            lastName: "Lovelace",
            email: billingAddress,
            addressLine1: "42 Engine Street",
            addressLine2: "",
            city: "London",
            zip: "SW1A 1AA",
            country: "GB",
            companyName: "",
            companyId: "",
            vatId: "",
          })
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result._tag).toBe("Failure");
    expect(createAttempts).toBe(1);
  });

  test("does not retry an ambiguous customer creation during findOrCreateCustomer", async () => {
    let createAttempts = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") return Response.json({ data: [] });
        if (request.method === "POST") {
          createAttempts += 1;
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
        return yield* dotypos
          .findOrCreateCustomer(
            {
              firstName: "Ada",
              lastName: "Lovelace",
              email: adaAddress,
              phone: "+420 777 123 456",
            },
            undefined
          )
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result._tag).toBe("Failure");
    expect(createAttempts).toBe(1);
  });

  test("keeps customer contact details out of findOrCreateCustomer logs", async () => {
    const logs: CapturedLog[] = [];
    const matched = customer({
      id: "customer-id",
      firstName: "Ada",
      lastName: "Lovelace",
      email: adaPrivateAddress,
      phone: undefined,
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") {
          return Response.json({
            data: url.searchParams.get("filter")?.includes("email")
              ? [matched]
              : [],
          });
        }
        if (request.method === "POST") {
          return Response.json([
            customer({
              id: "created-id",
              firstName: "Grace",
              lastName: "Hopper",
              email: gracePrivateAddress,
              phone: "+420777987654",
            }),
          ]);
        }
      }
      if (
        url.pathname === "/clouds/cloud-id/customers/customer-id" &&
        request.method === "PUT"
      ) {
        return Response.json({ ...matched, phone: "+420777123456" });
      }
      return new Response("Not found", { status: 404 });
    });

    await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        yield* dotypos.findOrCreateCustomer(
          {
            firstName: "Ada",
            lastName: "Lovelace",
            email: adaPrivateAddress,
            phone: "+420 777 123 456",
          },
          undefined
        );
        yield* dotypos.findOrCreateCustomer(
          {
            firstName: "Grace",
            lastName: "Hopper",
            email: gracePrivateAddress,
            phone: "+420 777 987 654",
          },
          undefined
        );
      }).pipe(
        Effect.provide(Logger.layer([captureLogs(logs)])),
        Effect.provideService(References.MinimumLogLevel, "All")
      ),
      fetchMock
    );

    const logged = logText(
      logs.map(({ message, annotations }) => ({ message, annotations }))
    );
    expect(logs.length).toBeGreaterThan(0);
    for (const personalDetail of [
      adaPrivateAddress,
      gracePrivateAddress,
      "777123456",
      "777987654",
      "Lovelace",
      "Hopper",
    ]) {
      expect(logged).not.toContain(personalDetail);
    }
  });

  test("does not create or reuse a customer when lookup is ambiguous", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") {
          return Response.json({
            data: [
              customer({ id: "first", email: adaAddress }),
              customer({ id: "second", email: adaAddress }),
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
            email: adaAddress,
          },
          undefined
        );
      }).pipe(Effect.flip),
      fetchMock
    );

    expect(error).toMatchObject({
      _tag: "DotyposRejected",
      reason: "ambiguous-match",
      operation: "findOrCreateCustomer",
      request: "customers.lookup",
    });
  });

  test.each([
    { input: mixedCaseAdaAddress, stored: adaAddress },
    { input: adaAddress, stored: mixedCaseAdaUpperDomainAddress },
    { input: `  ${upperLocalAdaAddress} `, stored: adaUpperDomainAddress },
  ])(
    "matches stored email $stored for input $input regardless of case",
    async ({ input, stored }) => {
      const matched = customer({ id: "email-match", email: stored });
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        if (url.pathname === "/clouds/cloud-id/customers") {
          return Response.json({
            data: [customer({ id: "longer", email: graceAdaAddress }), matched],
          });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await runWithService(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.findCustomer(
            { firstName: "Ada", email: input },
            { lookupFields: ["email"] }
          );
        }),
        fetchMock
      );

      expect(result).toEqual({
        _tag: "Matched",
        customer: matched,
        matches: [matched],
      });
      const searchCall = fetchMock.mock.calls.find((call) =>
        getUrl(call as FetchCall).includes("/customers")
      ) as FetchCall;
      expect(new URL(getUrl(searchCall)).searchParams.get("filter")).toBe(
        `email|like|${input.trim()};deleted|in|0,1`
      );
    }
  );

  test("reports ambiguity when active customers differ only by email case", async () => {
    const lower = customer({ id: "lower", email: adaAddress });
    const mixed = customer({ id: "mixed", email: mixedCaseAdaAddress });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        return Response.json({ data: [lower, mixed] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          { firstName: "Ada", email: upperLocalAdaAddress },
          { lookupFields: ["email"] }
        );
      }),
      fetchMock
    );

    expect(result).toEqual({ _tag: "Ambiguous", matches: [lower, mixed] });
  });

  test("reuses the existing customer when the checkout email differs only by case", async () => {
    const existing = customer({
      id: "existing",
      email: adaAddress,
      phone: "+420777123456",
      lastName: "Lovelace",
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers") {
        if (request.method === "GET") {
          return Response.json({ data: [existing] });
        }
        throw new Error("A duplicate customer must not be created");
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
            email: mixedCaseAdaAddress,
            phone: "+420777123456",
          },
          { lookupFields: ["email"] }
        );
      }),
      fetchMock
    );

    expect(result).toEqual(existing);
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          getMethod(call as FetchCall) !== "GET" &&
          getUrl(call as FetchCall).includes("/customers")
      )
    ).toBe(false);
  });
});

describe("DotyposService customer changes", () => {
  const changedSince = DotyposTimestampSchema.make(BigInt("1759320000123456"));
  const createdFrom = DotyposTimestampSchema.make(BigInt("1759310000000001"));

  const customerListRequests = (fetchMock: { mock: { calls: unknown[][] } }) =>
    fetchMock.mock.calls
      .map((call) => new URL(getUrl(call as FetchCall)))
      .filter((url) => url.pathname === "/clouds/cloud-id/customers");

  test.each([
    {
      selection: CustomerVersionSelection.Dated(),
      filter: "deleted|in|0,1;versionDate|eq|notnull",
      sort: "versionDate",
    },
    {
      selection: CustomerVersionSelection.ChangedFrom({
        versionDate: changedSince,
      }),
      filter: "deleted|in|0,1;versionDate|gteq|2025-10-01T12:00:00.123456Z",
      sort: "versionDate",
    },
    {
      selection: CustomerVersionSelection.ChangedAfter({
        versionDate: changedSince,
      }),
      filter: "deleted|in|0,1;versionDate|gt|2025-10-01T12:00:00.123456Z",
      sort: "versionDate",
    },
    {
      selection: CustomerVersionSelection.ChangedAt({
        versionDate: changedSince,
        createdFrom: Option.none(),
      }),
      filter: "deleted|in|0,1;versionDate|eq|2025-10-01T12:00:00.123456Z",
      sort: "created",
    },
    {
      selection: CustomerVersionSelection.ChangedAt({
        versionDate: changedSince,
        createdFrom: Option.some(createdFrom),
      }),
      filter:
        "deleted|in|0,1;versionDate|eq|2025-10-01T12:00:00.123456Z;created|gteq|2025-10-01T09:13:20.000001Z",
      sort: "created",
    },
    {
      selection: CustomerVersionSelection.Undated({
        createdFrom: Option.none(),
      }),
      filter: "deleted|in|0,1;versionDate|eq|null",
      sort: "created",
    },
    {
      selection: CustomerVersionSelection.Undated({
        createdFrom: Option.some(createdFrom),
      }),
      filter:
        "deleted|in|0,1;versionDate|eq|null;created|gteq|2025-10-01T09:13:20.000001Z",
      sort: "created",
    },
  ])(
    "reads the first $selection._tag page with a single request and microsecond filters",
    async ({ selection, filter, sort }) => {
      const customers = [
        customer({ id: "customer-1" }),
        customer({ id: "customer-2", deleted: true }),
      ];
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return Response.json({
          data: customers,
          nextPage: "2",
          totalItemsCount: "302",
        });
      });

      const changes = await runWithService(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.listCustomerChanges({ selection });
        }),
        fetchMock
      );

      const requests = customerListRequests(fetchMock);
      expect(requests).toHaveLength(1);
      expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
        filter,
        sort,
        limit: "100",
        page: "1",
      });
      expect(changes).toEqual({ customers, hasMore: true });
    }
  );

  test("keeps an explicitly null version date, as an absent one", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return Response.json({
        data: [
          customer({ id: "null-version", versionDate: null }),
          customer({ id: "absent-version" }),
        ],
        nextPage: null,
      });
    });

    const changes = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listCustomerChanges({
          selection: CustomerVersionSelection.Undated({
            createdFrom: Option.none(),
          }),
        });
      }),
      fetchMock
    );

    expect(changes.hasMore).toBe(false);
    expect(changes.customers.map(({ versionDate }) => versionDate)).toEqual([
      null,
      undefined,
    ]);
  });

  test("treats a page Dotypos answers with 404 as the end of the list", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return Response.json(
        { error: "not_found", error_description: "Not found", code: 404 },
        { status: 404 }
      );
    });

    const changes = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listCustomerChanges({
          selection: CustomerVersionSelection.ChangedAt({
            versionDate: changedSince,
            createdFrom: Option.none(),
          }),
        });
      }),
      fetchMock
    );

    expect(changes).toEqual({ customers: [], hasMore: false });
  });

  test("reads an access-token 404 as an empty export", async () => {
    const fetchMock = mockDotyposFetch(
      () => new Response("Not found", { status: 404 })
    );

    const changes = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listCustomerChanges({
          selection: CustomerVersionSelection.Undated({
            createdFrom: Option.none(),
          }),
        });
      }),
      fetchMock
    );

    expect(changes).toEqual({ customers: [], hasMore: false });
  });

  test("leaves a rejected or rate-limited read to the caller instead of retrying it", async () => {
    for (const status of [400, 429]) {
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return Response.json(
          { error: "rejected", error_description: "Rejected", code: status },
          { status }
        );
      });

      const result = await runWithService(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .listCustomerChanges({
              selection: CustomerVersionSelection.ChangedFrom({
                versionDate: changedSince,
              }),
            })
            .pipe(Effect.result);
        }),
        fetchMock
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: status === 429 ? "DotyposUnavailable" : "DotyposRejected",
          reason: status === 429 ? "rate-limited" : "invalid-request",
          operation: "listCustomerChanges",
          request: "customers.changes",
          httpStatus: status,
        },
      });
      expect(customerListRequests(fetchMock)).toHaveLength(1);
    }
  });
});

describe("DotyposService customer page", () => {
  const customerListRequests = (fetchMock: { mock: { calls: unknown[][] } }) =>
    fetchMock.mock.calls
      .map((call) => new URL(getUrl(call as FetchCall)))
      .filter((url) => url.pathname === "/clouds/cloud-id/customers");

  test("reads an access-token 404 as an empty page", async () => {
    const fetchMock = mockDotyposFetch(
      () => new Response("Not found", { status: 404 })
    );

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getCustomersByIds([
          dotyposCustomerId("customer-1"),
        ]);
      }),
      fetchMock
    );

    expect(result).toEqual(new Map());
    expect(customerListRequests(fetchMock)).toHaveLength(0);
  });

  test("reads up to 100 selected customers with one request", async () => {
    const ids = Array.from({ length: dotyposIdReadBatchSize }, (_, index) =>
      dotyposCustomerId(`customer-${index + 1}`)
    );
    const customers = [
      customer({ id: "customer-1" }),
      customer({ id: `customer-${dotyposIdReadBatchSize}` }),
    ];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return Response.json({ data: customers, nextPage: null, lastPage: "1" });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getCustomersByIds(ids);
      }),
      fetchMock
    );

    expect([...result.values()]).toEqual(customers);
    const requests = customerListRequests(fetchMock);
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
      filter: `id|in|${ids.join(",")};deleted|in|0,1`,
      limit: "100",
      page: "1",
    });
  });

  test("returns empty ids without a request and batches more than 100 ids", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return Response.json({ data: [] });
    });
    const tooManyIds = Array.from(
      { length: dotyposIdReadBatchSize + 1 },
      (_, index) => dotyposCustomerId(`customer-${index + 1}`)
    );

    const [empty, tooMany] = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* Effect.all([
          dotypos.getCustomersByIds([]),
          dotypos.getCustomersByIds(tooManyIds).pipe(Effect.result),
        ]);
      }),
      fetchMock
    );

    expect(empty).toEqual(new Map());
    expect(tooMany).toMatchObject({ _tag: "Success", success: new Map() });
    expect(customerListRequests(fetchMock)).toHaveLength(2);
  });

  test.each([
    {
      failure: "a rate limit",
      respond: () =>
        Response.json(
          { error: "rate_limited", error_description: "Too many requests" },
          { status: 429 }
        ),
      error: {
        _tag: "DotyposUnavailable",
        reason: "rate-limited",
        operation: "getCustomersByIds",
        request: "customers.page",
        httpStatus: 429,
      },
    },
    {
      failure: "a server error",
      respond: () =>
        Response.json(
          { error: "unavailable", error_description: "Unavailable" },
          { status: 503 }
        ),
      error: {
        _tag: "DotyposUnavailable",
        reason: "server",
        operation: "getCustomersByIds",
        request: "customers.page",
        httpStatus: 503,
      },
    },
    {
      failure: "a network error",
      respond: () => {
        throw new TypeError("fetch failed");
      },
      error: {
        _tag: "DotyposUnavailable",
        reason: "transport",
        operation: "getCustomersByIds",
        request: "customers.page",
      },
    },
  ])(
    "leaves $failure to the caller instead of retrying it",
    async ({ respond, error }) => {
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return respond();
      });

      const result = await runWithServiceRetryingInstantly(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .getCustomersByIds([dotyposCustomerId("customer-1")])
            .pipe(Effect.result);
        }),
        fetchMock
      );

      expect(result).toMatchObject({ _tag: "Failure", failure: error });
      expect(customerListRequests(fetchMock)).toHaveLength(1);
    }
  );

  test("fails a silent request after the 30 second timeout without retrying", async () => {
    let customerRequests = 0;
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      customerRequests += 1;
      markRequestStarted();
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () =>
          reject(request.signal.reason)
        );
      });
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .getCustomersByIds([dotyposCustomerId("customer-1")])
            .pipe(Effect.result);
        }).pipe(
          Effect.provide(
            makeServiceLayer(fetchMock, {
              ...config,
              apiTimeout: dotyposApiTimeoutDefaultMilliseconds,
            })
          ),
          Effect.forkChild
        );
        yield* Effect.promise(() => requestStarted);
        yield* TestClock.adjust(dotyposApiTimeoutDefaultMilliseconds - 1);
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(1);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposUnavailable",
        reason: "timeout",
        operation: "getCustomersByIds",
        request: "customers.page",
      },
    });
    expect(customerRequests).toBe(1);
  });

  test.each([
    { report: "nextPage", page: { data: [customer()], nextPage: "2" } },
    { report: "lastPage", page: { data: [customer()], lastPage: "2" } },
  ])("rejects another page reported through $report", async ({ page }) => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return Response.json(page);
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .getCustomersByIds([dotyposCustomerId("customer-1")])
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposRejected",
        reason: "invalid-response",
        operation: "getCustomersByIds",
        request: "customers.page",
      },
    });
    expect(result).not.toHaveProperty("failure.httpStatus");
    expect(customerListRequests(fetchMock)).toHaveLength(1);
  });
});

describe("DotyposService reservation page", () => {
  const reservationListRequests = (fetchMock: {
    mock: { calls: unknown[][] };
  }) =>
    fetchMock.mock.calls
      .map((call) => new URL(getUrl(call as FetchCall)))
      .filter((url) => url.pathname === "/clouds/cloud-id/reservations");

  test.each([
    { providerNextPage: "4", nextPage: Option.some(4) },
    { providerNextPage: null, nextPage: Option.none() },
  ])(
    "reads the requested page with one request and reports next page $providerNextPage",
    async ({ providerNextPage, nextPage }) => {
      const reservations = [reservation({ id: "reservation-1" })];
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return Response.json({
          currentPage: "3",
          data: reservations,
          nextPage: providerNextPage,
        });
      });

      const page = await runWithService(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.listReservationsPage({
            customerId: dotyposCustomerId("customer-id"),
            startsAtOrAfter: "2026-08-04T00:00:00Z",
            order: "startDateAscending",
            page: 3,
          });
        }),
        fetchMock
      );

      const requests = reservationListRequests(fetchMock);
      expect(requests).toHaveLength(1);
      expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
        filter:
          "_customerId|eq|customer-id;startDate|gteq|2026-08-04T00:00:00Z",
        sort: "startDate",
        limit: "100",
        page: "3",
      });
      expect(page).toEqual({ reservations, nextPage });
    }
  );

  test.each([
    {
      failure: "a rate limit",
      respond: () =>
        Response.json(
          { error: "rate_limited", error_description: "Too many requests" },
          { status: 429 }
        ),
      error: {
        _tag: "DotyposUnavailable",
        reason: "rate-limited",
        operation: "listReservationsPage",
        request: "reservations.page",
        httpStatus: 429,
      },
    },
    {
      failure: "a server error",
      respond: () =>
        Response.json(
          { error: "unavailable", error_description: "Unavailable" },
          { status: 503 }
        ),
      error: {
        _tag: "DotyposUnavailable",
        reason: "server",
        operation: "listReservationsPage",
        request: "reservations.page",
        httpStatus: 503,
      },
    },
    {
      failure: "a network error",
      respond: () => {
        throw new TypeError("fetch failed");
      },
      error: {
        _tag: "DotyposUnavailable",
        reason: "transport",
        operation: "listReservationsPage",
        request: "reservations.page",
      },
    },
  ])(
    "leaves $failure to the caller instead of retrying it",
    async ({ respond, error }) => {
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return respond();
      });

      const result = await runWithServiceRetryingInstantly(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .listReservationsPage({ page: 1 })
            .pipe(Effect.result);
        }),
        fetchMock
      );

      expect(result).toMatchObject({ _tag: "Failure", failure: error });
      expect(reservationListRequests(fetchMock)).toHaveLength(1);
    }
  );

  test("fails a silent request after the per-request timeout without retrying it", async () => {
    let reservationRequests = 0;
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      reservationRequests += 1;
      markRequestStarted();
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () =>
          reject(request.signal.reason)
        );
      });
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .listReservationsPage({ page: 1 })
            .pipe(Effect.result);
        }).pipe(
          Effect.provide(
            makeServiceLayer(fetchMock, {
              ...config,
              apiTimeout: dotyposApiTimeoutDefaultMilliseconds,
            })
          ),
          Effect.forkChild
        );
        yield* Effect.promise(() => requestStarted);
        yield* TestClock.adjust(dotyposApiTimeoutDefaultMilliseconds - 1);
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(1);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposUnavailable",
        reason: "timeout",
        operation: "listReservationsPage",
        request: "reservations.page",
      },
    });
    expect(reservationRequests).toBe(1);
  });

  test.each(["1", "3"])(
    "rejects a reported next page %s that isn't ahead of page 3 without reading it",
    async (providerNextPage) => {
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return Response.json({
          data: [reservation()],
          nextPage: providerNextPage,
        });
      });

      const result = await runWithServiceRetryingInstantly(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .listReservationsPage({ page: 3 })
            .pipe(Effect.result);
        }),
        fetchMock
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DotyposRejected",
          reason: "invalid-response",
          operation: "listReservationsPage",
          request: "reservations.page",
        },
      });
      expect(result).not.toHaveProperty("failure.httpStatus");
      expect(reservationListRequests(fetchMock)).toHaveLength(1);
    }
  );

  test("reads nothing for an empty id selection or an invalid page", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return Response.json({ data: [reservation()] });
    });

    const [empty, invalid] = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* Effect.all([
          dotypos.getReservationsByIds([]),
          dotypos.listReservationsPage({ page: 0 }).pipe(Effect.result),
        ]);
      }),
      fetchMock
    );

    expect(empty).toEqual(new Map());
    expect(invalid).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposRejected",
        reason: "invalid-request",
        operation: "listReservationsPage",
      },
    });
    expect(reservationListRequests(fetchMock)).toHaveLength(0);
  });
});

describe("DotyposService active reservation page", () => {
  const interval = {
    startDate: new Date("2026-08-04T08:00:00Z"),
    endDate: new Date("2026-08-04T14:00:00Z"),
  };
  const reservationListRequests = (fetchMock: {
    mock: { calls: unknown[][] };
  }) =>
    fetchMock.mock.calls
      .map((call) => new URL(getUrl(call as FetchCall)))
      .filter((url) => url.pathname === "/clouds/cloud-id/reservations");

  test.each([
    { providerNextPage: "3", nextPage: Option.some(3) },
    { providerNextPage: null, nextPage: Option.none() },
  ])(
    "reads one overlap page with one request and reports next page $providerNextPage",
    async ({ providerNextPage, nextPage }) => {
      const reservations = [reservation({ id: "reservation-1" })];
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return Response.json({
          currentPage: "2",
          data: reservations,
          nextPage: providerNextPage,
        });
      });

      const page = await runWithService(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.listActiveReservationsPage(interval, 2);
        }),
        fetchMock
      );

      const requests = reservationListRequests(fetchMock);
      expect(requests).toHaveLength(1);
      expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({
        filter: `status|in|NEW,CONFIRMED;startDate|lt|${interval.endDate.getTime()};endDate|gt|${interval.startDate.getTime()}`,
        limit: "100",
        page: "2",
      });
      expect(page).toEqual({ reservations, nextPage });
    }
  );

  test.each([
    {
      failure: "a rate limit",
      respond: () =>
        Response.json(
          { error: "rate_limited", error_description: "Too many requests" },
          { status: 429 }
        ),
      error: {
        _tag: "DotyposUnavailable",
        reason: "rate-limited",
        operation: "listActiveReservationsPage",
        request: "reservations.page",
        httpStatus: 429,
      },
    },
    {
      failure: "a server error",
      respond: () =>
        Response.json(
          { error: "unavailable", error_description: "Unavailable" },
          { status: 503 }
        ),
      error: {
        _tag: "DotyposUnavailable",
        reason: "server",
        operation: "listActiveReservationsPage",
        request: "reservations.page",
        httpStatus: 503,
      },
    },
    {
      failure: "a network error",
      respond: () => {
        throw new TypeError("fetch failed");
      },
      error: {
        _tag: "DotyposUnavailable",
        reason: "transport",
        operation: "listActiveReservationsPage",
        request: "reservations.page",
      },
    },
  ])(
    "leaves $failure to the caller instead of retrying it",
    async ({ respond, error }) => {
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return respond();
      });

      const result = await runWithServiceRetryingInstantly(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .listActiveReservationsPage(interval, 1)
            .pipe(Effect.result);
        }),
        fetchMock
      );

      expect(result).toMatchObject({ _tag: "Failure", failure: error });
      expect(reservationListRequests(fetchMock)).toHaveLength(1);
    }
  );

  test("fails a silent request after the per-request timeout without retrying it", async () => {
    let reservationRequests = 0;
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      reservationRequests += 1;
      markRequestStarted();
      return new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () =>
          reject(request.signal.reason)
        );
      });
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .listActiveReservationsPage(interval, 1)
            .pipe(Effect.result);
        }).pipe(
          Effect.provide(
            makeServiceLayer(fetchMock, {
              ...config,
              apiTimeout: dotyposApiTimeoutDefaultMilliseconds,
            })
          ),
          Effect.forkChild
        );
        yield* Effect.promise(() => requestStarted);
        yield* TestClock.adjust(dotyposApiTimeoutDefaultMilliseconds - 1);
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(1);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposUnavailable",
        reason: "timeout",
        operation: "listActiveReservationsPage",
        request: "reservations.page",
      },
    });
    expect(reservationRequests).toBe(1);
  });

  test.each(["1", "2", "page-3"])(
    "rejects a reported next page %s that isn't ahead of page 2 without reading it",
    async (providerNextPage) => {
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return Response.json({
          data: [reservation()],
          nextPage: providerNextPage,
        });
      });

      const result = await runWithServiceRetryingInstantly(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .listActiveReservationsPage(interval, 2)
            .pipe(Effect.result);
        }),
        fetchMock
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DotyposRejected",
          reason: "invalid-response",
          operation: "listActiveReservationsPage",
          request: "reservations.page",
        },
      });
      expect(result).not.toHaveProperty("failure.httpStatus");
      expect(reservationListRequests(fetchMock)).toHaveLength(1);
    }
  );

  test("reads nothing for an invalid page or interval", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return Response.json({ data: [reservation()] });
    });

    const results = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* Effect.all(
          [
            dotypos.listActiveReservationsPage(interval, 0),
            dotypos.listActiveReservationsPage(
              { startDate: interval.endDate, endDate: interval.startDate },
              1
            ),
          ].map(Effect.result)
        );
      }),
      fetchMock
    );

    for (const result of results) {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DotyposRejected",
          reason: "invalid-request",
          operation: "listActiveReservationsPage",
        },
      });
    }
    expect(reservationListRequests(fetchMock)).toHaveLength(0);
  });
});

describe("DotyposService reservations", () => {
  test("reads a reservation Dotypos answers 404 for as none, even with an undocumented error body", async () => {
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

    expect(result).toMatchObject({ _tag: "Success", success: Option.none() });
  });

  test("fails a reservation read whose linked customer answers 404", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations/reservation-id") {
        return Response.json(reservation());
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .getReservation(dotyposReservationId("reservation-id"))
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposRejected",
        reason: "not-found",
        operation: "getReservation",
        request: "customer.get",
        httpStatus: 404,
      },
    });
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

    const result = await runWithServiceRetryingInstantly(
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

  test("does not retry an ambiguous reservation creation failure", async () => {
    let reservationAttempts = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations" &&
        request.method === "POST"
      ) {
        reservationAttempts += 1;
        return Response.json(
          { error: "server", error_description: "Server error", code: 500 },
          { status: 500 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .createReservation({
            customerId: dotyposCustomerId("customer-id"),
            tableId: dotyposTableId("table-id"),
            startDate: new Date("2026-06-20T10:00:00.000Z"),
            endDate: new Date("2026-06-20T12:00:00.000Z"),
            seats: 2,
            status: "NEW",
          })
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result._tag).toBe("Failure");
    expect(reservationAttempts).toBe(1);
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

  test("refuses to confirm a cancelled reservation without patching", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "GET"
      ) {
        return Response.json(reservation({ status: "CANCELLED" }), {
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

    const error = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .confirmReservation(dotyposReservationId("reservation-id"))
          .pipe(Effect.flip);
      }),
      fetchMock
    );

    expect(error._tag).toBe("DotyposReservationCancelledError");
    expect(
      fetchMock.mock.calls.some(
        (call) => getMethod(call as FetchCall) === "PATCH"
      )
    ).toBe(false);
  });

  test("returns an already confirmed reservation without patching", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "GET"
      ) {
        return Response.json(reservation({ status: "CONFIRMED" }), {
          headers: { etag: '"reservation-etag"' },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.confirmReservation(
          dotyposReservationId("reservation-id")
        );
      }),
      fetchMock
    );

    expect(result.status).toBe("CONFIRMED");
    expect(
      fetchMock.mock.calls.some(
        (call) => getMethod(call as FetchCall) === "PATCH"
      )
    ).toBe(false);
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

    expect(errors).toMatchObject({
      _tag: "DotyposRejected",
      reason: "invalid-request",
      operation: "updateReservation",
    });
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
      _tag: "DotyposRejected",
      reason: "invalid-response",
      operation: "updateReservation",
      request: "reservation.version",
    });
    expect(
      fetchMock.mock.calls.some(
        (call) => getMethod(call as FetchCall) === "PATCH"
      )
    ).toBe(false);
  });
});

describe("DotyposService access token", () => {
  test("requests a new access token after Dotypos rejects the cached one", async () => {
    let issuedTokens = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") {
        issuedTokens += 1;
        return Response.json({ accessToken: `access-token-${issuedTokens}` });
      }
      if (url.pathname === "/clouds/cloud-id/categories") {
        return request.headers.get("authorization") === "Bearer access-token-1"
          ? Response.json(
              { error: "unauthorized", error_description: "", code: 401 },
              { status: 401 }
            )
          : Response.json({ data: [category()] });
      }
      return new Response("Not found", { status: 404 });
    });

    const [revoked, renewed] = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        const revoked = yield* dotypos.getCategories().pipe(Effect.result);
        const renewed = yield* dotypos.getCategories();
        return [revoked, renewed] as const;
      }),
      fetchMock
    );

    expect(revoked._tag).toBe("Failure");
    expect(renewed).toEqual([category()]);
    expect(issuedTokens).toBe(2);
  });
});

describe("DotyposService categories", () => {
  test("loads every category and product page", async () => {
    const requestedPages: string[] = [];
    const product = (id: string) => ({
      id,
      _categoryId: "category-id",
      name: `Product ${id}`,
      priceWithoutVat: "100",
      vat: "21",
    });
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      const page = url.searchParams.get("page") ?? "1";
      if (url.pathname === "/clouds/cloud-id/categories") {
        requestedPages.push(`categories:${page}`);
        return Response.json(
          page === "1"
            ? { data: [category({ id: "first" })], nextPage: "2" }
            : { data: [category({ id: "second" })], nextPage: null }
        );
      }
      if (url.pathname === "/clouds/cloud-id/products") {
        requestedPages.push(`products:${page}`);
        return Response.json(
          page === "1"
            ? { data: [product("first")], nextPage: "2" }
            : { data: [product("second")], nextPage: null }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const { categories, products } = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        const categories = yield* dotypos.getCategories();
        const products = yield* dotypos.getProducts({});
        return { categories, products };
      }),
      fetchMock
    );

    expect(categories.map(({ id }) => String(id))).toEqual(["first", "second"]);
    expect(products.map(({ id }) => String(id))).toEqual(["first", "second"]);
    expect(requestedPages).toEqual([
      "categories:1",
      "categories:2",
      "products:1",
      "products:2",
    ]);
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
      _tag: "DotyposRejected",
      reason: "not-found",
      operation: "getDiscountGroups",
      request: "discountGroups.list",
      httpStatus: 404,
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

  test("does not patch customer billing details without an ETag", async () => {
    const requests: Request[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      requests.push(request.clone());
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/customers/customer-id") {
        return Response.json(customer());
      }
      return new Response("Not found", { status: 404 });
    });

    const error = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .updateCustomerBillingDetails(dotyposCustomerId("customer-id"), {
            addressLine1: "Private street 1",
            addressLine2: "",
            city: "Private city",
            zip: "12345",
            country: "CZ",
            companyName: "",
            companyId: "",
            vatId: "",
          })
          .pipe(Effect.flip);
      }),
      fetchMock
    );

    expect(error).toMatchObject({
      _tag: "DotyposRejected",
      reason: "invalid-response",
      operation: "updateCustomerBillingDetails",
      request: "customer.version",
    });
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
  });

  test("fails a billing patch of a missing customer with the original not-found failure", async () => {
    const requests: Request[] = [];
    const fetchMock = mockDotyposFetch((request) => {
      requests.push(request.clone());
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return new Response("Not found", { status: 404 });
    });

    const error = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .updateCustomerBillingDetails(dotyposCustomerId("customer-id"), {
            addressLine1: "",
            addressLine2: "",
            city: "",
            zip: "",
            country: "",
            companyName: "",
            companyId: "",
            vatId: "",
          })
          .pipe(Effect.flip);
      }),
      fetchMock
    );

    expect(error).toMatchObject({
      _tag: "DotyposRejected",
      reason: "not-found",
      operation: "updateCustomerBillingDetails",
      request: "customer.version",
      httpStatus: 404,
    });
    expect(requests.some(({ method }) => method === "PATCH")).toBe(false);
  });

  test("does not swallow a stale customer billing patch", async () => {
    const requests: Request[] = [];
    const fetchMock = mockDotyposFetch((request) => {
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
          { error: "precondition_failed", error_description: "Stale ETag" },
          { status: 412 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const error = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .updateCustomerBillingDetails(dotyposCustomerId("customer-id"), {
            addressLine1: "Private street 1",
            addressLine2: "",
            city: "Private city",
            zip: "12345",
            country: "CZ",
            companyName: "",
            companyId: "",
            vatId: "",
          })
          .pipe(Effect.flip);
      }),
      fetchMock
    );

    expect(error).toMatchObject({
      _tag: "DotyposVersionConflict",
      operation: "updateCustomerBillingDetails",
      request: "customer.patch",
      httpStatus: 412,
    });
    expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
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

  test("fails a customer discount group read when the customer answers 404", async () => {
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .getCustomerDiscountGroup({
            customerId: dotyposCustomerId("customer-id"),
          })
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposRejected",
        reason: "not-found",
        operation: "getCustomerDiscountGroup",
        request: "customer.get",
        httpStatus: 404,
      },
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
        return yield* dotypos.getReservationsByIds(
          [
            dotyposReservationId("reservation-1"),
            dotyposReservationId("reservation-2"),
          ],
          {
            customerId: dotyposCustomerId("customer-id"),
            startsAtOrAfter: "2026-08-04T00:00:00+02:00",
            startsBefore: "2026-08-05T00:00:00+02:00",
            order: "startDateDescending",
          }
        );
      }),
      fetchMock
    );

    expect(requestedQueries).toHaveLength(1);
    expect(requestedQueries[0]?.get("filter")).toBe(
      "id|in|reservation-1,reservation-2;_customerId|eq|customer-id;startDate|gteq|2026-08-04T00:00:00+02:00;startDate|lt|2026-08-05T00:00:00+02:00"
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
      failure: {
        _tag: "DotyposRejected",
        reason: "invalid-request",
        operation: "listReservations",
      },
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
        _tag: "DotyposRejected",
        reason: "not-found",
        operation: "listReservations",
        request: "reservations.list",
        httpStatus: 404,
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
        _tag: "DotyposRejected",
        reason: "unauthorized",
        operation: "listReservations",
        request: "reservations.list",
        httpStatus: 403,
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

describe("DotyposService paginated list responses", () => {
  const providerPayloadMarker = "synthetic-provider-response-marker";
  const malformedPages = [
    {
      name: "null data",
      response: { data: null, detail: providerPayloadMarker },
    },
    {
      name: "non-array data",
      response: { data: providerPayloadMarker },
    },
  ] as const;

  for (const operation of ["getTables", "listReservations"] as const) {
    for (const { name, response } of malformedPages) {
      test(`${operation} rejects ${name} without logging provider payloads`, async () => {
        const logs: CapturedLog[] = [];
        const client = makePaginatedClient(() => response);
        const result = await (operation === "getTables"
          ? runWithServiceClient(
              Effect.gen(function* () {
                const dotypos = yield* DotyposService;
                return yield* dotypos.getTables().pipe(Effect.result);
              }).pipe(Effect.provide(Logger.layer([captureLogs(logs)]))),
              client
            )
          : runWithServiceClient(
              Effect.gen(function* () {
                const dotypos = yield* DotyposService;
                return yield* dotypos.listReservations().pipe(Effect.result);
              }).pipe(Effect.provide(Logger.layer([captureLogs(logs)]))),
              client
            ));

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "DotyposRejected",
            reason: "invalid-response",
            operation,
            request:
              operation === "getTables" ? "tables.list" : "reservations.list",
          },
        });
        expect(logText(logs)).not.toContain(providerPayloadMarker);
      });
    }
  }

  test("logs table and active reservation load summaries without payloads", async () => {
    const logs: CapturedLog[] = [];
    const reservationPages = [
      { data: [reservation({ id: "reservation-1" })], nextPage: "2" },
      { data: [reservation({ id: "reservation-2" })], nextPage: "3" },
      { data: [], nextPage: null },
    ];

    await runWithServiceClient(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        yield* dotypos.getTables();
        yield* dotypos.listActiveReservationsOverlapping({
          startDate: new Date("2026-06-20T10:00:00Z"),
          endDate: new Date("2026-06-20T12:00:00Z"),
        });
      }).pipe(Effect.provide(Logger.layer([captureLogs(logs)]))),
      makePaginatedClient((operation, page) =>
        operation === "getTables"
          ? {
              data: [
                table({ id: `table-${page}`, name: providerPayloadMarker }),
              ],
              nextPage: page === 1 ? "2" : null,
            }
          : {
              ...reservationPages[page - 1],
              data: reservationPages[page - 1]?.data.map((item) => ({
                ...item,
                note: providerPayloadMarker,
              })),
            }
      )
    );

    expect(
      logs.map(({ message, annotations }) => [
        messageParts(message)[0],
        annotations,
      ])
    ).toMatchObject([
      ["Dotypos tables load started", {}],
      ["Dotypos tables load completed", { tableCount: 2, pageCount: 2 }],
      ["Dotypos active reservations load started", {}],
      [
        "Dotypos active reservations load completed",
        { reservationCount: 2, pageCount: 3 },
      ],
    ]);
    expect(logText(logs)).not.toContain(providerPayloadMarker);
  });

  test("fails the whole reservation listing when a later page is malformed", async () => {
    const firstReservation = reservation({ id: "reservation-1" });
    const requestedPages: number[] = [];
    const result = await runWithServiceClient(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.listReservations().pipe(Effect.result);
      }),
      makePaginatedClient((_operation, page) => {
        requestedPages.push(page);
        return page === 1 ? { data: [firstReservation], nextPage: "2" } : {};
      })
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposRejected",
        reason: "invalid-response",
        operation: "listReservations",
        request: "reservations.list",
      },
    });
    expect(requestedPages).toEqual([1, 2]);
  });
});

type FailureOutcomeOperation =
  | "getCustomer"
  | "getCustomersByIds"
  | "cancelReservation"
  | "patchCustomer"
  | "confirmReservation"
  | "createReservation"
  | "createCustomer";

const failureOutcomeOperations = {
  getCustomer: {
    kind: "read",
    request: "customer.get",
    method: "GET",
    path: "/clouds/cloud-id/customers/customer-id",
  },
  getCustomersByIds: {
    kind: "read",
    request: "customers.page",
    method: "GET",
    path: "/clouds/cloud-id/customers",
  },
  cancelReservation: {
    kind: "write",
    request: "reservation.delete",
    method: "DELETE",
    path: "/clouds/cloud-id/reservations/reservation-id",
  },
  patchCustomer: {
    kind: "conditional",
    request: "customer.patch",
    method: "PATCH",
    path: "/clouds/cloud-id/customers/customer-id",
  },
  confirmReservation: {
    kind: "conditional",
    request: "reservation.patch",
    method: "PATCH",
    path: "/clouds/cloud-id/reservations/reservation-id",
  },
  createReservation: {
    kind: "creation",
    request: "reservation.create",
    method: "POST",
    path: "/clouds/cloud-id/reservations",
  },
  createCustomer: {
    kind: "creation",
    request: "customer.create",
    method: "POST",
    path: "/clouds/cloud-id/customers",
  },
} as const;

type FailureOutcomeInput =
  | {
      readonly label: string;
      readonly kind:
        | "success"
        | "invalid-identifier"
        | "non-json"
        | "malformed-page"
        | "empty-array"
        | "fetch-failed"
        | "timeout";
      readonly operations: readonly FailureOutcomeOperation[];
    }
  | {
      readonly label: string;
      readonly kind: "status";
      readonly status: number;
      readonly operations: readonly FailureOutcomeOperation[];
    };

const allFailureOutcomeOperations = Object.keys(
  failureOutcomeOperations
) as FailureOutcomeOperation[];
const responseOperations = allFailureOutcomeOperations.filter(
  (operation) => operation !== "cancelReservation"
);
const creationOutcomeOperations = [
  "createReservation",
  "createCustomer",
] as const;

const failureOutcomeInputs: readonly FailureOutcomeInput[] = [
  {
    label: "200 decodable",
    kind: "success",
    operations: allFailureOutcomeOperations,
  },
  {
    label: "200 invalid identifier",
    kind: "invalid-identifier",
    operations: responseOperations,
  },
  {
    label: "200 non-JSON body",
    kind: "non-json",
    operations: responseOperations,
  },
  {
    label: "200 malformed page",
    kind: "malformed-page",
    operations: ["getCustomersByIds"],
  },
  {
    label: "200 empty creation array",
    kind: "empty-array",
    operations: creationOutcomeOperations,
  },
  ...[400, 401, 403, 404, 409, 412, 429, 500, 503].map(
    (status): FailureOutcomeInput => ({
      label: `${status}`,
      kind: "status",
      status,
      operations: allFailureOutcomeOperations,
    })
  ),
  {
    label: "fetch failed",
    kind: "fetch-failed",
    operations: allFailureOutcomeOperations,
  },
  {
    label: "timeout",
    kind: "timeout",
    operations: allFailureOutcomeOperations,
  },
];

const failureOutcomeRows = failureOutcomeInputs.flatMap((input) =>
  input.operations.map((operation) => ({
    label: input.label,
    kind: input.kind,
    ...(input.kind === "status" && { status: input.status }),
    operation,
  }))
);

const failureOutcomeReservationInput = {
  customerId: dotyposCustomerId("customer-id"),
  tableId: dotyposTableId("table-id"),
  startDate: new Date("2026-06-20T10:00:00.000Z"),
  endDate: new Date("2026-06-20T12:00:00.000Z"),
  seats: 2,
  status: "NEW" as const,
};

const failureOutcomeCustomerDetails = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: adaAddress,
  phone: "+420 777 123 456",
  addressLine1: "",
  addressLine2: "",
  city: "",
  zip: "",
  country: "",
  companyName: "",
  companyId: "",
  vatId: "",
};

const invokeFailureOutcomeOperation = (
  dotypos: IDotyposService,
  operation: FailureOutcomeOperation
): Effect.Effect<unknown, unknown, never> => {
  switch (operation) {
    case "getCustomer":
      return dotypos.getCustomer(dotyposCustomerId("customer-id"));
    case "getCustomersByIds":
      return dotypos.getCustomersByIds([dotyposCustomerId("customer-id")]);
    case "cancelReservation":
      return dotypos.cancelReservation(dotyposReservationId("reservation-id"));
    case "patchCustomer":
      return dotypos.patchCustomer(dotyposCustomerId("customer-id"), {
        firstName: "Grace",
      });
    case "confirmReservation":
      return dotypos.confirmReservation(dotyposReservationId("reservation-id"));
    case "createReservation":
      return dotypos.createReservation(failureOutcomeReservationInput);
    case "createCustomer":
      return dotypos.createCustomer(failureOutcomeCustomerDetails);
  }
};

const successOutcomeResponse = (operation: FailureOutcomeOperation) => {
  switch (operation) {
    case "getCustomer":
      return Response.json(customer());
    case "getCustomersByIds":
      return Response.json({
        data: [customer()],
        nextPage: null,
        lastPage: "1",
      });
    case "cancelReservation":
      return Response.json(reservation({ status: "CANCELLED" }));
    case "patchCustomer":
      return Response.json(customer({ firstName: "Grace" }));
    case "confirmReservation":
      return Response.json(reservation({ status: "CONFIRMED" }));
    case "createReservation":
      return Response.json([reservation()]);
    case "createCustomer":
      return Response.json([customer()]);
  }
};

const outcomeResponse = (
  request: Request,
  operation: FailureOutcomeOperation,
  kind: FailureOutcomeInput["kind"],
  status?: number
): Response | Promise<Response> => {
  if (kind === "status") {
    return Response.json(
      { error: "synthetic_failure", code: status },
      { status }
    );
  }
  if (kind === "fetch-failed") throw new TypeError("fetch failed");
  if (kind === "timeout") {
    return new Promise<Response>((_resolve, reject) => {
      const rejectOnAbort = () => reject(request.signal.reason);
      if (request.signal.aborted) rejectOnAbort();
      else
        request.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
  }
  if (kind === "non-json") {
    return new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (kind === "malformed-page") return Response.json({ data: "not-an-array" });
  if (kind === "empty-array") return Response.json([]);
  if (kind === "invalid-identifier") {
    if (operation === "getCustomer") {
      return Response.json({ ...customer(), id: "" });
    }
    if (operation === "getCustomersByIds") {
      return Response.json({
        data: [{ ...customer(), id: "" }],
        nextPage: null,
        lastPage: "1",
      });
    }
    if (operation === "patchCustomer")
      return Response.json({ ...customer(), id: "" });
    if (operation === "confirmReservation") {
      return Response.json({ ...reservation(), id: "" });
    }
    if (operation === "createReservation") {
      return Response.json([{ ...reservation(), id: "" }]);
    }
    if (operation === "createCustomer") {
      return Response.json([{ ...customer(), id: "" }]);
    }
  }
  return successOutcomeResponse(operation);
};

const failureOutcomeRetryCount = (
  operation: FailureOutcomeOperation,
  input: { readonly kind: string; readonly status?: number }
) => {
  const retry =
    dotyposRequestProfiles[failureOutcomeOperations[operation].request].retry;
  if (retry === "none") return 1;
  if (input.kind === "status") {
    if (input.status === 429) return retry === "creation" ? 4 : 4;
    if ((input.status ?? 0) >= 500) {
      return retry === "transient" || retry === "replay" ? 4 : 1;
    }
  }
  if (input.kind === "fetch-failed" || input.kind === "timeout") {
    return retry === "transient" || retry === "replay" ? 4 : 1;
  }
  if (input.kind === "empty-array" && retry === "creation") return 4;
  return 1;
};

const failureOutcomeExpectation = (
  operation: FailureOutcomeOperation,
  input: { readonly kind: string; readonly status?: number }
) => {
  const spec = failureOutcomeOperations[operation];
  if (input.kind === "success") {
    return {
      success:
        operation === "getCustomer" || operation === "patchCustomer"
          ? "some"
          : "value",
    } as const;
  }
  if (
    input.kind === "status" &&
    input.status === 404 &&
    (operation === "getCustomer" || operation === "patchCustomer")
  ) {
    return { success: "none" } as const;
  }
  if (
    input.kind === "status" &&
    input.status === 404 &&
    operation === "getCustomersByIds"
  ) {
    return { success: "empty" } as const;
  }

  let tag: string;
  let reason: string | undefined;
  let httpStatus: number | undefined;
  switch (input.kind) {
    case "invalid-identifier":
      tag = spec.kind === "read" ? "DotyposRejected" : "DotyposUncertain";
      reason = "invalid-response";
      break;
    case "non-json":
      tag = spec.kind === "read" ? "DotyposRejected" : "DotyposUncertain";
      reason = "invalid-response";
      httpStatus = 200;
      break;
    case "malformed-page":
      tag = "DotyposRejected";
      reason = "invalid-response";
      break;
    case "empty-array":
      tag = "DotyposUnavailable";
      reason = "empty-response";
      break;
    case "fetch-failed":
      tag = spec.kind === "read" ? "DotyposUnavailable" : "DotyposUncertain";
      reason = "transport";
      break;
    case "timeout":
      tag = spec.kind === "read" ? "DotyposUnavailable" : "DotyposUncertain";
      reason = "timeout";
      break;
    case "status":
      httpStatus = input.status;
      if (input.status === 401 || input.status === 403) {
        tag = "DotyposRejected";
        reason = "unauthorized";
      } else if (input.status === 404) {
        tag = "DotyposRejected";
        reason = "not-found";
      } else if (
        (input.status === 409 || input.status === 412) &&
        spec.kind === "conditional"
      ) {
        tag = "DotyposVersionConflict";
      } else if (input.status === 429) {
        tag = "DotyposUnavailable";
        reason = "rate-limited";
      } else if ((input.status ?? 0) >= 500) {
        tag = spec.kind === "read" ? "DotyposUnavailable" : "DotyposUncertain";
        reason = "server";
      } else {
        tag = "DotyposRejected";
        reason = "invalid-request";
      }
      break;
    default:
      throw new Error(`Unexpected outcome input: ${input.kind}`);
  }
  return {
    failure: {
      _tag: tag,
      ...(reason !== undefined && { reason }),
      operation,
      request: spec.request,
      ...(httpStatus !== undefined && { httpStatus }),
    },
  } as const;
};

describe("DotyposService failure classification table", () => {
  test.each(failureOutcomeRows)("$operation: $label", async (row) => {
    const spec = failureOutcomeOperations[row.operation];
    let targetAttempts = 0;
    let preflightAttempts = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        (row.operation === "patchCustomer" ||
          row.operation === "confirmReservation") &&
        request.method === "GET" &&
        url.pathname === spec.path
      ) {
        preflightAttempts += 1;
        return row.operation === "patchCustomer"
          ? Response.json(customer(), { headers: { ETag: '"customer-v1"' } })
          : Response.json(reservation({ status: "NEW" }), {
              headers: { ETag: '"reservation-v1"' },
            });
      }
      if (request.method === spec.method && url.pathname === spec.path) {
        targetAttempts += 1;
        return outcomeResponse(
          request,
          row.operation,
          row.kind,
          "status" in row ? row.status : undefined
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* invokeFailureOutcomeOperation(
          dotypos,
          row.operation
        ).pipe(Effect.result);
      }),
      fetchMock
    );

    const expected = failureOutcomeExpectation(row.operation, row);
    if ("success" in expected) {
      expect(result).toMatchObject({ _tag: "Success" });
      if (!Predicate.isTagged(result, "Success")) return;
      if (expected.success === "none") {
        expect((result as { success: unknown }).success).toEqual(Option.none());
      } else if (expected.success === "some") {
        expect(
          Option.isSome((result as { success: Option.Option<unknown> }).success)
        ).toBe(true);
      } else if (expected.success === "empty") {
        expect((result as { success: unknown }).success).toEqual(new Map());
      }
    } else {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: expected.failure,
      });
      if (!Predicate.isTagged(result, "Failure")) return;
      const failure = result.failure as { readonly httpStatus?: number };
      expect(failure.httpStatus).toBe(expected.failure.httpStatus);
      expect(Object.hasOwn(failure, "httpStatus")).toBe(
        expected.failure.httpStatus !== undefined
      );
    }
    expect(targetAttempts).toBe(failureOutcomeRetryCount(row.operation, row));
    if (
      row.operation === "patchCustomer" ||
      row.operation === "confirmReservation"
    ) {
      expect(preflightAttempts).toBe(1);
    }
  });

  test("classifies a bad reservation customer identifier as a read response failure", async () => {
    let reservationReads = 0;
    let customerReads = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations/reservation-id") {
        reservationReads += 1;
        return Response.json({ ...reservation(), _customerId: "" });
      }
      if (url.pathname === "/clouds/cloud-id/customers/customer-id") {
        customerReads += 1;
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithService(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .getReservation(dotyposReservationId("reservation-id"))
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposRejected",
        reason: "invalid-response",
        operation: "getReservation",
        request: "reservation.get",
      },
    });
    expect(reservationReads).toBe(1);
    expect(customerReads).toBe(0);
  });

  test("keeps an access-token server failure unavailable before reservation creation", async () => {
    let tokenRequests = 0;
    let reservationPosts = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") {
        tokenRequests += 1;
        return Response.json(
          { error: "unavailable", code: 503 },
          { status: 503 }
        );
      }
      if (url.pathname === "/clouds/cloud-id/reservations") {
        reservationPosts += 1;
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .createReservation(failureOutcomeReservationInput)
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposUnavailable",
        reason: "server",
        operation: "createReservation",
        request: "reservation.create",
        httpStatus: 503,
      },
    });
    expect(tokenRequests).toBe(1);
    expect(reservationPosts).toBe(0);
  });

  test("times out while the reservation access-token request hangs without sending a POST", async () => {
    let tokenStarted!: () => void;
    const tokenStartedPromise = new Promise<void>((resolve) => {
      tokenStarted = resolve;
    });
    let reservationPosts = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") {
        tokenStarted();
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true }
          );
        });
      }
      if (url.pathname === "/clouds/cloud-id/reservations") {
        reservationPosts += 1;
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .createReservation(failureOutcomeReservationInput)
            .pipe(Effect.result);
        }).pipe(
          Effect.provide(
            makeServiceLayer(fetchMock, { ...config, apiTimeout: 1000 })
          ),
          Effect.forkChild
        );
        yield* Effect.promise(() => tokenStartedPromise);
        yield* TestClock.adjust(999);
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust(1);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposUncertain",
        reason: "timeout",
        operation: "createReservation",
        request: "reservation.create",
      },
    });
    expect(reservationPosts).toBe(0);
  });
});

type CreationOutcomeStep =
  | "429"
  | "empty-array"
  | "503"
  | "fetch-failed"
  | "timeout"
  | "success"
  | "bad-identifier";

type CreationRetryScenario = {
  readonly label: string;
  readonly steps: readonly CreationOutcomeStep[];
  readonly expectedPostCount: number;
  readonly expectedTag?: string;
  readonly expectedReason?: string;
  readonly expectedHttpStatus?: number;
};

const creationRetryScenarios: readonly CreationRetryScenario[] = [
  {
    label: "429 four times",
    steps: ["429", "429", "429", "429"],
    expectedPostCount: 4,
    expectedTag: "DotyposUnavailable",
    expectedReason: "rate-limited",
    expectedHttpStatus: 429,
  },
  {
    label: "429 then success",
    steps: ["429", "success"],
    expectedPostCount: 2,
  },
  {
    label: "empty array four times",
    steps: ["empty-array", "empty-array", "empty-array", "empty-array"],
    expectedPostCount: 4,
    expectedTag: "DotyposUnavailable",
    expectedReason: "empty-response",
  },
  {
    label: "503 once",
    steps: ["503"],
    expectedPostCount: 1,
    expectedTag: "DotyposUncertain",
    expectedReason: "server",
    expectedHttpStatus: 503,
  },
  {
    label: "fetch failure once",
    steps: ["fetch-failed"],
    expectedPostCount: 1,
    expectedTag: "DotyposUncertain",
    expectedReason: "transport",
  },
  {
    label: "timeout once",
    steps: ["timeout"],
    expectedPostCount: 1,
    expectedTag: "DotyposUncertain",
    expectedReason: "timeout",
  },
  {
    label: "bad returned identifier",
    steps: ["bad-identifier"],
    expectedPostCount: 1,
    expectedTag: "DotyposUncertain",
    expectedReason: "invalid-response",
  },
];

type CreationOutcomeOperation =
  | "createReservation"
  | "findOrCreateCustomer"
  | "createCustomer";

const runCreationOutcomeOperation = (
  dotypos: IDotyposService,
  operation: CreationOutcomeOperation
): Effect.Effect<unknown, unknown, never> => {
  switch (operation) {
    case "createReservation":
      return dotypos.createReservation(failureOutcomeReservationInput);
    case "findOrCreateCustomer":
      return dotypos.findOrCreateCustomer({
        firstName: "Ada",
        lastName: "Lovelace",
        email: adaAddress,
        phone: "+420 777 123 456",
      });
    case "createCustomer":
      return dotypos.createCustomer(failureOutcomeCustomerDetails);
  }
};

const creationScriptResponse = (
  request: Request,
  operation: CreationOutcomeOperation,
  step: CreationOutcomeStep
): Response | Promise<Response> => {
  if (step === "429" || step === "503") {
    const status = Number(step);
    return Response.json(
      { error: "synthetic_failure", code: status },
      { status }
    );
  }
  if (step === "empty-array") return Response.json([]);
  if (step === "fetch-failed") throw new TypeError("fetch failed");
  if (step === "timeout") {
    return new Promise<Response>((_resolve, reject) => {
      const rejectOnAbort = () => reject(request.signal.reason);
      if (request.signal.aborted) rejectOnAbort();
      else
        request.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
  }
  if (step === "bad-identifier") {
    return operation === "createReservation"
      ? Response.json([{ ...reservation(), id: "" }])
      : Response.json([{ ...customer(), id: "" }]);
  }
  return operation === "createReservation"
    ? Response.json([reservation()])
    : Response.json([customer()]);
};

const makeCreationScriptFetch = (
  operation: CreationOutcomeOperation,
  steps: readonly CreationOutcomeStep[]
) => {
  let attempt = 0;
  const postPath =
    operation === "createReservation"
      ? "/clouds/cloud-id/reservations"
      : "/clouds/cloud-id/customers";
  const fetchMock = mockDotyposFetch((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/signin/token") return tokenResponse();
    if (
      operation === "findOrCreateCustomer" &&
      request.method === "GET" &&
      url.pathname === postPath
    ) {
      return Response.json({ data: [], nextPage: null, lastPage: "1" });
    }
    if (request.method === "POST" && url.pathname === postPath) {
      const step = steps[Math.min(attempt, steps.length - 1)] ?? "success";
      attempt += 1;
      return creationScriptResponse(request, operation, step);
    }
    return new Response("Not found", { status: 404 });
  });
  return { fetchMock, postPath };
};

describe("DotyposService creation retry guard", () => {
  test.each(
    creationRetryScenarios.flatMap((scenario) =>
      (["createReservation", "findOrCreateCustomer"] as const).map(
        (operation) => ({ operation, scenario })
      )
    )
  )("$operation: $scenario.label", async ({ operation, scenario }) => {
    const { fetchMock, postPath } = makeCreationScriptFetch(
      operation,
      scenario.steps
    );
    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* runCreationOutcomeOperation(dotypos, operation).pipe(
          Effect.result
        );
      }),
      fetchMock
    );

    let request: string;
    if (operation === "createReservation") request = "reservation.create";
    else if (operation === "findOrCreateCustomer") {
      request = "customer.createAfterLookup";
    } else request = "customer.create";
    const postCount = fetchMock.mock.calls.filter((call) => {
      const request = getRequest(call as FetchCall);
      return (
        request.method === "POST" && new URL(request.url).pathname === postPath
      );
    }).length;
    expect(postCount).toBe(scenario.expectedPostCount);
    if (!scenario.expectedTag) {
      expect(result).toMatchObject({ _tag: "Success" });
      return;
    }

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: scenario.expectedTag,
        reason: scenario.expectedReason,
        operation,
        request,
        ...(scenario.expectedHttpStatus !== undefined && {
          httpStatus: scenario.expectedHttpStatus,
        }),
      },
    });
  });

  test.each([...creationRetryScenarios])(
    "createCustomer never retries: $label",
    async (scenario) => {
      const { fetchMock, postPath } = makeCreationScriptFetch(
        "createCustomer",
        scenario.steps
      );
      const result = await runWithServiceRetryingInstantly(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos
            .createCustomer(failureOutcomeCustomerDetails)
            .pipe(Effect.result);
        }),
        fetchMock
      );
      const postCount = fetchMock.mock.calls.filter((call) => {
        const request = getRequest(call as FetchCall);
        return (
          request.method === "POST" &&
          new URL(request.url).pathname === postPath
        );
      }).length;
      expect(postCount).toBe(1);

      if (!scenario.expectedTag) {
        expect(result).toMatchObject({ _tag: "Failure" });
        if (!Predicate.isTagged(result, "Failure")) return;
        expect((result as { failure: unknown }).failure).toMatchObject({
          _tag: "DotyposUnavailable",
          reason: "rate-limited",
          operation: "createCustomer",
          request: "customer.create",
          httpStatus: 429,
        });
        return;
      }
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: scenario.expectedTag,
          reason: scenario.expectedReason,
          operation: "createCustomer",
          request: "customer.create",
        },
      });
      if (!Predicate.isTagged(result, "Failure")) return;
      const failure = result.failure as { readonly httpStatus?: number };
      expect(failure.httpStatus).toBe(scenario.expectedHttpStatus);
      expect(Object.hasOwn(failure, "httpStatus")).toBe(
        scenario.expectedHttpStatus !== undefined
      );
    }
  );

  test("pins every request profile to the spec table", () => {
    expect(dotyposRequestProfiles).toEqual({
      "reservation.get": { effect: "read", repeat: "safe", retry: "transient" },
      "reservation.status": {
        effect: "read",
        repeat: "safe",
        retry: "transient",
      },
      "reservation.create": {
        effect: "write",
        repeat: "unsafe",
        retry: "creation",
      },
      "reservation.version": {
        effect: "read",
        repeat: "safe",
        retry: "transient",
      },
      "reservation.patch": {
        effect: "write",
        repeat: "conditional",
        retry: "replay",
      },
      "reservation.delete": {
        effect: "write",
        repeat: "unsafe",
        retry: "none",
      },
      "customer.get": { effect: "read", repeat: "safe", retry: "transient" },
      "customer.version": {
        effect: "read",
        repeat: "safe",
        retry: "transient",
      },
      "customer.patch": {
        effect: "write",
        repeat: "conditional",
        retry: "replay",
      },
      "customer.fill": {
        effect: "write",
        repeat: "idempotent",
        retry: "replay",
      },
      "customer.create": { effect: "write", repeat: "unsafe", retry: "none" },
      "customer.createAfterLookup": {
        effect: "write",
        repeat: "unsafe",
        retry: "creation",
      },
      "customers.page": { effect: "read", repeat: "safe", retry: "none" },
      "customers.changes": { effect: "read", repeat: "safe", retry: "none" },
      "customers.search": {
        effect: "read",
        repeat: "safe",
        retry: "transient",
      },
      "customers.lookup": {
        effect: "read",
        repeat: "safe",
        retry: "transient",
      },
      "discountGroup.get": {
        effect: "read",
        repeat: "safe",
        retry: "transient",
      },
      "discountGroups.list": {
        effect: "read",
        repeat: "safe",
        retry: "transient",
      },
      "tables.list": { effect: "read", repeat: "safe", retry: "transient" },
      "reservations.list": {
        effect: "read",
        repeat: "safe",
        retry: "transient",
      },
      "reservations.page": { effect: "read", repeat: "safe", retry: "none" },
      "products.list": { effect: "read", repeat: "safe", retry: "transient" },
      "categories.list": { effect: "read", repeat: "safe", retry: "transient" },
    });
    expect(Object.keys(dotyposRequestProfiles)).toHaveLength(23);
  });
});

type PatchReplayRow = {
  readonly label: string;
  readonly version:
    | "success"
    | "not-found"
    | "server-four-times"
    | "missing-etag";
  readonly patches: readonly (number | "success")[];
  readonly expected:
    | "some"
    | "none"
    | {
        readonly _tag: string;
        readonly reason?: string;
        readonly httpStatus?: number;
        readonly request: string;
      };
  readonly expectedPatchCount: number;
};

const patchReplayRows: readonly PatchReplayRow[] = [
  {
    label: "503 then 200 replays with the same ETag",
    version: "success",
    patches: [503, "success"],
    expected: "some",
    expectedPatchCount: 2,
  },
  {
    label: "503 then 412 stays uncertain after replay",
    version: "success",
    patches: [503, 412],
    expected: {
      _tag: "DotyposUncertain",
      reason: "conflict-after-replay",
      request: "customer.patch",
      httpStatus: 412,
    },
    expectedPatchCount: 2,
  },
  {
    label: "412 without an earlier uncertain attempt is a version conflict",
    version: "success",
    patches: [412],
    expected: {
      _tag: "DotyposVersionConflict",
      request: "customer.patch",
      httpStatus: 412,
    },
    expectedPatchCount: 1,
  },
  {
    label: "503 then 404 stays uncertain instead of becoming none",
    version: "success",
    patches: [503, 404],
    expected: {
      _tag: "DotyposUncertain",
      reason: "server",
      request: "customer.patch",
      httpStatus: 404,
    },
    expectedPatchCount: 2,
  },
  {
    label: "ETag GET 404 returns none without a PATCH",
    version: "not-found",
    patches: [],
    expected: "none",
    expectedPatchCount: 0,
  },
  {
    label: "first PATCH 404 returns none",
    version: "success",
    patches: [404],
    expected: "none",
    expectedPatchCount: 1,
  },
  {
    label: "four ETag GET 503 responses fail before PATCH",
    version: "server-four-times",
    patches: [],
    expected: {
      _tag: "DotyposUnavailable",
      reason: "server",
      request: "customer.version",
      httpStatus: 503,
    },
    expectedPatchCount: 0,
  },
  {
    label: "missing ETag is an invalid response before PATCH",
    version: "missing-etag",
    patches: [],
    expected: {
      _tag: "DotyposRejected",
      reason: "invalid-response",
      request: "customer.version",
    },
    expectedPatchCount: 0,
  },
  {
    label: "503 then three 429 responses keeps the first uncertainty",
    version: "success",
    patches: [503, 429, 429, 429],
    expected: {
      _tag: "DotyposUncertain",
      reason: "server",
      request: "customer.patch",
      httpStatus: 429,
    },
    expectedPatchCount: 4,
  },
];

describe("DotyposService conditional-write replay", () => {
  test.each([...patchReplayRows])("$label", async (row) => {
    let versionReads = 0;
    let patchIndex = 0;
    const ifMatchHeaders: Array<string | null> = [];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/customers/customer-id" &&
        request.method === "GET"
      ) {
        versionReads += 1;
        if (row.version === "not-found") {
          return new Response("Not found", { status: 404 });
        }
        if (row.version === "server-four-times") {
          return new Response("Unavailable", { status: 503 });
        }
        return Response.json(customer(), {
          headers:
            row.version === "missing-etag" ? {} : { ETag: '"customer-v1"' },
        });
      }
      if (
        url.pathname === "/clouds/cloud-id/customers/customer-id" &&
        request.method === "PATCH"
      ) {
        ifMatchHeaders.push(request.headers.get("if-match"));
        const patch = row.patches[Math.min(patchIndex, row.patches.length - 1)];
        patchIndex += 1;
        if (patch === "success") {
          return Response.json(customer({ firstName: "Grace" }));
        }
        return new Response("Failure", { status: patch ?? 404 });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .patchCustomer(dotyposCustomerId("customer-id"), {
            firstName: "Grace",
          })
          .pipe(Effect.result);
      }),
      fetchMock
    );

    if (row.expected === "some") {
      expect(result).toMatchObject({ _tag: "Success" });
      if (Predicate.isTagged(result, "Success")) {
        expect(Option.isSome(result.success)).toBe(true);
      }
    } else if (row.expected === "none") {
      expect(result).toMatchObject({ _tag: "Success", success: Option.none() });
    } else {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: row.expected._tag,
          ...(row.expected.reason && { reason: row.expected.reason }),
          operation: "patchCustomer",
          request: row.expected.request,
          ...(row.expected.httpStatus !== undefined && {
            httpStatus: row.expected.httpStatus,
          }),
        },
      });
      if (Predicate.isTagged(result, "Failure")) {
        const failure = result.failure as { readonly httpStatus?: number };
        expect(failure.httpStatus).toBe(row.expected.httpStatus);
        expect(Object.hasOwn(failure, "httpStatus")).toBe(
          row.expected.httpStatus !== undefined
        );
      }
    }
    expect(versionReads).toBe(row.version === "server-four-times" ? 4 : 1);
    expect(patchIndex).toBe(row.expectedPatchCount);
    if (row.label === "503 then 200 replays with the same ETag") {
      expect(ifMatchHeaders).toEqual(['"customer-v1"', '"customer-v1"']);
    }
  });

  test.each([
    {
      label: "CANCELLED cannot be revived",
      version: "CANCELLED",
      patchStatus: undefined,
      expected: "DotyposReservationCancelledError",
      patchCount: 0,
    },
    {
      label: "CONFIRMED skips PATCH",
      version: "CONFIRMED",
      patchStatus: undefined,
      expected: "success",
      patchCount: 0,
    },
    {
      label: "version GET 404 is not-found",
      version: "NEW",
      getStatus: 404,
      patchStatus: undefined,
      expected: "DotyposRejected",
      reason: "not-found",
      request: "reservation.version",
      httpStatus: 404,
      patchCount: 0,
    },
    {
      label: "NEW and PATCH 412 is a version conflict",
      version: "NEW",
      patchStatus: 412,
      expected: "DotyposVersionConflict",
      request: "reservation.patch",
      httpStatus: 412,
      patchCount: 1,
    },
  ])("confirmReservation: $label", async (row) => {
    let versionReads = 0;
    let patchCount = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "GET"
      ) {
        versionReads += 1;
        if (row.getStatus === 404)
          return new Response("Not found", { status: 404 });
        return Response.json(reservation({ status: row.version }), {
          headers: { ETag: '"reservation-v1"' },
        });
      }
      if (
        url.pathname === "/clouds/cloud-id/reservations/reservation-id" &&
        request.method === "PATCH"
      ) {
        patchCount += 1;
        if (row.patchStatus)
          return new Response("Precondition failed", {
            status: row.patchStatus,
          });
        return Response.json(reservation({ status: "CONFIRMED" }));
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .confirmReservation(dotyposReservationId("reservation-id"))
          .pipe(Effect.result);
      }),
      fetchMock
    );

    if (row.expected === "success") {
      expect(result).toMatchObject({ _tag: "Success" });
    } else if (row.expected === "DotyposReservationCancelledError") {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DotyposReservationCancelledError",
          reservationId: "reservation-id",
        },
      });
    } else {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: row.expected,
          ...(row.reason && { reason: row.reason }),
          operation: "confirmReservation",
          request: row.request,
          ...(row.httpStatus !== undefined && { httpStatus: row.httpStatus }),
        },
      });
    }
    expect(versionReads).toBe(1);
    expect(patchCount).toBe(row.patchCount);
  });
});

type SingleReadPageOperation =
  | "getCustomersByIds"
  | "listCustomerChanges"
  | "listReservationsPage";

const singleReadPageSpecs = {
  getCustomersByIds: {
    request: "customers.page",
    path: "/clouds/cloud-id/customers",
  },
  listCustomerChanges: {
    request: "customers.changes",
    path: "/clouds/cloud-id/customers",
  },
  listReservationsPage: {
    request: "reservations.page",
    path: "/clouds/cloud-id/reservations",
  },
} as const;

const invokeSingleReadPage = (
  dotypos: IDotyposService,
  operation: SingleReadPageOperation
): Effect.Effect<unknown, unknown, never> => {
  switch (operation) {
    case "getCustomersByIds":
      return dotypos.getCustomersByIds([dotyposCustomerId("customer-id")]);
    case "listCustomerChanges":
      return dotypos.listCustomerChanges({
        selection: CustomerVersionSelection.ChangedFrom({
          versionDate: failureOutcomeChangedSince,
        }),
      });
    case "listReservationsPage":
      return dotypos.listReservationsPage({ page: 1 });
  }
};

describe("DotyposService read retry boundary", () => {
  test.each(Object.keys(singleReadPageSpecs) as SingleReadPageOperation[])(
    "$operation does not retry a page 503",
    async (operation) => {
      const spec = singleReadPageSpecs[operation];
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        return new Response("Unavailable", { status: 503 });
      });
      const result = await runWithServiceRetryingInstantly(
        Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* invokeSingleReadPage(dotypos, operation).pipe(
            Effect.result
          );
        }),
        fetchMock
      );
      const pageRequests = fetchMock.mock.calls.filter((call) => {
        const request = getRequest(call as FetchCall);
        return (
          request.method === "GET" &&
          new URL(request.url).pathname === spec.path
        );
      });

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DotyposUnavailable",
          reason: "server",
          operation,
          request: spec.request,
          httpStatus: 503,
        },
      });
      expect(pageRequests).toHaveLength(1);
    }
  );

  test("does not retry a generated products decode failure", async () => {
    let productRequests = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/products") {
        productRequests += 1;
        return Response.json({ data: [{}] });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getProducts({}).pipe(Effect.result);
      }),
      fetchMock
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DotyposRejected",
        reason: "invalid-response",
        operation: "getProducts",
        request: "products.list",
      },
    });
    if (Predicate.isTagged(result, "Failure")) {
      expect(result.failure.httpStatus).toBeUndefined();
      expect(Object.hasOwn(result.failure, "httpStatus")).toBe(false);
    }
    expect(productRequests).toBe(1);
  });

  test.each([
    {
      label: "reservation 404",
      linkedCustomer: false,
      missingCustomerId: false,
    },
    {
      label: "linked customer 404",
      linkedCustomer: true,
      missingCustomerId: false,
    },
    {
      label: "missing customer ID",
      linkedCustomer: false,
      missingCustomerId: true,
    },
  ])("getReservation read boundary: $label", async (row) => {
    let reservationReads = 0;
    let customerReads = 0;
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (url.pathname === "/clouds/cloud-id/reservations/reservation-id") {
        reservationReads += 1;
        if (!row.linkedCustomer && !row.missingCustomerId) {
          return new Response("Not found", { status: 404 });
        }
        return Response.json({
          ...reservation(),
          ...(row.missingCustomerId && { _customerId: "" }),
        });
      }
      if (url.pathname === "/clouds/cloud-id/customers/customer-id") {
        customerReads += 1;
        return new Response("Not found", { status: 404 });
      }
      return new Response("Not found", { status: 404 });
    });
    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos
          .getReservation(dotyposReservationId("reservation-id"))
          .pipe(Effect.result);
      }),
      fetchMock
    );

    if (!row.linkedCustomer && !row.missingCustomerId) {
      expect(result).toMatchObject({ _tag: "Success", success: Option.none() });
      expect(customerReads).toBe(0);
    } else if (row.linkedCustomer) {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DotyposRejected",
          reason: "not-found",
          operation: "getReservation",
          request: "customer.get",
          httpStatus: 404,
        },
      });
      expect(customerReads).toBe(1);
    } else {
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DotyposRejected",
          reason: "invalid-response",
          operation: "getReservation",
          request: "reservation.get",
        },
      });
      expect(result).not.toHaveProperty("failure.httpStatus");
      expect(customerReads).toBe(0);
    }
    expect(reservationReads).toBe(1);
  });
});

const failureOutcomeChangedSince = Schema.decodeUnknownSync(
  DotyposTimestampFromString
)("2026-06-20T10:00:00.000Z");

describe("DotyposService package input validation", () => {
  test.each([
    { family: "reservation dates", operation: "createReservation" },
    { family: "customer id filter", operation: "getCustomersByIds" },
    { family: "ambiguous customer lookup", operation: "findOrCreateCustomer" },
  ])("rejects invalid $family inputs before writes", async (row) => {
    const duplicateCustomers = [
      customer({ id: "candidate-1", email: adaAddress }),
      customer({ id: "candidate-2", email: adaAddress }),
    ];
    const fetchMock = mockDotyposFetch((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token") return tokenResponse();
      if (
        row.operation === "findOrCreateCustomer" &&
        url.pathname === "/clouds/cloud-id/customers" &&
        request.method === "GET"
      ) {
        return url.searchParams.get("filter")?.includes("email|like|")
          ? Response.json({
              data: duplicateCustomers,
              nextPage: null,
              lastPage: "1",
            })
          : Response.json({ data: [], nextPage: null, lastPage: "1" });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await runWithServiceRetryingInstantly(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        switch (row.operation) {
          case "createReservation":
            return yield* dotypos
              .createReservation({
                ...failureOutcomeReservationInput,
                startDate: new Date("invalid"),
              })
              .pipe(Effect.result);
          case "getCustomersByIds":
            return yield* dotypos
              .getCustomersByIds(
                Array.from({ length: dotyposIdReadBatchSize + 1 }, (_, i) =>
                  dotyposCustomerId(`customer-${i + 1};invalid`)
                )
              )
              .pipe(Effect.result);
          case "findOrCreateCustomer":
            return yield* dotypos
              .findOrCreateCustomer({
                firstName: "Ada",
                lastName: "Lovelace",
                email: adaAddress,
                phone: "+420 777 123 456",
              })
              .pipe(Effect.result);
        }
      }),
      fetchMock
    );

    const expected =
      row.operation === "findOrCreateCustomer"
        ? {
            reason: "ambiguous-match",
            operation: "findOrCreateCustomer",
            request: "customers.lookup" as const,
          }
        : {
            reason: "invalid-request",
            operation: row.operation,
          };
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "DotyposRejected", ...expected },
    });
    if (Predicate.isTagged(result, "Failure")) {
      expect(result.failure.request).toBe(expected.request);
      expect(Object.hasOwn(result.failure, "request")).toBe(
        expected.request !== undefined
      );
      expect(result.failure.httpStatus).toBeUndefined();
    }
    const customerPosts = fetchMock.mock.calls.filter((call) => {
      const request = getRequest(call as FetchCall);
      return (
        request.method === "POST" &&
        new URL(request.url).pathname === "/clouds/cloud-id/customers"
      );
    });
    expect(customerPosts).toHaveLength(0);
    if (row.operation !== "findOrCreateCustomer") {
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });
});

describe("DotyposService ID reads", () => {
  const read = (
    dotypos: IDotyposService,
    resource: "customers" | "reservations",
    ids: readonly string[],
    options?: import("./id-reads").DotyposIdReadOptions
  ): Effect.Effect<
    ReadonlyMap<string, unknown>,
    import("../errors").DotyposReadFailure
  > =>
    resource === "customers"
      ? dotypos.getCustomersByIds(
          ids.map((id) => dotyposCustomerId(id)),
          options
        )
      : dotypos.getReservationsByIds(
          ids.map((id) => dotyposReservationId(id)),
          options
        );

  test.each(["customers", "reservations"] as const)(
    "%s handles empty 404s, unidentified records and invalid filters",
    async (resource) => {
      for (const response of [
        () => Response.json(null, { status: 404 }),
        () => {
          const { id, ...unidentified } =
            resource === "customers" ? customer() : reservation();
          return Response.json({ data: [unidentified] });
        },
      ]) {
        let attempts = 0;
        const fetchMock = mockDotyposFetch((request) => {
          if (new URL(request.url).pathname === "/signin/token")
            return tokenResponse();
          attempts++;
          return response();
        });
        const result = await runWithService(
          Effect.flatMap(DotyposService, (dotypos) =>
            read(dotypos, resource, ["id-0"])
          ),
          fetchMock
        );
        expect(result.size).toBe(0);
        expect(attempts).toBe(1);
      }
      let attempts = 0;
      const fetchMock = mockDotyposFetch(() => {
        attempts++;
        return tokenResponse();
      });
      const result = await runWithService(
        Effect.flatMap(DotyposService, (dotypos) =>
          read(dotypos, resource, ["id-0", "invalid;id"]).pipe(Effect.result)
        ),
        fetchMock
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DotyposRejected", reason: "invalid-request" },
      });
      expect(attempts).toBe(0);
    }
  );

  test.each(["customers", "reservations"] as const)(
    "%s deduplicates, batches and matches request cost",
    async (resource) => {
      for (const count of [0, 1, 99, 100, 101, 200, 201, 301]) {
        const ids = Array.from({ length: count }, (_, i) => `id-${i}`);
        const calls: string[][] = [];
        const fetchMock = mockDotyposFetch((request) => {
          const url = new URL(request.url);
          if (url.pathname === "/signin/token") return tokenResponse();
          const selected = url.searchParams
            .get("filter")!
            .split(";")[0]!
            .slice(6)
            .split(",");
          calls.push(selected);
          expect(url.searchParams.get("limit")).toBe("100");
          expect(url.searchParams.get("page")).toBe("1");
          return Response.json({
            data: selected
              .filter((id) => id !== "id-0")
              .map((id) =>
                resource === "customers"
                  ? customer({ id })
                  : reservation({ id })
              ),
            nextPage: null,
            lastPage: "1",
          });
        });
        const result = await runWithService(
          Effect.flatMap(DotyposService, (dotypos) =>
            read(dotypos, resource, [...ids, ...ids], { concurrency: 1 })
          ),
          fetchMock
        );
        expect(calls).toHaveLength(dotyposIdReadRequests(new Set(ids).size));
        expect(calls.flat()).toEqual(ids);
        expect(result.size).toBe(Math.max(0, count - 1));
        expect(result.has("id-0" as never)).toBe(false);
      }
    }
  );

  test.each(["customers", "reservations"] as const)(
    "%s retains successful batches only when the caller recovers a failed batch",
    async (resource) => {
      const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
      const failures: string[] = [];
      let attempts = 0;
      const fetchMock = mockDotyposFetch((request) => {
        const url = new URL(request.url);
        if (url.pathname === "/signin/token") return tokenResponse();
        attempts++;
        const selected = url.searchParams
          .get("filter")!
          .split(";")[0]!
          .slice(6)
          .split(",");
        if (selected[0] === "id-100")
          return new Response("Unavailable", { status: 503 });
        return Response.json({
          data: selected.map((id) =>
            resource === "customers" ? customer({ id }) : reservation({ id })
          ),
        });
      });
      const recover = (failure: { readonly _tag: string }) =>
        Effect.sync(() => {
          failures.push(failure._tag);
        });
      const result = await runWithService(
        Effect.flatMap(DotyposService, (dotypos) =>
          read(dotypos, resource, ids, {
            concurrency: 1,
            onBatchFailure: recover,
          })
        ),
        fetchMock
      );
      expect(attempts).toBe(3);
      expect(failures).toEqual(["DotyposUnavailable"]);
      expect([...result.keys()]).toEqual([...ids.slice(0, 100), "id-200"]);
      attempts = 0;
      const failed = await runWithService(
        Effect.flatMap(DotyposService, (dotypos) =>
          read(dotypos, resource, ids, { concurrency: 1 }).pipe(Effect.result)
        ),
        fetchMock
      );
      expect(failed).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DotyposUnavailable" },
      });
      expect(attempts).toBe(2);
    }
  );

  test.each(["customers", "reservations"] as const)(
    "%s rejects unexpected paging without following it",
    async (resource) => {
      for (const paging of [
        { nextPage: "2" },
        { lastPage: "2" },
        { nextPage: "invalid" },
      ]) {
        let attempts = 0;
        const fetchMock = mockDotyposFetch((request) => {
          if (new URL(request.url).pathname === "/signin/token")
            return tokenResponse();
          attempts++;
          return Response.json({ data: [], ...paging });
        });
        const result = await runWithService(
          Effect.flatMap(DotyposService, (dotypos) =>
            read(dotypos, resource, ["id-0"]).pipe(Effect.result)
          ),
          fetchMock
        );
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DotyposRejected", reason: "invalid-response" },
        });
        expect(attempts).toBe(1);
      }
    }
  );

  test.each(["customers", "reservations"] as const)(
    "%s honors sequential and bounded concurrency",
    async (resource) => {
      for (const concurrency of [1, 2]) {
        let open = 0;
        let peak = 0;
        const fetchMock = mockDotyposFetch(async (request) => {
          if (new URL(request.url).pathname === "/signin/token")
            return tokenResponse();
          open++;
          peak = Math.max(peak, open);
          await Promise.resolve();
          open--;
          return Response.json({ data: [] });
        });
        const ids = Array.from({ length: 301 }, (_, i) => `id-${i}`);
        await runWithService(
          Effect.flatMap(DotyposService, (dotypos) =>
            read(dotypos, resource, ids, { concurrency })
          ),
          fetchMock
        );
        expect(peak).toBe(concurrency);
      }
    }
  );
});
