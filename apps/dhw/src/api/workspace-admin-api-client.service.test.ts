import { describe, expect, test } from "bun:test";
import {
  AdministrationBookingSummary,
  AdministrationCanonicalPromotionCode,
  AdministrationDiscountCodeId,
  AdministrationInvoiceId,
  AdministrationNexiOperationId,
  AdministrationOperation,
  AdministrationOrder,
  AdministrationReservationSummary,
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeCreateInput,
  AdministrationStoredDiscountId,
  CliAccessToken,
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliAuthenticationVerifier,
  CliGrantToken,
  CliMutationRejected,
  CliMutationRequestId,
  CliMutationUncertain,
  CliSessionId,
  CliStandaloneAccessCodeReconciled,
} from "@deskohub/workspace-admin-api";
import { Clock, Duration, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { DhwConfig } from "../config/dhw-config.service";
import {
  CliApiRequestError,
  WorkspaceAdminApiClient,
} from "./workspace-admin-api-client.service";

const accessCodeAttemptId = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeAttemptId
)("01980000-0000-7000-8000-000000000042");
const accessCodeInput = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeCreateInput
)({
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
});
const createdAccessCodeOutcome = {
  outcome: "created",
  attemptId: accessCodeAttemptId,
  providerCredentialId: "pin-1",
  name: "Booth A",
  startsAt: "2026-09-10T10:00",
  endsAt: "2026-09-10T12:00",
  issuedAt: "2026-09-10T08:00:00Z",
  pin: "7654321",
};

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
      const clientLayer = WorkspaceAdminApiClient.Default.pipe(
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

  test("uses the typed invoice endpoints without changing the creation id", async () => {
    const accessToken = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("i".repeat(43))
    );
    const invoiceId = Schema.decodeUnknownSync(AdministrationInvoiceId)(
      "01980000-0000-7000-8000-000000000009"
    );
    const requests: Array<{ method: string; path: string }> = [];
    const createdPayloads: unknown[] = [];
    const item = {
      id: invoiceId,
      invoiceNumber: "WS-FV-2026-000001",
      issuedAt: "2026-08-10T10:00:00.000Z",
      customerId: "customer-1",
      customerName: "Synthetic Customer",
      reservationId: "reservation-1",
      total: "1000",
      currency: "CZK",
      paymentStatus: "paid",
      source: "dhw-cli" as const,
      actor: "admin",
      delivery: {
        customer: "accepted" as const,
        internal: "accepted" as const,
      },
      needsAttention: false,
    };
    const input = {
      invoiceId,
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
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${Redacted.value(accessToken)}`
        );
        if (url.pathname.endsWith(`/${invoiceId}/pdf`)) {
          return new Response(Uint8Array.from([37, 80, 68, 70]), {
            headers: { "content-type": "application/pdf" },
          });
        }
        if (url.pathname.endsWith(`/${invoiceId}/resend`)) {
          return Response.json({
            invoiceId,
            changed: true,
            needsAttention: false,
          });
        }
        if (url.pathname.endsWith(`/${invoiceId}`)) {
          return Response.json({
            ...item,
            locale: "cs-CZ",
            serviceDate: "2026-08-10",
            dueDate: "2026-08-24",
            paidOn: null,
            variableSymbol: "2026000001",
            lines: input.lines,
            buyer: {
              kind: "person",
              legalName: "Synthetic Customer",
              address: input.customer.details.address,
            },
            pdfUrl: `/admin/invoices/${invoiceId}/pdf`,
          });
        }
        if (request.method === "POST") {
          createdPayloads.push(await request.json());
          if (createdPayloads.length === 1) {
            return Response.json(
              {
                _tag: "CliMutationInProgress",
                message: "The invoice is still being created.",
                requestId: invoiceId,
              },
              { status: 409 }
            );
          }
          return Response.json(
            {
              invoiceId,
              invoiceNumber: item.invoiceNumber,
              changed: true,
              needsAttention: false,
            },
            { status: 201 }
          );
        }
        return Response.json({
          items: [item],
          total: 1,
          page: 1,
          pageSize: 24,
          pageCount: 1,
        });
      },
    });

    try {
      const clientLayer = WorkspaceAdminApiClient.Default.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.succeed(DhwConfig, {
            baseUrl: new URL(`http://127.0.0.1:${server.port}`),
            requestHeaders: {},
            isCi: true,
            stateDirectory: "/tmp/dhw-invoice-client-test",
            updateChecksDisabled: true,
          })
        )
      );
      const results = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return yield* Effect.all([
          client.listInvoices(accessToken, { page: 1 }),
          client.getInvoice(accessToken, invoiceId),
          client.getInvoicePdf(accessToken, invoiceId),
          client.createInvoice(accessToken, input),
          client.resendInvoice(accessToken, invoiceId),
        ]);
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(results[0].items).toHaveLength(1);
      expect(results[0].items[0]).toMatchObject({
        customerId: "customer-1",
        reservationId: "reservation-1",
      });
      expect(results[1].id).toBe(invoiceId);
      expect([...results[2]]).toEqual([37, 80, 68, 70]);
      expect(results[3].invoiceId).toBe(invoiceId);
      expect(results[4].changed).toBe(true);
      expect(createdPayloads).toEqual([input, input]);
      expect(requests).toEqual([
        { method: "GET", path: "/api/v1/cli/invoices" },
        { method: "GET", path: `/api/v1/cli/invoices/${invoiceId}` },
        { method: "GET", path: `/api/v1/cli/invoices/${invoiceId}/pdf` },
        { method: "POST", path: "/api/v1/cli/invoices" },
        { method: "POST", path: "/api/v1/cli/invoices" },
        { method: "POST", path: `/api/v1/cli/invoices/${invoiceId}/resend` },
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("retries invoice creation through the one-minute claim recovery window", async () => {
    const accessToken = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("i".repeat(43))
    );
    const invoiceId = Schema.decodeUnknownSync(AdministrationInvoiceId)(
      "01980000-0000-7000-8000-000000000019"
    );
    const input = {
      invoiceId,
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
    const payloads: unknown[] = [];
    let elapsedRetryMilliseconds = 0;
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        payloads.push(await request.json());
        if (payloads.length <= 240) {
          return Response.json(
            {
              _tag: "CliMutationInProgress",
              message: "The invoice is still being created.",
              requestId: invoiceId,
            },
            { status: 409 }
          );
        }
        return Response.json(
          {
            invoiceId,
            invoiceNumber: "WS-FV-2026-000019",
            changed: true,
            needsAttention: false,
          },
          { status: 201 }
        );
      },
    });

    try {
      const clientLayer = WorkspaceAdminApiClient.Default.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.succeed(DhwConfig, {
            baseUrl: new URL(`http://127.0.0.1:${server.port}`),
            requestHeaders: {},
            isCi: true,
            stateDirectory: "/tmp/dhw-invoice-recovery-client-test",
            updateChecksDisabled: true,
          })
        )
      );
      const result = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return yield* client.createInvoice(accessToken, input);
      }).pipe(
        Effect.provide(clientLayer),
        Effect.provideService(Clock.Clock, {
          currentTimeMillisUnsafe: () => elapsedRetryMilliseconds,
          currentTimeMillis: Effect.sync(() => elapsedRetryMilliseconds),
          currentTimeNanosUnsafe: () =>
            BigInt(elapsedRetryMilliseconds) * 1_000_000n,
          currentTimeNanos: Effect.sync(
            () => BigInt(elapsedRetryMilliseconds) * 1_000_000n
          ),
          sleep: (duration) =>
            Effect.sync(() => {
              elapsedRetryMilliseconds += Duration.toMillis(duration);
            }),
        }),
        Effect.runPromise
      );

      expect(result.invoiceId).toBe(invoiceId);
      expect(elapsedRetryMilliseconds).toBeGreaterThanOrEqual(60_000);
      expect(payloads).toHaveLength(241);
      expect(payloads.every((payload) => Bun.deepEquals(payload, input))).toBe(
        true
      );
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
      AdministrationCanonicalPromotionCode
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
      approvedBy: null,
      clientName: "test client",
      cliVersion: "1.0.0",
      buildTarget: "development",
      createdAt: expiresAt,
      lastUsedAt: expiresAt,
    } as const;
    const booking = Schema.decodeUnknownSync(AdministrationBookingSummary)({
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
    });
    const reservation = Schema.decodeUnknownSync(
      AdministrationReservationSummary
    )({
      id: "reservation-1",
      customerId: "customer-1",
      customer: booking.customer,
      liveDetailsAvailable: true,
      startsAt: expiresAt,
      endsAt: expiresAt,
      date: null,
      type: "meeting-room" as const,
      typeLabel: "Meeting room",
      purpose: "business" as const,
      status: { group: "complete" as const, label: "Complete" },
      statusNote: null,
      createdAt: expiresAt,
      latestPayment: null,
      updatedAt: expiresAt,
    });
    const order = Schema.decodeUnknownSync(AdministrationOrder)({
      orderId: "order-1",
      provider: null,
      providerAvailable: false,
      providerStatus: "unavailable" as const,
      link: null,
    });
    const operationId = Schema.decodeUnknownSync(AdministrationNexiOperationId)(
      "operation-1"
    );
    const operation = Schema.decodeUnknownSync(AdministrationOperation)({
      operationId,
      operationType: "CAPTURE",
      operationResult: "AUTHORIZED",
      linkedReservationId: reservation.id,
    });
    const requests: Array<{ readonly method: string; readonly path: string }> =
      [];
    let accessMutationAttempts = 0;
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
            today: { completed: 2, unavailable: false, value: 3 },
            upcoming: { completed: 7, unavailable: false, value: 8 },
            lastSevenDays: { completed: 4, unavailable: false, value: 5 },
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
            canCancel: true,
            requiresProviderCredentialRemoval: false,
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
            accessGrant: null,
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
        if (url.pathname.endsWith("/reservations/reservation-1/access")) {
          accessMutationAttempts += 1;
          expect(request.method).toBe("POST");
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(await request.json()).toEqual({
            requestId: mutationRequestId,
            mutation: { kind: "retry-failed" },
          });
          if (accessMutationAttempts === 1) {
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
            id: "access-1",
            state: "issued",
            provider: "igloohome",
            credentialType: "algopin-hourly",
            deviceId: "EK1X16f8898a",
            providerCredentialId: "pin-1",
            accessName: "Deskohub reservation-1",
            scheduledStartsAt: expiresAt,
            startsAt: expiresAt,
            endsAt: expiresAt,
            provisioningStartedAt: expiresAt,
            issuedAt: expiresAt,
            failedAt: null,
            failureCode: null,
            createdAt: expiresAt,
            updatedAt: expiresAt,
          });
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
                maxUsesPerCustomer: null,
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
            createdVoucherId: null,
          });
        }
        if (url.pathname.endsWith("/discounts")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          return Response.json({
            discounts: [
              {
                id: discountId,
                labels: {
                  "en-US": "Summer sale",
                  "cs-CZ": "Letní sleva",
                },
                adjustment: { kind: "percentage", basisPoints: 1000 },
                products: [{ kind: "office" }],
                codeCount: 1,
                createdAt: expiresAt,
                updatedAt: expiresAt,
              },
            ],
            codes: [],
            vouchers: [],
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
      const clientLayer = WorkspaceAdminApiClient.Default.pipe(
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
        const reservationDetail = yield* client.getReservation(
          Redacted.make(accessToken),
          reservation.id
        );
        expect(reservationDetail.reservation.purpose).toBe("business");
        yield* client.mutateReservationAccess(
          Redacted.make(accessToken),
          mutationRequestId,
          reservation.id,
          { kind: "retry-failed" }
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
        yield* client.getOperation(Redacted.make(accessToken), operationId);
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
        yield* client.getDiscountCode(
          Redacted.make(accessToken),
          AdministrationDiscountCodeId.make("code-1")
        );
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
              maxUsesPerCustomer: null,
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
        {
          method: "POST",
          path: "/api/v1/cli/reservations/reservation-1/access",
        },
        {
          method: "POST",
          path: "/api/v1/cli/reservations/reservation-1/access",
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

  test("retries access-code creation with one captured attempt id and never on terminal outcomes", async () => {
    const accessToken = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("i".repeat(43))
    );
    const requests: Array<{
      readonly method: string;
      readonly path: string;
      readonly payload: unknown;
    }> = [];
    let retryableAttempts = 0;
    let terminalAttempts = 0;
    let elapsedRetryMilliseconds = 0;
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        requests.push({
          method: request.method,
          path: url.pathname,
          payload: await request.json(),
        });
        if (
          request.headers.get("authorization") !==
          `Bearer ${Redacted.value(accessToken)}`
        ) {
          return new Response(null, { status: 401 });
        }
        if (requests.length === 1) {
          return Response.json(
            {
              _tag: "CliMutationInProgress",
              message: "The access-code creation is still being applied.",
              requestId: accessCodeAttemptId,
            },
            { status: 409 }
          );
        }
        if (requests.length === 2) {
          retryableAttempts += 1;
          return Response.json(
            {
              _tag: "CliServiceUnavailable",
              message: "The administration API is temporarily unavailable.",
            },
            { status: 503 }
          );
        }
        if (requests.length === 3) {
          return Response.json(createdAccessCodeOutcome);
        }
        terminalAttempts += 1;
        if (terminalAttempts === 1) {
          return Response.json(
            {
              _tag: "CliMutationUncertain",
              message: "The access-code creation outcome is uncertain.",
            },
            { status: 409 }
          );
        }
        return Response.json(
          {
            _tag: "CliMutationRejected",
            message: "The standalone access-code request was rejected.",
          },
          { status: 409 }
        );
      },
    });

    try {
      const clientLayer = WorkspaceAdminApiClient.Default.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.succeed(DhwConfig, {
            baseUrl: new URL(`http://127.0.0.1:${server.port}`),
            requestHeaders: {},
            isCi: true,
            stateDirectory: "/tmp/dhw-access-code-client-test",
            updateChecksDisabled: true,
          })
        )
      );
      const [created, uncertain, rejected] = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        const created = yield* client.createStandaloneAccessCode(
          accessToken,
          accessCodeAttemptId,
          accessCodeInput,
          false
        );
        const uncertain = yield* client
          .createStandaloneAccessCode(
            accessToken,
            accessCodeAttemptId,
            accessCodeInput,
            false
          )
          .pipe(Effect.flip);
        const rejected = yield* client
          .createStandaloneAccessCode(
            accessToken,
            accessCodeAttemptId,
            accessCodeInput,
            true
          )
          .pipe(Effect.flip);
        return [created, uncertain, rejected] as const;
      }).pipe(
        Effect.provide(clientLayer),
        Effect.provideService(Clock.Clock, {
          currentTimeMillisUnsafe: () => elapsedRetryMilliseconds,
          currentTimeMillis: Effect.sync(() => elapsedRetryMilliseconds),
          currentTimeNanosUnsafe: () =>
            BigInt(elapsedRetryMilliseconds) * 1_000_000n,
          currentTimeNanos: Effect.sync(
            () => BigInt(elapsedRetryMilliseconds) * 1_000_000n
          ),
          sleep: (duration) =>
            Effect.sync(() => {
              elapsedRetryMilliseconds += Duration.toMillis(duration);
            }),
        }),
        Effect.runPromise
      );

      expect(created).toMatchObject({ outcome: "created", pin: "7654321" });
      expect(uncertain).toBeInstanceOf(CliMutationUncertain);
      expect(rejected).toBeInstanceOf(CliMutationRejected);
      expect(retryableAttempts).toBe(1);
      expect(elapsedRetryMilliseconds).toBeGreaterThanOrEqual(500);
      expect(requests).toHaveLength(5);
      expect(
        requests.map(({ method, path, payload }) => ({ method, path, payload }))
      ).toEqual([
        {
          method: "POST",
          path: "/api/v1/cli/access-codes",
          payload: { attemptId: accessCodeAttemptId, input: accessCodeInput },
        },
        {
          method: "POST",
          path: "/api/v1/cli/access-codes",
          payload: { attemptId: accessCodeAttemptId, input: accessCodeInput },
        },
        {
          method: "POST",
          path: "/api/v1/cli/access-codes",
          payload: { attemptId: accessCodeAttemptId, input: accessCodeInput },
        },
        {
          method: "POST",
          path: "/api/v1/cli/access-codes",
          payload: { attemptId: accessCodeAttemptId, input: accessCodeInput },
        },
        {
          method: "POST",
          path: "/api/v1/cli/access-codes",
          payload: {
            attemptId: accessCodeAttemptId,
            input: accessCodeInput,
            providerCredentialRemoved: true,
          },
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
      const clientLayer = WorkspaceAdminApiClient.Default.pipe(
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

  test("passes a confirmed reconciled replay through as a typed error", async () => {
    const requests: Array<unknown> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        requests.push({
          payload: await request.json(),
          authorization: request.headers.get("authorization"),
        });
        return Response.json(
          {
            _tag: "CliStandaloneAccessCodeReconciled",
            message:
              "Your confirmed cleanup was recorded for the earlier ambiguous attempt, which created no access code. Run the same command again to create the code.",
          },
          { status: 409 }
        );
      },
    });

    try {
      const accessToken = Redacted.make(
        Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
      );
      const clientLayer = WorkspaceAdminApiClient.Default.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(
          Layer.succeed(DhwConfig, {
            baseUrl: new URL(`http://127.0.0.1:${server.port}`),
            requestHeaders: {},
            isCi: true,
            stateDirectory: "/tmp/dhw-reconciled-client-test",
            updateChecksDisabled: true,
          })
        )
      );
      const error = await WorkspaceAdminApiClient.pipe(
        Effect.flatMap((client) =>
          client.createStandaloneAccessCode(
            accessToken,
            accessCodeAttemptId,
            accessCodeInput,
            true
          )
        ),
        Effect.flip,
        Effect.provide(clientLayer),
        Effect.runPromise
      );

      expect(error).toBeInstanceOf(CliStandaloneAccessCodeReconciled);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        payload: {
          attemptId: accessCodeAttemptId,
          input: accessCodeInput,
          providerCredentialRemoved: true,
        },
      });
    } finally {
      server.stop(true);
    }
  });
});
