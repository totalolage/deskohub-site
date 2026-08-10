import { describe, expect, test } from "bun:test";
import {
  AdministrationCanonicalDiscountCode,
  AdministrationStoredDiscountId,
  CliAccessToken,
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliAuthenticationVerifier,
  CliGrantToken,
  CliMutationRequestId,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { DhwConfig } from "../config/dhw-config.service";
import {
  CliApiRequestError,
  WorkspaceAdminApiClient,
} from "./workspace-admin-api-client.service";

describe("WorkspaceAdminApiClient", () => {
  test("uses the shared contract and configured preview headers", async () => {
    const previewHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        previewHeaders.push(request.headers.get("x-preview-bypass"));
        return Response.json({
          apiVersion: "v1",
          service: "deskohub-workspace",
        });
      },
    });

    try {
      const config = Layer.succeed(DhwConfig, {
        baseUrl: new URL(`http://127.0.0.1:${server.port}`),
        requestHeaders: {
          "x-preview-bypass": Redacted.make("preview-secret"),
        },
        isCi: true,
        stateDirectory: "/tmp/dhw-client-test",
        updateChecksDisabled: true,
      });
      const clientLayer = WorkspaceAdminApiClient.Live.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(config)
      );
      const info = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return yield* client.getInfo;
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(info).toEqual({
        apiVersion: "v1",
        service: "deskohub-workspace",
      });
      expect(previewHeaders).toEqual(["preview-secret"]);
    } finally {
      server.stop(true);
    }
  });

  test("uses the typed authentication contract and bearer header", async () => {
    const code = Schema.decodeUnknownSync(CliAuthenticationCode)(
      "c".repeat(43)
    );
    const challenge = Schema.decodeUnknownSync(CliAuthenticationChallenge)(
      "h".repeat(43)
    );
    const verifier = Schema.decodeUnknownSync(CliAuthenticationVerifier)(
      "v".repeat(43)
    );
    const grantToken = Schema.decodeUnknownSync(CliGrantToken)("g".repeat(43));
    const accessToken = Schema.decodeUnknownSync(CliAccessToken)(
      "a".repeat(43)
    );
    const discountId = Schema.decodeUnknownSync(AdministrationStoredDiscountId)(
      "01980000-0000-7000-8000-000000000001"
    );
    const canonicalCode = Schema.decodeUnknownSync(
      AdministrationCanonicalDiscountCode
    )("SUMMER10");
    const sessionId = Schema.decodeUnknownSync(CliSessionId)(
      "01980000-0000-7000-8000-000000000000"
    );
    const mutationRequestId = Schema.decodeUnknownSync(CliMutationRequestId)(
      "01980000-0000-7000-8000-000000000003"
    );
    const expiresAt = "2026-08-10T10:00:00.000Z";
    const session = {
      id: sessionId,
      clientName: "test client",
      cliVersion: "1.0.0",
      buildTarget: "development",
      createdAt: expiresAt,
      lastUsedAt: expiresAt,
    } as const;
    const booking = {
      id: "booking-1",
      customerId: "customer-1",
      customer: {
        id: "customer-1",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        phone: null,
      },
      startsAt: expiresAt,
      endsAt: expiresAt,
      seats: "1",
      status: "CONFIRMED" as const,
      statusLabel: "Confirmed",
      tableId: "table-1",
      tableName: "Focus room",
      tableLocation: "First floor",
      linkedReservation: { id: "reservation-1", label: "Meeting room" },
      createdAt: expiresAt,
      updatedAt: expiresAt,
    };
    const reservation = {
      id: "reservation-1",
      customerId: "customer-1",
      customer: booking.customer,
      liveDetailsAvailable: true,
      startsAt: expiresAt,
      endsAt: expiresAt,
      date: null,
      type: "meeting-room" as const,
      typeLabel: "Meeting room",
      status: { group: "complete" as const, label: "Complete" },
      statusNote: null,
      createdAt: expiresAt,
      latestPayment: null,
      updatedAt: expiresAt,
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
    const requests: Array<{ readonly method: string; readonly path: string }> =
      [];
    let mutationAttempts = 0;
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        if (url.pathname.endsWith("/auth")) {
          expect(await request.json()).toEqual({
            challenge,
            clientName: "test client",
            cliVersion: "1.0.0",
            buildTarget: "development",
          });
          return Response.json(
            {
              code,
              approvalPath: `/admin/cli/authenticate?code=${code}`,
              expiresAt,
            },
            { status: 201 }
          );
        }
        if (url.pathname.endsWith("/status")) {
          expect(url.searchParams.get("code")).toBe(code);
          return Response.json({ authStatus: "pending", expiresAt });
        }
        if (url.pathname.endsWith("/grant")) {
          expect(await request.json()).toEqual({ code, grantToken, verifier });
          return Response.json({ accessToken, session }, { status: 201 });
        }
        if (url.pathname.endsWith("/session")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json(session);
        }
        if (url.pathname.endsWith("/overview")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json({
            today: { unavailable: false, value: 3 },
            upcoming: { unavailable: false, value: 8 },
            lastSevenDays: { unavailable: false, value: 5 },
          });
        }
        if (url.pathname === "/api/v1/cli/reservations") {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(url.searchParams.get("page")).toBe("2");
          expect(url.searchParams.get("status")).toBe("complete");
          return Response.json({
            items: [],
            page: 2,
            pageCount: 3,
            total: 50,
            dateFilterUnavailable: false,
            dateSortUnavailable: false,
          });
        }
        if (url.pathname.endsWith("/reservations/reservation-1")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json({
            reservation,
            booking,
            lifecycle: {
              currentStage: "complete",
              label: "Access delivered",
              reachedStages: ["started", "held", "paid", "complete"],
              tone: "positive",
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
          });
        }
        if (url.pathname.endsWith("/reservations/find")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(url.searchParams.get("identifier")).toBe("payment-1");
          return Response.json({ reservationId: reservation.id });
        }
        if (url.pathname.endsWith("/bookings/booking-1")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json({
            booking,
            references: {
              bookingId: booking.id,
              customerId: booking.customerId,
              workspaceReservationId: reservation.id,
            },
          });
        }
        if (url.pathname.endsWith("/bookings")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(url.searchParams.get("date")).toBe("2026-08-10");
          expect(url.searchParams.get("page")).toBe("2");
          return Response.json({
            items: [booking],
            page: 2,
            pageCount: 3,
            total: 50,
          });
        }
        if (url.pathname.endsWith("/orders/order-1")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json(order);
        }
        if (url.pathname.endsWith("/orders")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(url.searchParams.get("from")).toBe("2026-08-01");
          expect(url.searchParams.get("to")).toBe("2026-08-10");
          return Response.json({
            items: [order],
            providerAvailable: false,
            truncated: false,
          });
        }
        if (url.pathname.endsWith("/operations/operation-1")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json({
            operationId: "operation-1",
            operation,
            providerAvailable: true,
            providerStatus: "available",
            linkedReservationId: reservation.id,
          });
        }
        if (url.pathname.endsWith("/operations")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(url.searchParams.get("channel")).toBe("ECOMMERCE");
          expect(url.searchParams.get("operationType")).toBe("CAPTURE");
          return Response.json({
            items: [operation],
            providerAvailable: true,
            truncated: false,
          });
        }
        if (url.pathname.endsWith("/customers/search")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(url.searchParams.get("query")).toBe("Ada");
          return Response.json({ kind: "not-found", customers: [] });
        }
        if (url.pathname.endsWith("/customers/customer-1/reservations")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(url.searchParams.get("page")).toBe("2");
          return Response.json({
            items: [reservation],
            page: 2,
            pageCount: 3,
            total: 50,
          });
        }
        if (url.pathname.endsWith("/customers/customer-1")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json({
            profile: null,
            activity: {
              reservations: [reservation],
              reservationHistoryTruncated: false,
              transactions: [],
              transactionHistoryTruncated: false,
              stats: {
                reservationCount: 1,
                favoriteProduct: "Meeting room",
                revenue: [],
                discountSavings: [],
              },
              marketingConsent: null,
            },
          });
        }
        if (url.pathname.endsWith("/customers")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(url.searchParams.get("page")).toBe("3");
          return Response.json({
            items: [],
            page: 3,
            pageCount: 3,
            total: 60,
          });
        }
        if (url.pathname.endsWith("/discounts/mutations")) {
          mutationAttempts += 1;
          expect(request.method).toBe("POST");
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(await request.json()).toEqual({
            requestId: mutationRequestId,
            mutation: {
              kind: "create-code",
              code: {
                code: canonicalCode,
                enabled: true,
                validFrom: null,
                validUntil: null,
                maxUses: null,
              },
              discount: { kind: "existing", discountId },
            },
          });
          if (mutationAttempts === 1) {
            return Response.json(
              {
                _tag: "CliMutationInProgress",
                message: "The mutation is still being applied.",
                requestId: mutationRequestId,
              },
              { status: 409 }
            );
          }
          return Response.json({
            kind: "create-code",
            createdDiscountId: null,
            createdCodeId: "01980000-0000-7000-8000-000000000002",
          });
        }
        if (url.pathname.endsWith("/discounts")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json({
            discounts: [
              {
                id: "discount-1",
                labels: {
                  "en-US": "Summer sale",
                  "cs-CZ": "Letní sleva",
                },
                adjustment: { kind: "percentage", basisPoints: 1000 },
                products: [{ kind: "cowork", tier: "basic" }],
                codeCount: 1,
                createdAt: expiresAt,
                updatedAt: expiresAt,
              },
            ],
            codes: [],
            calendar: {
              events: [],
              unavailable: false,
              calendarUrl: "https://calendar.example.com",
              from: "2026-08-01",
              to: "2026-08-31",
            },
          });
        }
        if (url.pathname.endsWith("/codes/code-1")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json({
            code: {
              id: "code-1",
              discountId: "discount-1",
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
              createdAt: expiresAt,
              updatedAt: expiresAt,
            },
            discountLabel: "Summer sale",
            customers: [],
            claims: [],
          });
        }
        if (url.pathname.endsWith(`/sessions/${sessionId}`)) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          if (request.method === "PATCH") {
            expect(await request.json()).toEqual({ clientName: "Office Mac" });
          } else {
            expect(request.method).toBe("DELETE");
          }
          return Response.json({ changed: true });
        }
        if (url.pathname.endsWith("/sessions")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json([{ ...session, revokedAt: null }]);
        }
        return new Response(null, { status: 404 });
      },
    });

    try {
      const clientLayer = WorkspaceAdminApiClient.Live.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.succeed(DhwConfig, {
            baseUrl: new URL(`http://127.0.0.1:${server.port}`),
            requestHeaders: {},
            isCi: true,
            stateDirectory: "/tmp/dhw-client-auth-test",
            updateChecksDisabled: true,
          })
        )
      );

      await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        yield* client.startAuthentication({
          challenge,
          clientName: "test client",
          cliVersion: "1.0.0",
          buildTarget: "development",
        });
        yield* client.getAuthenticationStatus(code);
        yield* client.exchangeGrant({ code, grantToken, verifier });
        yield* client.getCurrentSession(Redacted.make(accessToken));
        yield* client.getOverview(Redacted.make(accessToken));
        yield* client.listReservations(Redacted.make(accessToken), {
          page: 2,
          status: "complete",
        });
        yield* client.getReservation(
          Redacted.make(accessToken),
          reservation.id
        );
        yield* client.findReservation(Redacted.make(accessToken), "payment-1");
        yield* client.listBookings(Redacted.make(accessToken), {
          date: "2026-08-10",
          page: 2,
        });
        yield* client.getBooking(Redacted.make(accessToken), booking.id);
        yield* client.listOrders(Redacted.make(accessToken), {
          from: "2026-08-01",
          to: "2026-08-10",
        });
        yield* client.getOrder(Redacted.make(accessToken), order.orderId);
        yield* client.listOperations(Redacted.make(accessToken), {
          channel: "ECOMMERCE",
          operationType: "CAPTURE",
        });
        yield* client.getOperation(
          Redacted.make(accessToken),
          operation.operationId
        );
        yield* client.listCustomers(Redacted.make(accessToken), { page: 3 });
        yield* client.searchCustomers(Redacted.make(accessToken), {
          query: "Ada",
        });
        yield* client.getCustomer(
          Redacted.make(accessToken),
          reservation.customerId
        );
        yield* client.listCustomerReservations(
          Redacted.make(accessToken),
          reservation.customerId,
          { page: 2 }
        );
        yield* client.getDiscountDashboard(Redacted.make(accessToken));
        yield* client.getDiscountCode(Redacted.make(accessToken), "code-1");
        yield* client.listSessions(Redacted.make(accessToken));
        yield* client.mutateDiscounts(
          Redacted.make(accessToken),
          mutationRequestId,
          {
            kind: "create-code",
            code: {
              code: canonicalCode,
              enabled: true,
              validFrom: null,
              validUntil: null,
              maxUses: null,
            },
            discount: { kind: "existing", discountId },
          }
        );
        yield* client.renameSession(Redacted.make(accessToken), sessionId, {
          clientName: "Office Mac",
        });
        yield* client.revokeSession(Redacted.make(accessToken), sessionId);
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(requests).toEqual([
        { method: "POST", path: "/api/v1/cli/auth" },
        { method: "GET", path: "/api/v1/cli/status" },
        { method: "POST", path: "/api/v1/cli/grant" },
        { method: "GET", path: "/api/v1/cli/session" },
        { method: "GET", path: "/api/v1/cli/overview" },
        { method: "GET", path: "/api/v1/cli/reservations" },
        {
          method: "GET",
          path: "/api/v1/cli/reservations/reservation-1",
        },
        { method: "GET", path: "/api/v1/cli/reservations/find" },
        { method: "GET", path: "/api/v1/cli/bookings" },
        { method: "GET", path: "/api/v1/cli/bookings/booking-1" },
        { method: "GET", path: "/api/v1/cli/orders" },
        { method: "GET", path: "/api/v1/cli/orders/order-1" },
        { method: "GET", path: "/api/v1/cli/operations" },
        { method: "GET", path: "/api/v1/cli/operations/operation-1" },
        { method: "GET", path: "/api/v1/cli/customers" },
        { method: "GET", path: "/api/v1/cli/customers/search" },
        { method: "GET", path: "/api/v1/cli/customers/customer-1" },
        {
          method: "GET",
          path: "/api/v1/cli/customers/customer-1/reservations",
        },
        { method: "GET", path: "/api/v1/cli/discounts" },
        { method: "GET", path: "/api/v1/cli/codes/code-1" },
        { method: "GET", path: "/api/v1/cli/sessions" },
        { method: "POST", path: "/api/v1/cli/discounts/mutations" },
        { method: "POST", path: "/api/v1/cli/discounts/mutations" },
        {
          method: "PATCH",
          path: `/api/v1/cli/sessions/${sessionId}`,
        },
        {
          method: "DELETE",
          path: `/api/v1/cli/sessions/${sessionId}`,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("sanitizes transport errors that could contain authentication secrets", async () => {
    const code = Schema.decodeUnknownSync(CliAuthenticationCode)(
      "s".repeat(43)
    );
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 500 }),
    });

    try {
      const clientLayer = WorkspaceAdminApiClient.Live.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.succeed(DhwConfig, {
            baseUrl: new URL(`http://127.0.0.1:${server.port}`),
            requestHeaders: {},
            isCi: true,
            stateDirectory: "/tmp/dhw-client-error-test",
            updateChecksDisabled: true,
          })
        )
      );
      const error = await WorkspaceAdminApiClient.pipe(
        Effect.flatMap((client) => client.getAuthenticationStatus(code)),
        Effect.flip,
        Effect.provide(clientLayer),
        Effect.runPromise
      );

      expect(error).toBeInstanceOf(CliApiRequestError);
      expect(JSON.stringify(error)).not.toContain(code);
    } finally {
      server.stop(true);
    }
  });
});
