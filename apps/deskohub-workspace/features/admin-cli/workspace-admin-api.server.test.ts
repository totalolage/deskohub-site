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
import { DiscountAdministration } from "@/features/discounts/admin/discount-administration.service";
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
    const reservationInputs: unknown[] = [];
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
      findReservationId: () => Effect.die("not used"),
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
      listOrders: () => Effect.die("not used"),
      loadOrder: () => Effect.die("not used"),
      listOperations: () => Effect.die("not used"),
      loadOperation: () => Effect.die("not used"),
    } satisfies AdministrationService["Service"]);
    const discounts = Layer.succeed(DiscountAdministration, {
      ...({} as DiscountAdministration["Service"]),
      searchCustomers: (input) =>
        Effect.sync(() => {
          customerSearches.push(input);
          return { kind: "not-found" as const, customers: [] };
        }),
      loadCustomerProfile: () => Effect.fail(new Error("unavailable")),
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
      const bookings = yield* client.administration.listBookings({
        query: { date: "2026-08-10", page: 4 },
      });
      const bookingDetail = yield* client.administration.getBooking({
        params: { bookingId: booking.id },
      });
      const missingBooking = yield* client.administration
        .getBooking({ params: { bookingId: "missing" } })
        .pipe(Effect.flip);
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
      return {
        bookingDetail,
        bookings,
        customerSearch,
        customer,
        customerReservations,
        customers,
        missingBooking,
        overview,
        reservationDetail,
        reservations,
      };
    }).pipe(
      Effect.provide(AdminCliReadApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(discounts),
      Effect.provide(administration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.overview.today.value).toBe(3);
    expect(result.reservations.page).toBe(2);
    expect(result.reservationDetail.reservation.id).toBe(reservation.id);
    expect(result.bookings.page).toBe(4);
    expect(result.bookingDetail.booking.id).toBe(booking.id);
    expect(result.missingBooking).toBeInstanceOf(CliResourceNotFound);
    expect(result.customers.page).toBe(3);
    expect(result.customerSearch.kind).toBe("not-found");
    expect(result.customer.profile).toBeNull();
    expect(result.customer.activity.stats.reservationCount).toBe(1);
    expect(result.customerReservations.page).toBe(5);
    expect(reservationInputs).toEqual([{ page: 2, status: "complete" }]);
    expect(customerSearches).toEqual([{ query: "Ada" }]);
    expect(bookingInputs).toEqual([{ date: "2026-08-10", page: 4 }]);
    expect(customerReservationInputs).toEqual([
      { customerId: reservation.customerId, page: 5 },
    ]);
  });
});
