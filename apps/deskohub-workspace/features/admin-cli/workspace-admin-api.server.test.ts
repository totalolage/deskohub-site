import { describe, expect, test } from "bun:test";
import {
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliBearerAuthentication,
  CliResourceNotFound,
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
  type DiscountAdminDashboard,
  DiscountAdministration,
} from "@/features/discounts/admin/discount-administration.service";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";
import {
  AdminCliApiHandlers,
  AdminCliReadApiHandlers,
} from "./workspace-admin-api.server";

const UnusedCliAuthentication = Layer.succeed(
  CliAuthentication,
  {} as CliAuthentication["Service"]
);
const AllowCliAuthenticationStarts = Layer.succeed(CliAuthenticationAdmission, {
  isStartAllowed: Effect.succeed(true),
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
    const discountId = "discount-1" as AdminDiscount["id"];
    const codeId = "code-1" as AdminDiscountCode["id"];
    const discount = {
      id: discountId,
      labels: { "en-US": "Summer sale", "cs-CZ": "Letní sleva" },
      adjustment: { kind: "percentage" as const, basisPoints: 1000 },
      products: [{ kind: "cowork" as const, tier: "basic" as const }],
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
      Effect.provide(AdminCliReadApiHandlers),
      Effect.provide(AuthorizedCliRequest),
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
});
