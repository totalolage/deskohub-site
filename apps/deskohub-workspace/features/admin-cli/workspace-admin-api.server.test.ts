import { describe, expect, test } from "bun:test";
import {
  AdministrationActorUsername,
  AdministrationCanonicalPromotionCode,
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
  CliServiceUnavailable,
  CliSessionId,
  CurrentCliSession,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Result, Schema } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import {
  InvoiceAdministrationInProgressError,
  InvoiceAdministrationService,
} from "@/features/accounting/admin/invoice-administration.service";
import { AdministrationService } from "@/features/administration/administration.service";
import { OrderAdministrationService } from "@/features/administration/order-administration.service";
import {
  ReservationAccessAdministration,
  ReservationAccessAdministrationError,
} from "@/features/administration/reservation-access-administration.service";
import { ReservationAdministrationService } from "@/features/administration/reservation-administration.service";
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
const UnusedAdministrationService = Layer.succeed(
  AdministrationService,
  {} as AdministrationService["Service"]
);
const UnusedReservationAdministration = Layer.succeed(
  ReservationAdministrationService,
  {} as ReservationAdministrationService["Service"]
);
const UnusedOrderAdministration = Layer.succeed(
  OrderAdministrationService,
  {} as OrderAdministrationService["Service"]
);
const AllowCliAuthenticationStarts = Layer.succeed(CliAuthenticationAdmission, {
  isStartAllowed: Effect.succeed(true),
});
const ClaimEveryCliMutation = Layer.succeed(CliMutationIdempotency, {
  claim: () => Effect.succeed({ kind: "claimed" as const }),
  complete: () => Effect.void,
  reclaimStale: () => Effect.succeed(false),
  release: () => Effect.void,
});
const UnusedReservationAccessAdministration = Layer.succeed(
  ReservationAccessAdministration,
  {} as ReservationAccessAdministration["Service"]
);
const UnusedDiscountAdministration = Layer.succeed(
  DiscountAdministration,
  {} as DiscountAdministration["Service"]
);
const UnusedInvoiceAdministration = Layer.succeed(
  InvoiceAdministrationService,
  {} as InvoiceAdministrationService["Service"]
);
const session = {
  id: "01980000-0000-7000-8000-000000000000",
  approvedBy: null,
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
const ActorAuthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: (httpEffect) =>
    Effect.provideService(httpEffect, CurrentCliSession, {
      ...session,
      approvedBy: AdministrationActorUsername.make("admin"),
    }),
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

  test("maps an in-progress invoice claim for retry without changing provenance", async () => {
    const creations: unknown[] = [];
    const invoiceAdministration = Layer.succeed(InvoiceAdministrationService, {
      ...({} as InvoiceAdministrationService["Service"]),
      create: (input, provenance) => {
        creations.push({ input, provenance });
        return creations.length === 1
          ? Effect.fail(
              new InvoiceAdministrationInProgressError({
                invoiceId: input.invoiceId,
                message: "The invoice is still being created.",
              })
            )
          : Effect.succeed({
              invoiceId: input.invoiceId,
              invoiceNumber: "WS-FV-2026-000001",
              changed: true,
              needsAttention: false,
            });
      },
    });
    const payload = {
      invoiceId: "01980000-0000-7000-8000-000000000009",
      customer: {
        kind: "new" as const,
        details: {
          kind: "person" as const,
          email: "synthetic@example.test",
          firstName: "Synthetic",
          lastName: "Customer",
          address: {
            line1: "Test street 1",
            city: "Prague",
            postalCode: "100 00",
            country: "CZ",
          },
        },
      },
      locale: "cs-CZ" as const,
      serviceDate: "2026-08-10",
      payment: { status: "due" as const, date: "2026-08-24" },
      currency: "CZK",
      lines: [{ description: "Space rental", price: "1000" }],
    };

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const pending = yield* client.administration
        .createInvoice({ payload })
        .pipe(Effect.flip);
      const created = yield* client.administration.createInvoice({ payload });
      return { created, pending };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(ActorAuthorizedCliRequest),
      Effect.provide(invoiceAdministration),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(UnusedAdministrationService),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedOrderAdministration),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedCliAuthentication),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.pending).toBeInstanceOf(CliMutationInProgress);
    expect(result.pending.requestId).toBe(payload.invoiceId);
    expect(result.created.invoiceId).toBe(payload.invoiceId);
    expect(creations).toEqual([
      { input: payload, provenance: { source: "dhw-cli", actor: "admin" } },
      { input: payload, provenance: { source: "dhw-cli", actor: "admin" } },
    ]);
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

  test("serves provider-agnostic domain order reads", async () => {
    const timestamp = "2026-08-16T12:00:00Z";
    const detail = {
      order: {
        id: "order-1",
        kind: "goods" as const,
        customerId: "customer-1",
        paymentState: "pending" as const,
        fulfillmentState: "fulfilled" as const,
        total: { value: 5000, exponent: 2, currency: "CZK" },
        invoiceStatus: "not_issued" as const,
        reservationId: null,
        paidAt: null,
        fulfilledAt: timestamp,
        fulfillmentFailedAt: null,
        writtenOffAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      lines: [],
      paymentAttempts: [],
      invoice: { status: "not_issued" as const, issuedAt: null },
    };
    const orderAdministration = Layer.succeed(OrderAdministrationService, {
      listOrders: () =>
        Effect.succeed({ items: [detail.order], truncated: false } as never),
      loadOrder: (id) =>
        Effect.succeed(id === detail.order.id ? (detail as never) : null),
      writeOffOrder: (id) =>
        Effect.succeed({
          orderId: id,
          writtenOffAt: "2026-08-16T13:00:00Z",
        }),
    });

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const orders = yield* client.administration.listDomainOrders({});
      const order = yield* client.administration.getDomainOrder({
        params: { orderId: "order-1" },
      });
      const writeOff = yield* client.administration.writeOffDomainOrder({
        params: { orderId: "order-1" },
      });
      const missing = yield* client.administration
        .getDomainOrder({ params: { orderId: "missing" } })
        .pipe(Effect.flip);
      return { missing, order, orders, writeOff };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(ClaimEveryCliMutation),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedCliAuthentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(orderAdministration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.orders.items[0]?.id).toBe("order-1");
    expect(result.order.paymentAttempts).toEqual([]);
    expect(result.writeOff.writtenOffAt).toBe("2026-08-16T13:00:00Z");
    expect(result.missing).toBeInstanceOf(CliResourceNotFound);
  });

  test("invokes the same administration service used by the UI", async () => {
    const bookingInputs: unknown[] = [];
    const customerReservationInputs: unknown[] = [];
    const customerSearches: unknown[] = [];
    const operationInputs: unknown[] = [];
    const orderInputs: unknown[] = [];
    const reservationInputs: unknown[] = [];
    const reservationCancellations: unknown[] = [];
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
      maxUsesPerCustomer: null,
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
      vouchers: [],
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
          today: { completed: 2, unavailable: false, value: 3 },
          upcoming: { completed: 7, unavailable: false, value: 8 },
          lastSevenDays: { completed: 4, unavailable: false, value: 5 },
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
                canCancel: true,
                requiresProviderCredentialRemoval: false,
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
                accessGrant: null,
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
      listNexiOrders: (input) =>
        Effect.sync(() => {
          orderInputs.push(input);
          return {
            items: [order],
            providerAvailable: false,
            truncated: false,
          };
        }),
      loadNexiOrder: () => Effect.succeed(order),
      listNexiOperations: (input) =>
        Effect.sync(() => {
          operationInputs.push(input);
          return {
            items: [operation],
            providerAvailable: true,
            truncated: false,
          };
        }),
      loadNexiOperation: (operationId) =>
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
    const reservationAdministration = Layer.succeed(
      ReservationAdministrationService,
      {
        cancel: (input) =>
          Effect.sync(() => {
            reservationCancellations.push(input);
            return { outcome: "cancelled", email: "sent" } as const;
          }),
      }
    );

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
      const cancellation = yield* client.administration.cancelReservation({
        params: { reservationId: reservation.id },
        payload: {
          accessGrantUpdatedAt: "2026-08-10T10:00:00.000Z",
          providerCredentialRemoved: true,
          sendCancellationEmail: true,
        },
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
      const orders = yield* client.administration.listNexiOrders({
        query: { from: "2026-08-01", to: "2026-08-10" },
      });
      const orderDetail = yield* client.administration.getNexiOrder({
        params: { orderId: order.orderId },
      });
      const operations = yield* client.administration.listNexiOperations({
        query: {
          from: "2026-08-01",
          to: "2026-08-10",
          channel: "ECOMMERCE",
          operationType: "CAPTURE",
        },
      });
      const operationDetail = yield* client.administration.getNexiOperation({
        params: { operationId: "operation-1" },
      });
      const legacyOrders = yield* client.administration.listLegacyNexiOrders({
        query: { from: "2026-08-01", to: "2026-08-10" },
      });
      const legacyOrderDetail = yield* client.administration.getLegacyNexiOrder(
        {
          params: { orderId: order.orderId },
        }
      );
      const legacyOperations =
        yield* client.administration.listLegacyNexiOperations({
          query: {
            from: "2026-08-01",
            to: "2026-08-10",
            channel: "ECOMMERCE",
            operationType: "CAPTURE",
          },
        });
      const legacyOperationDetail =
        yield* client.administration.getLegacyNexiOperation({
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
        cancellation,
        customerSearch,
        customer,
        customerReservations,
        customers,
        discountCodeResult,
        discountDashboardResult,
        legacyOperationDetail,
        legacyOperations,
        legacyOrderDetail,
        legacyOrders,
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
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(reservationAdministration),
      Effect.provide(discounts),
      Effect.provide(authentication),
      Effect.provide(administration),
      Effect.provide(UnusedOrderAdministration),
      Effect.provide(UnusedReservationAccessAdministration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.overview.today).toEqual({
      completed: 2,
      unavailable: false,
      value: 3,
    });
    expect(result.reservations.page).toBe(2);
    expect(result.reservationDetail.reservation.id).toBe(reservation.id);
    expect(result.cancellation).toEqual({
      outcome: "cancelled",
      email: "sent",
    });
    expect(reservationCancellations).toEqual([
      {
        accessGrantUpdatedAt: "2026-08-10T10:00:00.000Z",
        providerCredentialRemoved: true,
        reservationId: reservation.id,
        sendCancellationEmail: true,
      },
    ]);
    expect(result.reservationLookup.reservationId).toBe(reservation.id);
    expect(result.bookings.page).toBe(4);
    expect(result.bookingDetail.booking.id).toBe(booking.id);
    expect(result.missingBooking).toBeInstanceOf(CliResourceNotFound);
    expect(result.orders.items[0]?.orderId).toBe(order.orderId);
    expect(result.orderDetail.orderId).toBe(order.orderId);
    expect(result.operations.items[0]?.operationId).toBe("operation-1");
    expect(result.operationDetail.providerStatus).toBe("available");
    expect(result.legacyOrders).toEqual(result.orders);
    expect(result.legacyOrderDetail).toEqual(result.orderDetail);
    expect(result.legacyOperations).toEqual(result.operations);
    expect(result.legacyOperationDetail).toEqual(result.operationDetail);
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
    expect(orderInputs).toEqual([
      expect.objectContaining({ maxRecords: 50 }),
      expect.objectContaining({ maxRecords: 50 }),
    ]);
    expect(operationInputs).toEqual([
      expect.objectContaining({
        channel: "ECOMMERCE",
        maxRecords: 100,
        operationType: "CAPTURE",
      }),
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
    const code = Schema.decodeUnknownSync(AdministrationCanonicalPromotionCode)(
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
      maxUsesPerCustomer: 2,
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
        code: {
          id: codeId,
          discountId,
          ...codeConfiguration,
        },
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
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedOrderAdministration),
      Effect.provide(discounts),
      Effect.provide(authentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAccessAdministration),
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

  test("returns safe access metadata and maps invalid recovery", async () => {
    const instant = Temporal.Instant.from("2026-08-10T10:00:00Z");
    const requestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000020"
    );
    const rejectedRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000021"
    );
    const retryableRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000022"
    );
    const staleRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000023"
    );
    const currentRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000024"
    );
    const grant = {
      id: "access-1" as ReservationAccessGrant["id"],
      reservationId: "reservation-1",
      provider: "igloohome",
      credentialType: "algopin-hourly",
      deviceId: "EK1X16f8898a",
      state: "issued" as const,
      providerCredentialId: "pin-1",
      scheduledAccessStartsAt: instant,
      accessStartsAt: instant,
      accessEndsAt: instant,
      provisioningStartedAt: instant,
      issuedAt: instant,
      failedAt: null,
      failureCode: null,
      createdAt: instant,
      updatedAt: instant,
    } satisfies ReservationAccessGrant;
    let executions = 0;
    let retryableExecutions = 0;
    let staleExecutions = 0;
    const reservationAccess = Layer.succeed(ReservationAccessAdministration, {
      resumeInterruptedMutation: () =>
        Effect.sync(() => {
          staleExecutions += 1;
          return grant;
        }),
      mutate: (mutation) => {
        if (mutation.reservationId === "transient-reservation") {
          retryableExecutions += 1;
          return retryableExecutions === 1
            ? Effect.fail(
                new ReservationAccessAdministrationError({
                  reason: "retryable_failure",
                  message: "Dotypos is temporarily unavailable.",
                })
              )
            : Effect.succeed(grant);
        }
        return mutation.kind === "retry-failed"
          ? Effect.sync(() => {
              executions += 1;
              return grant;
            })
          : Effect.fail(
              new ReservationAccessAdministrationError({
                reason: "invalid_state",
                message: "Only uncertain access can be reconciled.",
              })
            );
      },
    });
    const completed = new Map<string, unknown>();
    const claims = new Set<string>();
    const idempotency = Layer.succeed(CliMutationIdempotency, {
      claim: ({ requestId: claimedRequestId }) =>
        Effect.sync(() => {
          if (
            claimedRequestId === staleRequestId ||
            claimedRequestId === currentRequestId
          ) {
            return { kind: "in-progress" as const };
          }
          if (completed.has(claimedRequestId)) {
            return {
              kind: "completed" as const,
              result: completed.get(claimedRequestId) as never,
            };
          }
          if (claims.has(claimedRequestId)) {
            return { kind: "in-progress" as const };
          }
          claims.add(claimedRequestId);
          return { kind: "claimed" as const };
        }),
      complete: ({ requestId: completedRequestId, result }) =>
        Effect.sync(() => {
          completed.set(completedRequestId, result);
        }),
      reclaimStale: ({ requestId: reclaimedRequestId }) =>
        Effect.succeed(reclaimedRequestId === staleRequestId),
      release: ({ requestId: releasedRequestId }) =>
        Effect.sync(() => {
          claims.delete(releasedRequestId);
        }),
    });
    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const recovered = yield* client.administration.mutateReservationAccess({
        params: { reservationId: grant.reservationId },
        payload: { requestId, mutation: { kind: "retry-failed" } },
      });
      const replayed = yield* client.administration.mutateReservationAccess({
        params: { reservationId: grant.reservationId },
        payload: { requestId, mutation: { kind: "retry-failed" } },
      });
      const rejected = yield* client.administration
        .mutateReservationAccess({
          params: { reservationId: grant.reservationId },
          payload: {
            requestId: rejectedRequestId,
            mutation: {
              kind: "confirm-provider-credential-removed",
              providerCredentialRemoved: true,
            },
          },
        })
        .pipe(Effect.flip);
      const retryable = yield* client.administration
        .mutateReservationAccess({
          params: { reservationId: "transient-reservation" },
          payload: {
            requestId: retryableRequestId,
            mutation: { kind: "retry-failed" },
          },
        })
        .pipe(Effect.flip);
      const retried = yield* client.administration.mutateReservationAccess({
        params: { reservationId: "transient-reservation" },
        payload: {
          requestId: retryableRequestId,
          mutation: { kind: "retry-failed" },
        },
      });
      const reclaimed = yield* client.administration.mutateReservationAccess({
        params: { reservationId: "stale-reservation" },
        payload: {
          requestId: staleRequestId,
          mutation: { kind: "retry-failed" },
        },
      });
      const current = yield* client.administration
        .mutateReservationAccess({
          params: { reservationId: "current-reservation" },
          payload: {
            requestId: currentRequestId,
            mutation: { kind: "retry-failed" },
          },
        })
        .pipe(Effect.flip);
      return {
        current,
        reclaimed,
        recovered,
        rejected,
        replayed,
        retried,
        retryable,
      };
    }).pipe(
      Effect.provide(AdminCliAdministrationApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(idempotency),
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedOrderAdministration),
      Effect.provide(UnusedDiscountAdministration),
      Effect.provide(UnusedCliAuthentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(reservationAccess),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.recovered.state).toBe("issued");
    expect(result.replayed).toEqual(result.recovered);
    expect(executions).toBe(1);
    expect("accessCode" in result.recovered).toBe(false);
    expect(result.rejected).toBeInstanceOf(CliMutationRejected);
    expect(result.retryable).toBeInstanceOf(CliServiceUnavailable);
    expect(result.retried.state).toBe("issued");
    expect(retryableExecutions).toBe(2);
    expect(result.reclaimed.state).toBe("issued");
    expect(staleExecutions).toBe(1);
    expect(result.current).toBeInstanceOf(CliMutationInProgress);
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
      createdVoucherId: null,
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
      reclaimStale: () => Effect.succeed(false),
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
      Effect.provide(UnusedInvoiceAdministration),
      Effect.provide(UnusedReservationAdministration),
      Effect.provide(UnusedOrderAdministration),
      Effect.provide(discounts),
      Effect.provide(UnusedCliAuthentication),
      Effect.provide(
        Layer.succeed(
          AdministrationService,
          {} as AdministrationService["Service"]
        )
      ),
      Effect.provide(UnusedReservationAccessAdministration),
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
