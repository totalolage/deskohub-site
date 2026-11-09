import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer, Logger, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  DotyposRuntimeConfigSchema,
  makeDotyposRuntimeConfigLayer,
} from "../config";
import type { Customer, Reservation } from "../generated/effect.gen";
import {
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
} from "../types";
import { DotyposAccessToken, DotyposGeneratedClient } from "./api";
import { makeInMemoryDotypos } from "./in-memory-dotypos";
import { DotyposService } from "./service";

/**
 * Runs each case against Live over a fetch mock that answers with the
 * fixture records below in the documented response shapes, and against the
 * in-memory fake seeded with the same records, and expects one outcome.
 * Agreement here shows only that both adapters read these fixture
 * responses alike; it says nothing about how live Dotypos behaves.
 */

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

const customerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema);
const reservationId = Schema.decodeUnknownSync(DotyposReservationIdSchema);

const customerFixture = (overrides: Partial<Customer>): Customer => ({
  id: "customer-id",
  _cloudId: "cloud-id",
  firstName: "Ada",
  points: null,
  flags: "0",
  display: true,
  deleted: false,
  ...overrides,
});

const reservationFixture = (overrides: Partial<Reservation>): Reservation => ({
  id: "reservation-id",
  _branchId: "branch-id",
  _cloudId: "cloud-id",
  _customerId: "customer-id",
  _tableId: "table-id",
  startDate: "2026-06-20T10:00:00.000Z",
  endDate: "2026-06-20T12:00:00.000Z",
  seats: "2",
  status: "NEW",
  ...overrides,
});

const fixtures = () => ({
  customers: [
    customerFixture({ id: "customer-id" }),
    customerFixture({ id: "deleted-customer", deleted: true }),
  ],
  reservations: [
    reservationFixture({ id: "new" }),
    reservationFixture({ id: "confirmed", status: "CONFIRMED" }),
    reservationFixture({ id: "cancelled", status: "CANCELLED" }),
    reservationFixture({ id: "orphan", _customerId: "gone" }),
  ],
});

/** A fetch mock serving the fixture records the way the OpenAPI contract documents. */
const fixtureFetch = (): typeof globalThis.fetch => {
  const { customers, reservations } = fixtures();
  const notFound = () => new Response(null, { status: 404 });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/signin/token") {
      return Response.json({ accessToken: "access-token" });
    }
    const [, , , collection, id] = url.pathname.split("/");
    if (collection === "customers" && id === undefined) {
      const ids = /^id\|in\|([^;]*)/.exec(url.searchParams.get("filter") ?? "");
      const selected = customers.filter((record) =>
        ids?.[1]?.split(",").includes(record.id)
      );
      return selected.length === 0
        ? notFound()
        : Response.json({ data: selected, currentPage: "1", lastPage: "1" });
    }
    const records = collection === "customers" ? customers : reservations;
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return notFound();
    if (request.method === "PATCH") {
      const patched = { ...records[index]!, ...(await request.json()) };
      records[index] = patched;
      return Response.json(patched);
    }
    return Response.json(records[index], { headers: { ETag: `"${index}"` } });
  }) as typeof globalThis.fetch;
};

const liveLayer = () =>
  DotyposService.Default.pipe(
    Layer.provide(DotyposGeneratedClient.Default),
    Layer.provide(DotyposAccessToken.Default),
    Layer.provide(
      Layer.merge(
        makeDotyposRuntimeConfigLayer(config),
        FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fixtureFetch()))
        )
      )
    )
  );

const inMemoryLayer = () => {
  const { customers, reservations } = fixtures();
  return makeInMemoryDotypos({
    customers: customers.map((record) =>
      Schema.decodeUnknownSync(DotyposCustomerSchema)(record)
    ),
    reservations: reservations.map((record) =>
      Schema.decodeUnknownSync(DotyposReservationSchema)(record)
    ),
  }).layer;
};

/** The outcome a caller can branch on: the value, or the failure's tag, reason and request. */
const outcome = <A>(exit: Exit.Exit<A, unknown>) =>
  Exit.match(exit, {
    onSuccess: (value) => ({ value }),
    onFailure: (cause) => {
      const failure = Option.getOrUndefined(Exit.findErrorOption(exit)) as
        | Record<string, unknown>
        | undefined;
      return failure
        ? {
            failure: {
              _tag: failure._tag,
              reason: failure.reason,
              operation: failure.operation,
              request: failure.request,
              reservationId: failure.reservationId,
            },
          }
        : { defect: String(cause) };
    },
  });

const agree = async <A, E>(
  scenario: Effect.Effect<A, E, DotyposService>,
  normalize: (value: A) => unknown = (value) => value
) => {
  const runOn = (layer: Layer.Layer<DotyposService>) =>
    Effect.runPromise(
      Effect.exit(
        scenario.pipe(
          Effect.map(normalize),
          Effect.provide(Layer.merge(layer, Logger.layer([])))
        )
      )
    ).then(outcome);
  const [live, inMemory] = await Promise.all([
    runOn(liveLayer()),
    runOn(inMemoryLayer()),
  ]);
  expect(inMemory).toEqual(live);
  return live;
};

const withService = <A, E>(
  use: (service: DotyposService["Service"]) => Effect.Effect<A, E>
) => Effect.flatMap(DotyposService, use);

describe("in-memory Dotypos agrees with Live on recorded response shapes", () => {
  test("reads a reservation with its customer", async () => {
    const result = await agree(
      withService((service) => service.getReservation(reservationId("new")))
    );
    expect(result).toHaveProperty("value._tag", "Some");
  });

  test("reads a missing reservation as none and a missing customer as none", async () => {
    await agree(
      withService((service) =>
        Effect.all([
          service.getReservation(reservationId("missing")),
          service.getCustomer(customerId("missing")),
        ])
      )
    );
  });

  test("fails a reservation whose linked customer is gone", async () => {
    const result = await agree(
      withService((service) => service.getReservation(reservationId("orphan")))
    );
    expect(result).toHaveProperty("failure.request", "customer.get");
  });

  test("fails a missing reservation's status read as not found", async () => {
    const result = await agree(
      withService((service) =>
        service.getReservationStatus(reservationId("missing"))
      )
    );
    expect(result).toHaveProperty("failure.reason", "not-found");
  });

  test("reads customers by ID, deleted included and missing omitted", async () => {
    const result = await agree(
      withService((service) =>
        service.getCustomersByIds([
          customerId("customer-id"),
          customerId("deleted-customer"),
          customerId("missing"),
        ])
      ),
      (read) => [...read.keys()]
    );
    expect(result).toEqual({ value: ["customer-id", "deleted-customer"] });
  });

  test("confirms a NEW reservation and reads it back confirmed", async () => {
    await agree(
      withService((service) =>
        service
          .confirmReservation(reservationId("new"))
          .pipe(
            Effect.flatMap((confirmed) =>
              service
                .getReservationStatus(confirmed.id)
                .pipe(Effect.map((status) => [confirmed.status, status]))
            )
          )
      )
    );
  });

  test("keeps a CONFIRMED reservation and refuses to confirm a CANCELLED one", async () => {
    const results = await Promise.all([
      agree(
        withService((service) =>
          service.confirmReservation(reservationId("confirmed"))
        ),
        (confirmed) => confirmed.status
      ),
      agree(
        withService((service) =>
          service.confirmReservation(reservationId("cancelled"))
        )
      ),
    ]);
    expect(results).toEqual([
      { value: "CONFIRMED" },
      {
        failure: expect.objectContaining({
          _tag: "DotyposReservationCancelledError",
        }),
      },
    ]);
  });
});
