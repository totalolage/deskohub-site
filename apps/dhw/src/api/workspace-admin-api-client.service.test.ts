import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationAccountEmail,
  AdministrationAccountId,
  AdministrationBookingSummary,
  AdministrationCampaignId,
  AdministrationCampaignSettings,
  AdministrationCanonicalPromotionCode,
  AdministrationCustomerReservationActivity,
  AdministrationDiscountCodeId,
  AdministrationDiscountGroupList,
  AdministrationDotyposCustomerId,
  AdministrationInvoiceCreateInput,
  AdministrationInvoiceCreationDefaults,
  AdministrationInvoiceId,
  AdministrationNexiOperationId,
  AdministrationOperation,
  AdministrationOrder,
  AdministrationReservationActivity,
  AdministrationReservationSummary,
  AdministrationStandaloneAccessCodeAttemptId,
  AdministrationStandaloneAccessCodeCreateInput,
  AdministrationStandaloneAccessCodeName,
  AdministrationStoredDiscountId,
  AutomationFlow,
  AutomationPreviewId,
  AutomationRunId,
  CliAccessToken,
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliAuthenticationVerifier,
  CliGrantToken,
  CliInputInvalid,
  CliMutationRejected,
  CliMutationRequestId,
  CliMutationUncertain,
  CliResourceNotFound,
  CliSessionId,
  CliStandaloneAccessCodeCleanupRequired,
  CliStandaloneAccessCodeReconciled,
  dhwVersionHeader,
} from "@deskohub/workspace-admin-api";
import { Clock, Duration, Effect, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { DHW_VERSION } from "../build-info";
import { DhwConfig } from "../config/dhw-config.service";
import {
  CliApiRequestError,
  WorkspaceAdminApiClient,
} from "./workspace-admin-api-client.service";

const syntheticEmail = testEmailAddress("synthetic");

const runClientTest = async <A, E>(
  fetch: (request: Request) => Response | Promise<Response>,
  run: (client: WorkspaceAdminApiClient["Service"]) => Effect.Effect<A, E>
) => {
  const server = Bun.serve({ port: 0, fetch });
  try {
    const clientLayer = WorkspaceAdminApiClient.Default.pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(
        Layer.succeed(DhwConfig, {
          baseUrl: new URL(`http://127.0.0.1:${server.port}`),
          requestHeaders: {},
          isCi: true,
          stateDirectory: `/tmp/dhw-client-test-${crypto.randomUUID()}`,
          updateChecksDisabled: true,
        })
      )
    );
    return await Effect.gen(function* () {
      const client = yield* WorkspaceAdminApiClient;
      return yield* run(client);
    }).pipe(Effect.provide(clientLayer), Effect.runPromise);
  } finally {
    server.stop(true);
  }
};

const accessCodeAttemptId = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeAttemptId
)("01980000-0000-7000-8000-000000000042");
const cleanupTargetAttemptId = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeAttemptId
)("01980000-0000-7000-8000-000000000043");
const cleanupTargetName = Schema.decodeUnknownSync(
  AdministrationStandaloneAccessCodeName
)("Booth A");
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
  test("lists invoices an administrator issued through an AI assistant", async () => {
    const accessToken = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
    );
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          items: [
            {
              id: "01980000-0000-7000-8000-000000000009",
              invoiceNumber: "WS-FV-2026-000020",
              issuedAt: "2026-10-22T08:00:00Z",
              customerId: null,
              customerName: "Synthetic Customer",
              reservationId: null,
              total: "1000",
              currency: "CZK",
              paymentStatus: "due",
              source: "assistant",
              actor: syntheticEmail,
              delivery: { customer: "accepted", internal: "accepted" },
              needsAttention: false,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
          pageCount: 1,
        }),
    });

    try {
      const page = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return yield* client.listInvoices(accessToken, {});
      }).pipe(
        Effect.provide(
          WorkspaceAdminApiClient.Default.pipe(
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(
              Layer.succeed(DhwConfig, {
                baseUrl: new URL(`http://127.0.0.1:${server.port}`),
                requestHeaders: {},
                isCi: true,
                stateDirectory: "/tmp/dhw-assistant-invoice-list-test",
                updateChecksDisabled: true,
              })
            )
          )
        ),
        Effect.runPromise
      );

      expect(page.items.map((invoice) => invoice.source)).toEqual([
        "assistant",
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
          email: syntheticEmail,
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

  test("uses the typed authentication contract, the bearer header, and the version header on every request", async () => {
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
      expiresAt: null,
    } as const;
    const booking = Schema.decodeUnknownSync(AdministrationBookingSummary)({
      id: "booking-1",
      customerId: "customer-1",
      customer: {
        id: "customer-1",
        displayName: "Ada Lovelace",
        email: testEmailAddress("ada"),
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
    const clientVersions: Array<string | null> = [];
    let accessMutationAttempts = 0;
    let mutationAttempts = 0;
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        requests.push({ method: request.method, path: url.pathname });
        clientVersions.push(request.headers.get(dhwVersionHeader));
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
        if (url.pathname.endsWith("/reservations/reservation-1/cancellation")) {
          expect(request.headers.get("authorization")).toBe(
            `Bearer ${accessToken}`
          );
          expect(await request.json()).toEqual({
            accessGrantUpdatedAt: null,
            providerCredentialRemoved: false,
            sendCancellationEmail: true,
          });
          return Response.json({ outcome: "cancelled", email: "sent" });
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
        const overview = yield* client.getOverview(Redacted.make(accessToken));
        expect(overview.refundAttention.unavailable).toBe(true);
        expect(overview.uniqueCustomers.customers).toEqual([]);
        expect(overview.newCustomers.customers).toEqual([]);
        yield* client.listReservations(Redacted.make(accessToken), {
          page: 2,
          status: "complete",
        });
        const reservationDetail = yield* client.getReservation(
          Redacted.make(accessToken),
          reservation.id
        );
        expect(reservationDetail.reservation.purpose).toBe("business");
        // A server that predates reservation authors omits the author.
        expect(reservationDetail.author).toBeNull();
        yield* client.mutateReservationAccess(
          Redacted.make(accessToken),
          mutationRequestId,
          reservation.id,
          { kind: "retry-failed" }
        );
        expect(
          yield* client.cancelReservation(
            Redacted.make(accessToken),
            reservation.id,
            {
              accessGrantUpdatedAt: null,
              providerCredentialRemoved: false,
              sendCancellationEmail: true,
            }
          )
        ).toEqual({ outcome: "cancelled", email: "sent" });
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

      expect(clientVersions).toEqual(requests.map(() => DHW_VERSION));
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
        {
          method: "POST",
          path: "/api/v1/cli/reservations/reservation-1/cancellation",
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

  test("gets a customer's reservation activity", async () => {
    const token = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
    );
    const activity = Schema.decodeUnknownSync(
      AdministrationCustomerReservationActivity
    )({
      from: "2026-08-01",
      to: "2026-08-02",
      dates: [{ date: "2026-08-01", count: 2, category: "meeting-room" }],
    });

    const result = await runClientTest(
      async (request) => {
        const url = new URL(request.url);
        expect(request.method).toBe("GET");
        expect(url.pathname).toBe(
          "/api/v1/cli/customers/customer-1/reservation-activity"
        );
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${Redacted.value(token)}`
        );
        return Response.json(activity);
      },
      (client) =>
        client.getCustomerReservationActivity(
          token,
          Schema.decodeUnknownSync(AdministrationDotyposCustomerId)(
            "customer-1"
          )
        )
    );

    expect(result).toEqual(activity);
  });

  test("gets reservation activity", async () => {
    const token = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
    );
    const activity = Schema.decodeUnknownSync(
      AdministrationReservationActivity
    )({
      from: "2026-08-01",
      to: "2026-08-02",
      dates: [{ date: "2026-08-01", count: 2 }],
    });

    const result = await runClientTest(
      async (request) => {
        const url = new URL(request.url);
        expect(request.method).toBe("GET");
        expect(url.pathname).toBe("/api/v1/cli/overview/reservation-activity");
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${Redacted.value(token)}`
        );
        return Response.json(activity);
      },
      (client) => client.getReservationActivity(token)
    );

    expect(result).toEqual(activity);
  });

  test("lists discount groups", async () => {
    const token = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
    );
    const discountGroups = Schema.decodeUnknownSync(
      AdministrationDiscountGroupList
    )({ discountGroups: [{ id: "group-1", name: "Community" }] });

    const result = await runClientTest(
      async (request) => {
        const url = new URL(request.url);
        expect(request.method).toBe("GET");
        expect(url.pathname).toBe("/api/v1/cli/discount-groups");
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${Redacted.value(token)}`
        );
        return Response.json(discountGroups);
      },
      (client) => client.listDiscountGroups(token)
    );

    expect(result).toEqual(discountGroups);
  });

  test("gets invoice creation defaults", async () => {
    const token = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
    );
    const defaults = Schema.decodeUnknownSync(
      AdministrationInvoiceCreationDefaults
    )({
      currencies: [{ code: "CZK", exponent: 2, name: "Czech koruna" }],
      defaultCurrency: "CZK",
      defaultServiceDate: "2026-08-10",
      defaultDueDate: "2026-08-24",
      suggestedVariableSymbol: "260810",
    });

    const result = await runClientTest(
      async (request) => {
        const url = new URL(request.url);
        expect(request.method).toBe("GET");
        expect(url.pathname).toBe("/api/v1/cli/invoices/creation-defaults");
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${Redacted.value(token)}`
        );
        return Response.json(defaults);
      },
      (client) => client.getInvoiceCreationDefaults(token)
    );

    expect(result).toEqual(defaults);
  });

  test("previews invoices and preserves mutation rejection errors", async () => {
    const token = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
    );
    const input = Schema.decodeUnknownSync(AdministrationInvoiceCreateInput)({
      invoiceId: "01980000-0000-7000-8000-000000000019",
      customer: {
        kind: "new",
        details: {
          kind: "person",
          email: syntheticEmail,
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
      locale: "cs-CZ",
      serviceDate: "2026-08-10",
      payment: { status: "due", date: "2026-08-24" },
      currency: "CZK",
      lines: [{ description: "Synthetic service", price: "1000" }],
    });
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const requests: Array<{
      readonly method: string;
      readonly path: string;
      readonly body: unknown;
    }> = [];
    let attempt = 0;

    const result = await runClientTest(
      async (request) => {
        const url = new URL(request.url);
        requests.push({
          method: request.method,
          path: url.pathname,
          body: await request.json(),
        });
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${Redacted.value(token)}`
        );
        attempt += 1;
        if (attempt === 1) {
          return new Response(Buffer.from(pdf), {
            headers: { "content-type": "application/pdf" },
          });
        }
        return Response.json(
          {
            _tag: "CliMutationRejected",
            message: "The invoice preview input was rejected.",
          },
          { status: 409 }
        );
      },
      (client) =>
        Effect.gen(function* () {
          const preview = yield* client.previewInvoice(token, input);
          const rejected = yield* client
            .previewInvoice(token, input)
            .pipe(Effect.flip);
          return { preview, rejected };
        })
    );

    expect(result.preview).toEqual(pdf);
    expect(result.rejected).toBeInstanceOf(CliMutationRejected);
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/api/v1/cli/invoices/preview",
        body: input,
      },
      {
        method: "POST",
        path: "/api/v1/cli/invoices/preview",
        body: input,
      },
    ]);
  });

  test("gets campaign settings", async () => {
    const token = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43))
    );
    const settings = Schema.decodeUnknownSync(AdministrationCampaignSettings)({
      testSendInbox: testEmailAddress("campaign-test-inbox"),
    });

    const result = await runClientTest(
      async (request) => {
        const url = new URL(request.url);
        expect(request.method).toBe("GET");
        expect(url.pathname).toBe("/api/v1/cli/campaigns/settings");
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${Redacted.value(token)}`
        );
        return Response.json(settings);
      },
      (client) => client.getCampaignSettings(token)
    );

    expect(result).toEqual(settings);
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
          accessCodeInput
        );
        const uncertain = yield* client
          .createStandaloneAccessCode(
            accessToken,
            accessCodeAttemptId,
            accessCodeInput
          )
          .pipe(Effect.flip);
        const rejected = yield* client
          .createStandaloneAccessCode(
            accessToken,
            accessCodeAttemptId,
            accessCodeInput,
            cleanupTargetAttemptId
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
      expect(cleanupTargetAttemptId).not.toBe(accessCodeAttemptId);
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
            providerCredentialRemovedAttemptId: cleanupTargetAttemptId,
          },
        },
      ]);
      expect(
        requests.some(({ payload }) =>
          Object.hasOwn(payload as object, "providerCredentialRemoved")
        )
      ).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("decodes the cleanup-required target and forwards the exact attempt id", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        payloads.push(await request.json());
        return Response.json(
          {
            _tag: "CliStandaloneAccessCodeCleanupRequired",
            message:
              "A previous ambiguous attempt still occupies this window. Remove the possible credential at the lock or verify it is absent, then confirm the cleanup.",
            cleanupTarget: {
              attemptId: cleanupTargetAttemptId,
              name: "Booth A",
            },
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
            stateDirectory: "/tmp/dhw-cleanup-client-test",
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
            cleanupTargetAttemptId
          )
        ),
        Effect.flip,
        Effect.provide(clientLayer),
        Effect.runPromise
      );

      expect(error instanceof CliStandaloneAccessCodeCleanupRequired).toBe(
        true
      );
      if (!(error instanceof CliStandaloneAccessCodeCleanupRequired)) return;
      expect(error.cleanupTarget.attemptId).toBe(cleanupTargetAttemptId);
      expect(error.cleanupTarget.name).toBe(cleanupTargetName);
      expect(payloads).toHaveLength(1);
      expect(payloads[0]?.attemptId).toBe(accessCodeAttemptId);
      expect(payloads[0]?.providerCredentialRemovedAttemptId).toBe(
        cleanupTargetAttemptId
      );
      expect("providerCredentialRemoved" in (payloads[0] ?? {})).toBe(false);
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
            cleanupTargetAttemptId
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
          providerCredentialRemovedAttemptId: cleanupTargetAttemptId,
        },
      });
    } finally {
      server.stop(true);
    }
  });
});

describe("WorkspaceAdminApiClient administrators", () => {
  test("lists, grants, and revokes administrators, keeping the server's refusals", async () => {
    const accessToken = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("d".repeat(43))
    );
    const accountId = AdministrationAccountId.make("account-target");
    const email = Schema.decodeUnknownSync(AdministrationAccountEmail)(
      testEmailAddress("administrator-target")
    );
    const listed = {
      administrators: [
        {
          accountId,
          email,
          grantedByEmail: null,
          grantedAt: "2026-10-01T08:00:00Z",
        },
      ],
    };
    const requests: Array<{
      readonly method: string;
      readonly path: string;
      readonly authorization: string | null;
      readonly body: unknown;
    }> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        requests.push({
          method: request.method,
          path,
          authorization: request.headers.get("authorization"),
          body: request.method === "POST" ? await request.json() : null,
        });
        if (request.method === "GET") return Response.json(listed);
        if (request.method === "POST") {
          return Response.json(
            {
              _tag: "CliResourceNotFound",
              message: "No active account signs in with this email.",
            },
            { status: 404 }
          );
        }
        if (requests.filter(({ method }) => method === "DELETE").length > 1) {
          return new Response("internal details", { status: 500 });
        }
        return Response.json(
          {
            _tag: "CliMutationRejected",
            message: "Administrators can't revoke their own grant.",
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
            stateDirectory: "/tmp/dhw-administrators-client-test",
            updateChecksDisabled: true,
          })
        )
      );
      const results = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return {
          list: yield* client.listAdministrators(accessToken),
          grant: yield* client
            .grantAdministrator(accessToken, { email })
            .pipe(Effect.flip),
          rejected: yield* client
            .revokeAdministrator(accessToken, accountId)
            .pipe(Effect.flip),
          failed: yield* client
            .revokeAdministrator(accessToken, accountId)
            .pipe(Effect.flip),
        };
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(results.list).toEqual(listed);
      expect(results.grant).toBeInstanceOf(CliResourceNotFound);
      expect(results.grant.message).toBe(
        "No active account signs in with this email."
      );
      expect(results.rejected).toBeInstanceOf(CliMutationRejected);
      expect(results.rejected.message).toBe(
        "Administrators can't revoke their own grant."
      );
      expect(results.failed).toBeInstanceOf(CliApiRequestError);
      expect(results.failed.message).not.toContain("internal details");
      const authorization = `Bearer ${"d".repeat(43)}`;
      expect(requests).toEqual([
        {
          method: "GET",
          path: "/api/v1/cli/administrators",
          authorization,
          body: null,
        },
        {
          method: "POST",
          path: "/api/v1/cli/administrators",
          authorization,
          body: { email },
        },
        {
          method: "DELETE",
          path: `/api/v1/cli/administrators/${accountId}`,
          authorization,
          body: null,
        },
        {
          method: "DELETE",
          path: `/api/v1/cli/administrators/${accountId}`,
          authorization,
          body: null,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });
});

describe("WorkspaceAdminApiClient campaigns", () => {
  test("keeps the server's input and state messages and hides other failures", async () => {
    const accessToken = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("c".repeat(43))
    );
    const campaignId = Schema.decodeUnknownSync(AdministrationCampaignId)(
      "campaign-1"
    );
    const requestId = CliMutationRequestId.make(
      "01990000-0000-7000-8000-000000000010"
    );
    const requests: Array<{ readonly path: string; readonly body: unknown }> =
      [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        requests.push({
          path,
          body: request.method === "GET" ? null : await request.json(),
        });
        if (path === "/api/v1/cli/campaigns" && request.method === "POST") {
          return Response.json(
            {
              _tag: "CliInputInvalid",
              message: "Line 3: a button needs a label.",
            },
            { status: 400 }
          );
        }
        if (path === `/api/v1/cli/campaigns/${campaignId}/send`) {
          return Response.json(
            {
              _tag: "CliMutationRejected",
              message: "The confirmation code is wrong or expired.",
            },
            { status: 409 }
          );
        }
        return new Response("internal details", { status: 500 });
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
            stateDirectory: "/tmp/dhw-campaign-client-test",
            updateChecksDisabled: true,
          })
        )
      );
      const errors = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return [
          yield* client
            .createCampaign(accessToken, requestId, {
              title: "Autumn news",
              purpose: "marketing",
              templateKey: "workspace",
              audienceId: null,
              content: {
                "cs-CZ": {
                  subject: "Novinky",
                  preheader: "",
                  bodyMarkdown: "[[button: ](https://example.com)]",
                },
              },
            })
            .pipe(Effect.flip),
          yield* client
            .sendCampaign(accessToken, campaignId, {
              confirmationCode: "ABC123",
            })
            .pipe(Effect.flip),
          yield* client.listCampaigns(accessToken).pipe(Effect.flip),
        ];
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(errors[0]).toBeInstanceOf(CliInputInvalid);
      expect(errors[0]?.message).toBe("Line 3: a button needs a label.");
      expect(errors[1]).toBeInstanceOf(CliMutationRejected);
      expect(errors[1]?.message).toBe(
        "The confirmation code is wrong or expired."
      );
      expect(errors[2]).toBeInstanceOf(CliApiRequestError);
      expect(errors[2]?.message).not.toContain("internal details");
      expect(requests[1]).toEqual({
        path: `/api/v1/cli/campaigns/${campaignId}/send`,
        body: { confirmationCode: "ABC123" },
      });
    } finally {
      server.stop(true);
    }
  });

  test("resends a creation under the same request ID until the server answers", async () => {
    const accessToken = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("c".repeat(43))
    );
    const campaignId = Schema.decodeUnknownSync(AdministrationCampaignId)(
      "campaign-1"
    );
    const requestId = CliMutationRequestId.make(
      "01990000-0000-7000-8000-000000000011"
    );
    const detail = {
      id: "campaign-2",
      title: "Autumn news",
      purpose: "operational",
      templateKey: "workspace",
      status: "draft",
      audienceId: null,
      locales: [],
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
      content: {},
    };
    const requests: Array<{ readonly path: string; readonly body: unknown }> =
      [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        requests.push({ path, body: await request.json() });
        if (path.endsWith("/duplicate")) {
          // The first attempt is still being applied; the retry replays it.
          return requests.length === 1
            ? Response.json(
                {
                  _tag: "CliMutationInProgress",
                  message: "This mutation is still being applied.",
                  requestId,
                },
                { status: 409 }
              )
            : Response.json(detail);
        }
        return Response.json({ sendId: "send-1", retriedCount: 2 });
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
            stateDirectory: "/tmp/dhw-campaign-client-test",
            updateChecksDisabled: true,
          })
        )
      );
      const [duplicated, retried] = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return [
          yield* client.duplicateCampaign(accessToken, requestId, campaignId),
          yield* client.retryCampaign(accessToken, campaignId, {
            includeUnconfirmed: true,
          }),
        ] as const;
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(String(duplicated.id)).toBe(detail.id);
      expect(retried.retriedCount).toBe(2);
      expect(requests).toEqual([
        {
          path: `/api/v1/cli/campaigns/${campaignId}/duplicate`,
          body: { requestId },
        },
        {
          path: `/api/v1/cli/campaigns/${campaignId}/duplicate`,
          body: { requestId },
        },
        {
          path: `/api/v1/cli/campaigns/${campaignId}/retry`,
          body: { includeUnconfirmed: true },
        },
      ]);
    } finally {
      server.stop(true);
    }
  });
});

describe("WorkspaceAdminApiClient automations", () => {
  test("calls every automation endpoint with the version header and keeps the server's refusal code", async () => {
    const accessToken = Redacted.make(
      Schema.decodeUnknownSync(CliAccessToken)("d".repeat(43))
    );
    const campaignId = Schema.decodeUnknownSync(AdministrationCampaignId)(
      "campaign-1"
    );
    const previewId = AutomationPreviewId.make("preview-1");
    const flow = Schema.decodeUnknownSync(AutomationFlow)({
      trigger: { _tag: "Schedule", calendar: { minutes: [0, 30] } },
      steps: [{ _tag: "Send", id: "send" }],
    });
    const requests: Array<{
      readonly method: string;
      readonly path: string;
      readonly query: string;
      readonly body: unknown;
    }> = [];
    const clientVersions: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        const text = await request.text();
        requests.push({
          method: request.method,
          path: url.pathname,
          query: url.search,
          body: text === "" ? null : JSON.parse(text),
        });
        clientVersions.push(request.headers.get(dhwVersionHeader));
        return Response.json(
          {
            _tag: "CliMutationRejected",
            message: "Run a dry run of the current draft first.",
            code: "automation-preview-required",
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
            stateDirectory: "/tmp/dhw-automation-client-test",
            updateChecksDisabled: true,
          })
        )
      );
      const errors = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return yield* Effect.forEach(
          [
            client.getAutomation(accessToken, campaignId),
            client.updateAutomationFlow(accessToken, { campaignId, flow }),
            client.dryRunAutomation(accessToken, campaignId),
            client.getAutomationDryRun(accessToken, {
              previewId,
              cursor: "page-2",
              limit: 50,
            }),
            client.activateAutomation(accessToken, { campaignId, previewId }),
            client.pauseAutomation(accessToken, campaignId),
            client.resumeAutomation(accessToken, campaignId),
            client.archiveAutomation(accessToken, campaignId),
            client.listAutomationVersions(accessToken, campaignId),
            client.getAutomationVersion(accessToken, {
              campaignId,
              versionNumber: 2,
            }),
            client.getAutomationRunStats(accessToken, {
              campaignId,
              versionNumber: 2,
            }),
            client.listAutomationRuns(accessToken, {
              campaignId,
              state: "ended",
              outcome: "sent",
            }),
            client.getAutomationRun(accessToken, {
              runId: AutomationRunId.make("run-1"),
            }),
            client.previewCalendarExpression(accessToken, {
              expression: { hours: [9] },
              usage: "wait",
              locale: "en-US",
            }),
            client.getAutomationEngineHealth(accessToken),
          ],
          (request) => Effect.flip(request as Effect.Effect<unknown, unknown>)
        );
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      for (const error of errors) {
        expect(error).toBeInstanceOf(CliMutationRejected);
        expect(error).toMatchObject({
          message: "Run a dry run of the current draft first.",
          code: "automation-preview-required",
        });
      }
      expect(clientVersions).toEqual(requests.map(() => DHW_VERSION));
      const automation = "/api/v1/cli/automations/campaign-1";
      expect(requests).toEqual([
        { method: "GET", path: `${automation}/flow`, query: "", body: null },
        {
          method: "PUT",
          path: `${automation}/flow`,
          query: "",
          body: {
            flow: {
              trigger: { _tag: "Schedule", calendar: { minutes: [0, 30] } },
              steps: [{ _tag: "Send", id: "send" }],
            },
          },
        },
        {
          method: "POST",
          path: `${automation}/dry-run`,
          query: "",
          body: null,
        },
        {
          method: "GET",
          path: "/api/v1/cli/automation-dry-runs/preview-1",
          query: "?cursor=page-2&limit=50",
          body: null,
        },
        {
          method: "POST",
          path: `${automation}/activate`,
          query: "",
          body: { previewId: "preview-1" },
        },
        { method: "POST", path: `${automation}/pause`, query: "", body: null },
        { method: "POST", path: `${automation}/resume`, query: "", body: null },
        {
          method: "POST",
          path: `${automation}/archive`,
          query: "",
          body: null,
        },
        {
          method: "GET",
          path: `${automation}/versions`,
          query: "",
          body: null,
        },
        {
          method: "GET",
          path: `${automation}/versions/2`,
          query: "",
          body: null,
        },
        {
          method: "GET",
          path: `${automation}/runs/stats`,
          query: "?versionNumber=2",
          body: null,
        },
        {
          method: "GET",
          path: `${automation}/runs`,
          query: "?state=ended&outcome=sent",
          body: null,
        },
        {
          method: "GET",
          path: "/api/v1/cli/automation-runs/run-1",
          query: "",
          body: null,
        },
        {
          method: "POST",
          path: "/api/v1/cli/calendar-expressions/preview",
          query: "",
          body: {
            expression: { hours: [9] },
            usage: "wait",
            locale: "en-US",
          },
        },
        {
          method: "GET",
          path: "/api/v1/cli/automations/engine-health",
          query: "",
          body: null,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });
});
