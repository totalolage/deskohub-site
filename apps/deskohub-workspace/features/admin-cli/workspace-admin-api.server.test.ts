import { describe, expect, test } from "bun:test";
import {
  AdministrationCanonicalDiscountCode,
  AdministrationDiscountCodeId,
  type AdministrationDiscountMutationType,
  AdministrationDotyposCustomerId,
  AdministrationStoredDiscountId,
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliBearerAuthentication,
  CliMutationInProgress,
  CliMutationRejected,
  CliMutationRequestId,
  CliResourceNotFound,
  CliSessionId,
  CurrentCliSession,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Result, Schema } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import { AdministrationService } from "@/features/administration/administration.service";
import {
  type AdminDiscount,
  type AdminDiscountCode,
  type AdminDiscountCodeDetail,
  DiscountAdminConflictError,
  type DiscountAdminDashboard,
  DiscountAdministration,
} from "@/features/discounts/admin/discount-administration.service";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";
import { CliMutationIdempotency } from "./cli-mutation-idempotency.service";
import {
  AdminCliAdministrationApiHandlers,
  AdminCliApiHandlers,
} from "./workspace-admin-api.server";

const UnusedCliAuthentication = Layer.succeed(
  CliAuthentication,
  {} as CliAuthentication["Service"]
);
const AllowCliAuthenticationStarts = Layer.succeed(CliAuthenticationAdmission, {
  isStartAllowed: Effect.succeed(true),
});
const ClaimEveryCliMutation = Layer.succeed(CliMutationIdempotency, {
  claim: () => Effect.succeed({ kind: "claimed" as const }),
  complete: () => Effect.void,
  release: () => Effect.void,
});
const session = {
  id: "01980000-0000-7000-8000-000000000000",
  clientName: "test client",
  cliVersion: "1.0.0",
  buildTarget: "development",
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
} as const;
const AuthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: (httpEffect) =>
    Effect.provideService(httpEffect, CurrentCliSession, session),
});

describe("Workspace Admin API", () => {
  test("serves the shared CLI info contract", async () => {
    const info = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, ["cli"]);
      return yield* client.cli.getInfo({});
    }).pipe(
      Effect.provide(AdminCliApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(AllowCliAuthenticationStarts),
      Effect.provide(UnusedCliAuthentication),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(info).toEqual({
      apiVersion: "v1",
      service: "deskohub-workspace",
    });
  });

  test("bounds unauthenticated authentication starts before database writes", async () => {
    const challenge = Schema.decodeUnknownSync(CliAuthenticationChallenge)(
      "h".repeat(43)
    );
    const code = Schema.decodeUnknownSync(CliAuthenticationCode)(
      "c".repeat(43)
    );
    let starts = 0;
    let admissionChecks = 0;
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      start: () =>
        Effect.sync(() => {
          starts += 1;
          return {
            code,
            approvalPath: `/admin/cli/authenticate?code=${code}`,
            expiresAt: "2026-08-10T10:00:00.000Z",
          };
        }),
    });
    const admission = Layer.succeed(CliAuthenticationAdmission, {
      isStartAllowed: Effect.sync(() => {
        admissionChecks += 1;
        return admissionChecks <= 10;
      }),
    });

    const results = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, ["cli"]);
      return yield* Effect.forEach(
        Array.from({ length: 11 }),
        () =>
          client.cli
            .startAuthentication({
              payload: {
                challenge,
                clientName: "rate limit test",
                cliVersion: "1.0.0",
                buildTarget: "development",
              },
            })
            .pipe(Effect.result),
        { concurrency: 1 }
      );
    }).pipe(
      Effect.provide(AdminCliApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(admission),
      Effect.provide(authentication),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(results.filter(Result.isFailure)).toHaveLength(1);
    expect(starts).toBe(10);
  });

  test("invokes the same administration service used by the UI", async () => {
    const bookingInputs: unknown[] = [];
    const customerReservationInputs: unknown[] = [];
    const customerSearches: unknown[] = [];
    const operationInputs: unknown[] = [];
    const orderInputs: unknown[] = [];
    const reservationInputs: unknown[] = [];
    const reservationLookups: string[] = [];
    const timestamp = "2026-08-10T10:00:00.000Z";
    const booking = {
      id: "booking-1",
      customerId: "customer-1",
      customer: null,
      startsAt: timestamp,
      endsAt: timestamp,
      seats: "1",
      status: "CONFIRMED" as const,
      statusLabel: "Confirmed",
      tableId: "table-1",
      tableName: "Focus room",
      tableLocation: null,
      linkedReservation: { id: "reservation-1", label: "Meeting room" },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const reservation = {
      id: "reservation-1",
      customerId: "customer-1",
      customer: null,
      liveDetailsAvailable: true,
      startsAt: timestamp,
      endsAt: timestamp,
      date: null,
      type: "meeting-room" as const,
      typeLabel: "Meeting room",
      status: { group: "complete" as const, label: "Complete" },
      statusNote: null,
      createdAt: timestamp,
      latestPayment: null,
      updatedAt: timestamp,
    };
    const order = {
      orderId: "order-1",
      provider: null,
      providerAvailable: false,
      providerStatus: "unavailable" as const,
      link: null,
    };
    const operation = {
      operationId: "operation-1",
      operationType: "CAPTURE",
      operationResult: "AUTHORIZED",
      linkedReservationId: reservation.id,
    };
    const discountId = AdministrationStoredDiscountId.make(
      "01980000-0000-7000-8000-000000000001"
    );
    const codeId = AdministrationDiscountCodeId.make("code-1");
    const discount = {
      id: discountId,
      labels: { "en-US": "Summer sale", "cs-CZ": "Letní sleva" },
      adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      products: [{ kind: "cowork" as const }],
      codeCount: 1,
      createdAt: Temporal.Instant.from(timestamp),
      updatedAt: Temporal.Instant.from(timestamp),
    } satisfies AdminDiscount;
    const discountCode = {
      id: codeId,
      discountId,
      code: "SUMMER10",
      enabled: true,
      validFrom: null,
      validUntil: null,
      maxUses: null,
      audienceSize: 0,
      reservedUses: 0,
      redeemedUses: 0,
      releasedUses: 0,
      remainingUses: null,
      createdAt: Temporal.Instant.from(timestamp),
      updatedAt: Temporal.Instant.from(timestamp),
    } satisfies AdminDiscountCode;
    const discountDashboard = {
      discounts: [discount],
      codes: [discountCode],
      calendar: {
        events: [],
        unavailable: false,
        calendarUrl: "https://calendar.example.com",
        from: "2026-08-01",
        to: "2026-08-31",
      },
    } satisfies DiscountAdminDashboard;
    const discountCodeDetail = {
      code: discountCode,
      discountLabel: discount.labels["en-US"],
      customers: [],
      claims: [],
    } satisfies AdminDiscountCodeDetail;
    const administration = Layer.succeed(AdministrationService, {
      loadOverview: () =>
        Effect.succeed({
          today: { unavailable: false, value: 3 },
          upcoming: { unavailable: false, value: 8 },
          lastSevenDays: { unavailable: false, value: 5 },
        }),
      listReservations: (input) =>
        Effect.sync(() => {
          reservationInputs.push(input);
          return {
            items: [],
            page: input.page ?? 1,
            pageCount: 1,
            total: 0,
            dateFilterUnavailable: false,
            dateSortUnavailable: false,
          };
        }),
      loadReservation: (id) =>
        Effect.succeed(
          id === reservation.id
            ? {
                reservation,
                booking,
                lifecycle: {
                  currentStage: "complete" as const,
                  label: "Access delivered",
                  reachedStages: [
                    "started" as const,
                    "held" as const,
                    "paid" as const,
                    "complete" as const,
                  ],
                  tone: "positive" as const,
                },
                timeline: [],
                paymentAttempts: [],
                orders: [],
                discounts: [],
                otherCustomerReservations: [],
                sameDateReservations: [],
                references: {
                  workspaceReservationId: reservation.id,
                  dotyposReservationId: booking.id,
                  customerId: reservation.customerId,
                },
              }
            : null
        ),
      findReservationId: (identifier) =>
        Effect.sync(() => {
          reservationLookups.push(identifier);
          return reservation.id;
        }),
      listBookings: (input) =>
        Effect.sync(() => {
          bookingInputs.push(input);
          return {
            items: [booking],
            page: input.page ?? 1,
            pageCount: 1,
            total: 1,
          };
        }),
      loadBooking: (id) =>
        Effect.succeed(
          id === booking.id
            ? {
                booking,
                references: {
                  bookingId: booking.id,
                  customerId: booking.customerId,
                  workspaceReservationId: reservation.id,
                },
              }
            : null
        ),
      listCustomers: (input) =>
        Effect.succeed({
          items: [],
          page: input.page ?? 1,
          pageCount: 1,
          total: 0,
        }),
      loadCustomerReservations: (input) =>
        Effect.sync(() => {
          customerReservationInputs.push(input);
          return {
            items: [reservation],
            page: input.page ?? 1,
            pageCount: 1,
            total: 1,
          };
        }),
      loadCustomerActivity: () =>
        Effect.succeed({
          reservations: [reservation],
          reservationHistoryTruncated: false,
          transactions: [],
          transactionHistoryTruncated: false,
          stats: {
            reservationCount: 1,
            favoriteProduct: reservation.typeLabel,
            revenue: [],
            discountSavings: [],
          },
          marketingConsent: null,
        }),
      listOrders: (input) =>
        Effect.sync(() => {
          orderInputs.push(input);
          return {
            items: [order],
            providerAvailable: false,
            truncated: false,
          };
        }),
      loadOrder: () => Effect.succeed(order),
      listOperations: (input) =>
        Effect.sync(() => {
          operationInputs.push(input);
          return {
            items: [operation],
            providerAvailable: true,
            truncated: false,
          };
        }),
      loadOperation: (operationId) =>
        Effect.succeed({
          operationId,
          operation,
          providerAvailable: true,
          providerStatus: "available" as const,
          linkedReservationId: reservation.id,
        }),
    } satisfies AdministrationService["Service"]);
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      searchCustomers: (input) =>
        Effect.sync(() => {
          customerSearches.push(input);
          return { kind: "not-found" as const, customers: [] };
        }),
      loadCustomerProfile: () => Effect.fail(new Error("unavailable")),
      loadDashboard: () => Effect.succeed(discountDashboard),
      loadCodeDetail: () => Effect.succeed(discountCodeDetail),
    });
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      listSessions: () => Effect.succeed([{ ...session, revokedAt: null }]),
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const overview = yield* client.administration.getOverview({});
      const reservations = yield* client.administration.listReservations({
        query: { page: 2, status: "complete" },
      });
      const reservationDetail = yield* client.administration.getReservation({
        params: { reservationId: reservation.id },
      });
      const reservationLookup = yield* client.administration.findReservation({
        query: { identifier: "payment-1" },
      });
      const bookings = yield* client.administration.listBookings({
        query: { date: "2026-08-10", page: 4 },
      });
      const bookingDetail = yield* client.administration.getBooking({
        params: { bookingId: booking.id },
      });
      const missingBooking = yield* client.administration
        .getBooking({ params: { bookingId: "missing" } })
        .pipe(Effect.flip);
      const orders = yield* client.administration.listOrders({
        query: { from: "2026-08-01", to: "2026-08-10" },
      });
      const orderDetail = yield* client.administration.getOrder({
        params: { orderId: order.orderId },
      });
      const operations = yield* client.administration.listOperations({
        query: {
          from: "2026-08-01",
          to: "2026-08-10",
          channel: "ECOMMERCE",
          operationType: "CAPTURE",
        },
      });
      const operationDetail = yield* client.administration.getOperation({
        params: { operationId: "operation-1" },
      });
      const customers = yield* client.administration.listCustomers({
        query: { page: 3 },
      });
      const customerSearch = yield* client.administration.searchCustomers({
        query: { query: "Ada" },
      });
      const customer = yield* client.administration.getCustomer({
        params: { customerId: reservation.customerId },
      });
      const customerReservations =
        yield* client.administration.listCustomerReservations({
          params: { customerId: reservation.customerId },
          query: { page: 5 },
        });
      const discountDashboardResult =
        yield* client.administration.getDiscountDashboard({});
      const discountCodeResult = yield* client.administration.getDiscountCode({
        params: { codeId },
      });
      const sessions = yield* client.administration.listSessions({});
      return {
        bookingDetail,
        bookings,
        customerSearch,
        customer,
        customerReservations,
        customers,
        discountCodeResult,
        discountDashboardResult,
        missingBooking,
        operationDetail,
        operations,
        orderDetail,
        orders,
        overview,
        reservationDetail,
        reservationLookup,
        reservations,
        sessions,
      };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(discounts),
      Effect.provide(authentication),
      Effect.provide(administration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.overview.today.value).toBe(3);
    expect(result.reservations.page).toBe(2);
    expect(result.reservationDetail.reservation.id).toBe(reservation.id);
    expect(result.reservationLookup.reservationId).toBe(reservation.id);
    expect(result.bookings.page).toBe(4);
    expect(result.bookingDetail.booking.id).toBe(booking.id);
    expect(result.missingBooking).toBeInstanceOf(CliResourceNotFound);
    expect(result.orders.items[0]?.orderId).toBe(order.orderId);
    expect(result.orderDetail.orderId).toBe(order.orderId);
    expect(result.operations.items[0]?.operationId).toBe("operation-1");
    expect(result.operationDetail.providerStatus).toBe("available");
    expect(result.customers.page).toBe(3);
    expect(result.customerSearch.kind).toBe("not-found");
    expect(result.customer.profile).toBeNull();
    expect(result.customer.activity.stats.reservationCount).toBe(1);
    expect(result.customerReservations.page).toBe(5);
    expect(result.discountDashboardResult.codes[0]?.createdAt).toBe(
      Temporal.Instant.from(timestamp).toString()
    );
    expect(result.discountCodeResult.code.code).toBe("SUMMER10");
    expect(result.sessions[0]?.clientName).toBe(session.clientName);
    expect(reservationInputs).toEqual([{ page: 2, status: "complete" }]);
    expect(reservationLookups).toEqual(["payment-1"]);
    expect(customerSearches).toEqual([{ query: "Ada" }]);
    expect(bookingInputs).toEqual([{ date: "2026-08-10", page: 4 }]);
    expect(customerReservationInputs).toEqual([
      { customerId: reservation.customerId, page: 5 },
    ]);
    expect(orderInputs).toEqual([expect.objectContaining({ maxRecords: 50 })]);
    expect(operationInputs).toEqual([
      expect.objectContaining({
        channel: "ECOMMERCE",
        maxRecords: 100,
        operationType: "CAPTURE",
      }),
    ]);
  });

  test("invokes the same mutation services used by the Admin UI", async () => {
    const discountId = Schema.decodeUnknownSync(AdministrationStoredDiscountId)(
      "01980000-0000-7000-8000-000000000001"
    );
    const codeId = Schema.decodeUnknownSync(AdministrationDiscountCodeId)(
      "01980000-0000-7000-8000-000000000002"
    );
    const customerId = Schema.decodeUnknownSync(
      AdministrationDotyposCustomerId
    )("dotypos-customer");
    const sessionId = Schema.decodeUnknownSync(CliSessionId)(session.id);
    const requestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000003"
    );
    const code = Schema.decodeUnknownSync(AdministrationCanonicalDiscountCode)(
      "SUMMER10"
    );
    const calls: Array<readonly [string, unknown]> = [];
    const record = <A>(name: string, input: A) =>
      Effect.sync(() => {
        calls.push([name, input]);
      });
    const discountDefinition = {
      labels: { "cs-CZ": "Léto", "en-US": "Summer" },
      adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      products: [{ kind: "cowork" as const }] as const,
    };
    const codeConfiguration = {
      code,
      enabled: true,
      validFrom: null,
      validUntil: null,
      maxUses: 10,
    };
    const mutations = [
      { kind: "create-discount", discount: discountDefinition },
      {
        kind: "update-discount",
        discount: { id: discountId, ...discountDefinition },
      },
      { kind: "delete-discount", id: discountId },
      {
        kind: "create-code",
        code: codeConfiguration,
        discount: { kind: "existing", discountId },
      },
      {
        kind: "create-customer-code",
        customerId,
        code: codeConfiguration,
        discount: { kind: "existing", discountId },
      },
      {
        kind: "update-code",
        code: { id: codeId, discountId, ...codeConfiguration },
      },
      { kind: "delete-code", id: codeId },
      { kind: "add-code-customer", codeId, customerId },
      { kind: "remove-code-customer", codeId, customerId },
      { kind: "make-code-unrestricted", codeId },
      {
        kind: "set-customer-discount-group",
        customerId,
        discountGroupId: "group-1",
      },
    ] satisfies ReadonlyArray<AdministrationDiscountMutationType>;
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      createDiscount: (input) =>
        record("createDiscount", input).pipe(Effect.as(discountId)),
      updateDiscount: (input) => record("updateDiscount", input),
      deleteDiscount: (input) => record("deleteDiscount", input),
      createCode: (input) =>
        record("createCode", input).pipe(Effect.as(codeId)),
      createCustomerCode: (input) =>
        record("createCustomerCode", input).pipe(Effect.as(codeId)),
      updateCode: (input) => record("updateCode", input),
      deleteCode: (input) => record("deleteCode", input),
      addCodeCustomer: (input) => record("addCodeCustomer", input),
      removeCodeCustomer: (input) => record("removeCodeCustomer", input),
      makeCodeUnrestricted: (input) => record("makeCodeUnrestricted", input),
      setCustomerDiscountGroup: (input) =>
        record("setCustomerDiscountGroup", input),
    });
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      renameSession: (input) =>
        record("renameSession", input).pipe(Effect.as(true)),
      revoke: (sessionId) =>
        record("revokeSession", sessionId).pipe(Effect.as(true)),
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const mutationResults = yield* Effect.forEach(
        mutations,
        (mutation) =>
          client.administration.mutateDiscounts({
            payload: { requestId, mutation },
          }),
        { concurrency: 1 }
      );
      const renamed = yield* client.administration.renameSession({
        params: { sessionId },
        payload: { clientName: "Office Mac" },
      });
      const revoked = yield* client.administration.revokeSession({
        params: { sessionId },
      });
      return { mutationResults, renamed, revoked };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(discounts),
      Effect.provide(authentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.mutationResults).toHaveLength(mutations.length);
    expect(result.mutationResults[0]?.createdDiscountId).toBe(discountId);
    expect(result.mutationResults[3]?.createdCodeId).toBe(codeId);
    expect(result.renamed).toEqual({ changed: true });
    expect(result.revoked).toEqual({ changed: true });
    expect(calls.map(([name]) => name)).toEqual([
      "createDiscount",
      "updateDiscount",
      "deleteDiscount",
      "createCode",
      "createCustomerCode",
      "updateCode",
      "deleteCode",
      "addCodeCustomer",
      "removeCodeCustomer",
      "makeCodeUnrestricted",
      "setCustomerDiscountGroup",
      "renameSession",
      "revokeSession",
    ]);
  });

  test("replays completed mutations and preserves deterministic conflicts", async () => {
    const discountId = Schema.decodeUnknownSync(AdministrationStoredDiscountId)(
      "01980000-0000-7000-8000-000000000001"
    );
    const replayRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000010"
    );
    const conflictRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000011"
    );
    const pendingRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000012"
    );
    let executions = 0;
    let releases = 0;
    const mutation = { kind: "delete-discount" as const, id: discountId };
    const replayedResult = {
      kind: mutation.kind,
      createdDiscountId: null,
      createdCodeId: null,
    };
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      claim: ({ requestId }) =>
        Effect.sync(() => {
          if (requestId === replayRequestId) {
            return { kind: "completed" as const, result: replayedResult };
          }
          if (requestId === pendingRequestId) {
            return { kind: "in-progress" as const };
          }
          return { kind: "claimed" as const };
        }),
      complete: () => Effect.void,
      release: () =>
        Effect.sync(() => {
          releases += 1;
        }),
    });
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      deleteDiscount: () =>
        Effect.sync(() => {
          executions += 1;
        }).pipe(
          Effect.andThen(
            new DiscountAdminConflictError({
              message: "This discount is still referenced.",
            })
          )
        ),
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const replayed = yield* client.administration.mutateDiscounts({
        payload: { requestId: replayRequestId, mutation },
      });
      const conflict = yield* client.administration
        .mutateDiscounts({
          payload: { requestId: conflictRequestId, mutation },
        })
        .pipe(Effect.flip);
      const pending = yield* client.administration
        .mutateDiscounts({
          payload: { requestId: pendingRequestId, mutation },
        })
        .pipe(Effect.flip);
      return { conflict, pending, replayed };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(idempotency),
      Effect.provide(discounts),
      Effect.provide(UnusedCliAuthentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.replayed).toEqual(replayedResult);
    expect(result.conflict).toBeInstanceOf(CliMutationRejected);
    expect(result.pending).toBeInstanceOf(CliMutationInProgress);
    expect(executions).toBe(1);
    expect(releases).toBe(1);
  });
});
