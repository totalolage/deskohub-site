import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { makeDotyposRuntimeConfigLayer } from "../config";
import { ExternalAPIError } from "../errors";
import type { Customer } from "../generated/types.gen";
import { DotyposApi } from "./api";
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

const customer = (overrides: Partial<Customer>): Customer => ({
  _cloudId: config.cloudId,
  id: "customer-id",
  firstName: "Ada",
  points: null,
  flags: "0",
  display: true,
  deleted: false,
  ...overrides,
});

const runWithApi = <A, E>(
  effect: Effect.Effect<A, E, DotyposService>,
  api: DotyposApi
) => {
  const dependencies = Layer.merge(
    Layer.succeed(DotyposApi, api),
    makeDotyposRuntimeConfigLayer(config)
  );
  const serviceLayer = DotyposService.DefaultWithoutDependencies.pipe(
    Layer.provide(dependencies)
  );

  return Effect.runPromise(effect.pipe(Effect.provide(serviceLayer)));
};

const makeApi = (overrides: Partial<DotyposApi> = {}): DotyposApi => ({
  searchCustomers: mock(() => Effect.succeed<Customer[]>([])),
  createCustomer: mock((params) =>
    Effect.succeed(customer({ id: "created-customer-id", ...params.body }))
  ),
  updateCustomer: mock((params) =>
    Effect.succeed(customer({ id: params.path.customerId, ...params.body }))
  ),
  getCustomer: mock(() => Effect.die("getCustomer not mocked")),
  createReservation: mock(() => Effect.die("createReservation not mocked")),
  getReservation: mock(() => Effect.die("getReservation not mocked")),
  listReservations: mock(() => Effect.die("listReservations not mocked")),
  getTables: mock(() => Effect.die("getTables not mocked")),
  getProducts: mock(() => Effect.die("getProducts not mocked")),
  getCategories: mock(() => Effect.die("getCategories not mocked")),
  getDiscountGroup: mock(() => Effect.die("getDiscountGroup not mocked")),
  ...overrides,
});

describe("DotyposService customer lookup", () => {
  test("finds by exact email after API like search", async () => {
    const matched = customer({ id: "email-match", email: "ada@example.com" });
    const api = makeApi({
      searchCustomers: mock(() =>
        Effect.succeed([
          customer({ id: "partial", email: "not-ada@example.com" }),
          matched,
        ])
      ),
    });

    const result = await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer({
          firstName: "Ada",
          email: "ada@example.com",
        });
      }),
      api
    );

    expect(result).toEqual({
      _tag: "Matched",
      customer: matched,
      matches: [matched],
    });
    expect(api.searchCustomers).toHaveBeenCalledWith({
      path: { cloudId: config.cloudId },
      query: { limit: 100, filter: "email|like|ada@example.com" },
    });
  });

  test("finds by phone using normalized matching", async () => {
    const matched = customer({ id: "phone-match", phone: "+420777777777" });
    const api = makeApi({
      searchCustomers: mock((params) =>
        params.query.filter === "phone|like|+420777777777"
          ? Effect.succeed([matched])
          : Effect.succeed<Customer[]>([])
      ),
    });

    const result = await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer({
          firstName: "Ada",
          phone: "777 777 777",
        });
      }),
      api
    );

    expect(result._tag).toBe("Matched");
    expect(result.matches).toEqual([matched]);
  });

  test("findCustomer does not call create or update", async () => {
    const matched = customer({ id: "email-match", email: "ada@example.com" });
    const api = makeApi({
      searchCustomers: mock(() => Effect.succeed([matched])),
    });

    await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer({
          firstName: "Ada",
          email: "ada@example.com",
        });
      }),
      api
    );

    expect(api.createCustomer).not.toHaveBeenCalled();
    expect(api.updateCustomer).not.toHaveBeenCalled();
  });

  test("404 search returns no match", async () => {
    const api = makeApi({
      searchCustomers: mock(() =>
        Effect.fail(
          new ExternalAPIError({
            service: "Dotypos",
            operation: "Search customers",
            statusCode: 404,
          })
        )
      ),
    });

    const result = await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer({
          firstName: "Ada",
          email: "ada@example.com",
        });
      }),
      api
    );

    expect(result).toEqual({ _tag: "NotFound", matches: [] });
  });

  test('workspace-style lookupFields:["email"] does not match by phone', async () => {
    const phoneMatch = customer({ id: "phone-match", phone: "+420777777777" });
    const searchCustomers = mock(() => Effect.succeed([phoneMatch]));
    const api = makeApi({ searchCustomers });

    const result = await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer(
          {
            firstName: "Ada",
            email: "ada@example.com",
            phone: "777 777 777",
          },
          { lookupFields: ["email"] }
        );
      }),
      api
    );

    expect(result).toEqual({ _tag: "NotFound", matches: [] });
    expect(api.searchCustomers).toHaveBeenCalledTimes(1);
    expect(searchCustomers.mock.calls[0]?.[0].query.filter).toBe(
      "email|like|ada@example.com"
    );
  });

  test("findOrCreateCustomer reuses lookup and updates the existing customer", async () => {
    const existing = customer({
      id: "existing-customer-id",
      email: "ada@example.com",
      firstName: null,
    });
    const api = makeApi({
      searchCustomers: mock(() => Effect.succeed([existing])),
    });

    const result = await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer({
          firstName: "Ada",
          email: "ada@example.com",
        });
      }),
      api
    );

    expect(api.updateCustomer).toHaveBeenCalledWith({
      path: { cloudId: config.cloudId, customerId: "existing-customer-id" },
      body: { firstName: "Ada" },
    });
    expect(api.createCustomer).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ id: "existing-customer-id", firstName: "Ada" })
    );
  });

  test("findOrCreateCustomer creates when lookup has no match", async () => {
    const api = makeApi();

    const result = await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer({
          firstName: "Ada",
          email: "ada@example.com",
          phone: "777 777 777",
        });
      }),
      api
    );

    expect(api.createCustomer).toHaveBeenCalledWith({
      path: { cloudId: config.cloudId },
      body: expect.objectContaining({
        _cloudId: config.cloudId,
        firstName: "Ada",
        email: "ada@example.com",
        phone: "+420777777777",
      }),
    });
    expect(api.updateCustomer).not.toHaveBeenCalled();
    expect(result.id).toBe("created-customer-id");
  });

  test("ambiguous exact matches are explicit for safe discount lookup", async () => {
    const first = customer({ id: "first", email: "ada@example.com" });
    const second = customer({ id: "second", email: "ada@example.com" });
    const api = makeApi({
      searchCustomers: mock(() => Effect.succeed([first, second])),
    });

    const result = await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findCustomer({
          firstName: "Ada",
          email: "ada@example.com",
        });
      }),
      api
    );

    expect(result).toEqual({
      _tag: "Ambiguous",
      matches: [first, second],
    });
  });

  test("findOrCreateCustomer preserves first-match behavior on ambiguity", async () => {
    const first = customer({ id: "first", email: "ada@example.com" });
    const second = customer({ id: "second", email: "ada@example.com" });
    const api = makeApi({
      searchCustomers: mock(() => Effect.succeed([first, second])),
    });

    const result = await runWithApi(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.findOrCreateCustomer({
          firstName: "Ada",
          email: "ada@example.com",
        });
      }),
      api
    );

    expect(result).toBe(first);
    expect(api.createCustomer).not.toHaveBeenCalled();
  });
});
