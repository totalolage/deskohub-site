import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type {
  CustomerReservationHistory,
  CustomerReservationSummary,
} from "@/features/account";
import {
  testCustomerSession,
  testLinkedAccount,
} from "@/features/account/backend/account-operations.test-utils";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { CustomerReservationHistoryService } from "@/features/account/backend/customer-reservation-history.service";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import type { InvoicePdfFile } from "@/features/accounting/backend/invoice-pdf";
import { InvoicePdfRenderingError } from "@/features/accounting/backend/invoice-pdf";
import {
  ReservationInvoiceNotFoundError,
  ReservationInvoiceNotIssuedError,
  ReservationInvoicePdfService,
} from "@/features/accounting/backend/reservation-invoice-pdf.service";
import {
  CheckoutStatusService,
  type CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout/checkout-status.service";
import {
  ReservationAccessService,
  type ReservationAccessViewModel,
} from "@/features/reservation/backend/reservation-access.service";
import {
  type ReservationAuthorizationInput,
  ReservationAuthorizationService,
  ReservationAuthorizationUnavailableError,
} from "@/features/reservation/backend/reservation-authorization.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  type CustomerApiCall,
  customerApiRequest,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
} from "./customer-api.test-utils";
import type { CustomerReservationServiceLayers } from "./customer-reservation-layers";

const orderId = workspaceReservationIdSchema.make(
  "019edbcf-5026-7ecc-821b-eda46998eaaa"
);

/**
 * Authorization that lets the session's own account see `orderId`, read
 * through the authentication the handler hands it.
 */
const ownOrderAuthorization = (
  authorized: boolean
): CustomerReservationServiceLayers["authorization"] => {
  return (authentication) =>
    Layer.effect(
      ReservationAuthorizationService,
      Effect.map(CustomerAuthentication, (session) => {
        const isAuthorized = (input: ReservationAuthorizationInput) =>
          session.currentUser.pipe(
            Effect.map(
              (user) =>
                authorized &&
                input.orderId === orderId &&
                user?.accountId === testCustomerSession.accountId
            ),
            Effect.orElseSucceed(() => false)
          );
        return { isAuthorized, authorize: isAuthorized };
      })
    ).pipe(Layer.provide(authentication));
};

describe("listReservations", () => {
  const listReservations: CustomerApiCall = {
    method: "GET",
    path: "/reservations",
  };

  const ownReservation: CustomerReservationSummary = {
    id: orderId,
    workspaceReservationId: orderId,
    product: { kind: "cowork", tier: "open-space" },
    startsAt: "2099-07-01T06:00:00Z",
    endsAt: "2099-07-01T22:00:00Z",
    seats: 1,
    status: "confirmed",
  };
  const bookedForOther: CustomerReservationSummary = {
    id: "dotypos-2",
    party: { kind: "booked-for", customerName: "Grace Hopper" },
    product: { kind: "meeting-room" },
    startsAt: "2020-07-02T08:00:00Z",
    endsAt: "2020-07-02T10:00:00Z",
    setupStartsAt: "2020-07-02T07:45:00Z",
    seats: null,
    status: "cancelled",
  };
  const undated: CustomerReservationSummary = {
    id: "dotypos-3",
    reviewSandbox: true,
    product: { kind: "other" },
    startsAt: null,
    endsAt: null,
    seats: null,
    status: "requires-attention",
  };

  const historyServices = (
    options: {
      readonly linked?: boolean;
      readonly history?: Effect.Effect<
        CustomerReservationHistory,
        CustomerAccountAccessError
      >;
      readonly linkRead?: Effect.Effect<never, CustomerAccountAccessError>;
    } = {}
  ) => {
    const load = mock(
      () =>
        options.history ??
        Effect.succeed<CustomerReservationHistory>({
          kind: "available",
          groups: {
            current: [ownReservation],
            past: [bookedForOther],
            unavailable: [undated],
          },
        })
    );
    const reservations: Partial<CustomerReservationServiceLayers> = {
      contacts: () =>
        Layer.mock(CustomerAccountContactService, {
          currentLinkedAccount:
            options.linkRead ??
            Effect.succeed(
              options.linked === false
                ? null
                : { ...testLinkedAccount, email: testCustomerSession.email }
            ),
        }),
      history: Layer.mock(CustomerReservationHistoryService, { load }),
    };
    return { load, reservations };
  };

  testCustomerEndpointGuards(listReservations);

  test("lists the linked account's history as the account page groups it", async () => {
    const { load, reservations } = historyServices();
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      current: [
        {
          id: orderId,
          orderId,
          product: { kind: "cowork", tier: "open-space" },
          startsAt: "2099-07-01T06:00:00Z",
          endsAt: "2099-07-01T22:00:00Z",
          seats: 1,
          status: "confirmed",
        },
      ],
      past: [
        {
          id: "dotypos-2",
          party: { kind: "booked-for", customerName: "Grace Hopper" },
          product: { kind: "meeting-room" },
          startsAt: "2020-07-02T08:00:00Z",
          endsAt: "2020-07-02T10:00:00Z",
          setupStartsAt: "2020-07-02T07:45:00Z",
          seats: null,
          status: "cancelled",
        },
      ],
      unavailable: [
        {
          id: "dotypos-3",
          reviewSandbox: true,
          product: { kind: "other" },
          startsAt: null,
          endsAt: null,
          seats: null,
          status: "requires-attention",
        },
      ],
    });
    // Names included, as the account page shows them.
    expect(load).toHaveBeenCalledWith(testLinkedAccount);
  });

  test("lists only the reservations an account without a Dotypos customer authored", async () => {
    const { load, reservations } = historyServices({ linked: false });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith({
      accountId: testCustomerSession.accountId,
    });
  });

  test("tells an account whose deletion is pending why it has no history", async () => {
    const { reservations } = historyServices({
      history: Effect.fail(
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "deletion-requested",
        })
      ),
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "deletion-pending",
    });
  });

  test("answers unavailable when the account's link can't be read", async () => {
    const { load, reservations } = historyServices({
      linkRead: Effect.fail(customerAccountUnavailable("account-link.read")),
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
    expect(load).not.toHaveBeenCalled();
  });

  test("answers unavailable when Dotypos can't serve the history", async () => {
    const { reservations } = historyServices({
      history: Effect.succeed({
        kind: "unavailable",
        reason: "provider-unavailable",
      }),
    });
    const api = makeCustomerApiTestServer({ reservations });

    const response = await api.handle(customerApiRequest(listReservations));

    expect(response.status).toBe(503);
  });
});

describe("getReservationStatus", () => {
  const getReservationStatus: CustomerApiCall = {
    method: "GET",
    path: `/reservations/${orderId}/status`,
  };

  const fulfilledOrder = {
    orderId,
    returnOutcome: "unknown",
    kind: "meeting-room",
    status: "fulfilled",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    summary: {
      kind: "meeting-room",
      price: { value: 35_000, exponent: 2, currency: "CZK" },
      reservedFrom: Temporal.Instant.from("2026-06-20T08:15:00Z"),
      reservedUntil: Temporal.Instant.from("2026-06-20T10:00:00Z"),
      setupFrom: Temporal.Instant.from("2026-06-20T08:00:00Z"),
    },
  } as CheckoutStatusViewModel;

  const statusServices = (
    refreshStatus: CheckoutStatusService["Service"]["refreshStatus"],
    options: {
      readonly authorized?: boolean;
      readonly getStatus?: CheckoutStatusService["Service"]["getStatus"];
    } = {}
  ): Partial<CustomerReservationServiceLayers> => ({
    authorization: ownOrderAuthorization(options.authorized ?? true),
    checkoutStatus: Layer.mock(CheckoutStatusService, {
      refreshStatus,
      getStatus:
        options.getStatus ?? (() => Effect.die("must not read local status")),
    }),
  });

  testCustomerEndpointGuards(getReservationStatus);

  test("answers the refreshed status of the account's own order", async () => {
    const refreshStatus = mock(() => Effect.succeed(fulfilledOrder));
    const api = makeCustomerApiTestServer({
      reservations: statusServices(refreshStatus),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orderId,
      kind: "meeting-room",
      status: "fulfilled",
      paymentStatus: "paid",
      fulfillmentStatus: "fulfilled",
      startsAt: "2026-06-20T08:15:00Z",
      endsAt: "2026-06-20T10:00:00Z",
      setupStartsAt: "2026-06-20T08:00:00Z",
      total: { value: 35_000, exponent: 2, currency: "CZK" },
    });
    expect(refreshStatus).toHaveBeenCalledWith({
      orderId,
      returnOutcome: "unknown",
    });
  });

  test("answers an order that isn't paid yet with its status alone", async () => {
    const api = makeCustomerApiTestServer({
      reservations: statusServices(() =>
        Effect.succeed({
          orderId,
          returnOutcome: "unknown",
          kind: "cowork",
          status: "created",
          paymentStatus: "pending",
          fulfillmentStatus: "not_started",
        } as CheckoutStatusViewModel)
      ),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orderId,
      kind: "cowork",
      status: "created",
      paymentStatus: "pending",
      fulfillmentStatus: "not_started",
    });
  });

  test("answers someone else's order as not found, without reading it", async () => {
    const refreshStatus = mock(() => Effect.succeed(fulfilledOrder));
    const api = makeCustomerApiTestServer({
      reservations: statusServices(refreshStatus, { authorized: false }),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
    expect(refreshStatus).not.toHaveBeenCalled();
  });

  test("answers the local status when the refresh fails", async () => {
    const api = makeCustomerApiTestServer({
      reservations: statusServices(
        () => Effect.fail(new Error("refresh failed") as never),
        { getStatus: () => Effect.succeed(fulfilledOrder) }
      ),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "fulfilled" });
  });

  test("answers unavailable when no status can be read", async () => {
    const api = makeCustomerApiTestServer({
      reservations: statusServices(
        () => Effect.fail(new Error("refresh failed") as never),
        { getStatus: () => Effect.fail(new Error("read failed") as never) }
      ),
    });

    const response = await api.handle(customerApiRequest(getReservationStatus));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("finishes a refresh after its client disconnects", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const refreshes: string[] = [];
    const api = makeCustomerApiTestServer({
      reservations: statusServices(() =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.promise(() => release.promise)),
          Effect.andThen(
            Effect.sync(() => {
              refreshes.push("finished");
              return fulfilledOrder;
            })
          )
        )
      ),
    });
    const client = new AbortController();

    const response = api.handle(
      customerApiRequest({ ...getReservationStatus, signal: client.signal })
    );
    await started.promise;
    client.abort();
    await Bun.sleep(10);
    expect(refreshes).toEqual([]);
    release.resolve();
    await response.catch(() => undefined);

    expect(refreshes).toEqual(["finished"]);
  });
});

describe("getReservationAccess", () => {
  const getReservationAccess: CustomerApiCall = {
    method: "GET",
    path: `/reservations/${orderId}/access`,
  };

  const accessServices = (
    getAccess: ReservationAccessService["Service"]["getAccess"]
  ): Partial<CustomerReservationServiceLayers> => ({
    authorization: ownOrderAuthorization(true),
    access: () => Layer.mock(ReservationAccessService, { getAccess }),
  });

  const answering = (access: ReservationAccessViewModel) =>
    accessServices(() => Effect.succeed(access));

  testCustomerEndpointGuards(getReservationAccess);

  test("answers the door code of the account's own order, and when the lock accepts it", async () => {
    const getAccess = mock(() =>
      Effect.succeed<ReservationAccessViewModel>({
        state: "available",
        code: "2468",
        accessStartsAt: Temporal.Instant.from("2026-06-20T08:00:00Z"),
        accessEndsAt: Temporal.Instant.from("2026-06-20T11:00:00Z"),
      })
    );
    const api = makeCustomerApiTestServer({
      reservations: accessServices(getAccess),
    });

    const response = await api.handle(customerApiRequest(getReservationAccess));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: "2468",
      accessStartsAt: "2026-06-20T08:00:00Z",
      accessEndsAt: "2026-06-20T11:00:00Z",
    });
    // The session alone authorizes it: no access cookie or link token.
    expect(getAccess).toHaveBeenCalledWith({ orderId, locale: "en-US" });
  });

  test("hands the code service the authorization read through the session", async () => {
    const authorizations: boolean[] = [];
    const api = makeCustomerApiTestServer({
      reservations: {
        authorization: ownOrderAuthorization(true),
        access: (authorization) =>
          Layer.effect(
            ReservationAccessService,
            Effect.map(ReservationAuthorizationService, (authorizer) => ({
              getAccess: (input) =>
                authorizer
                  .isAuthorized({ ...input, permission: "view-access-code" })
                  .pipe(
                    Effect.tap((authorized) =>
                      Effect.sync(() => authorizations.push(authorized))
                    ),
                    Effect.as<ReservationAccessViewModel>({
                      state: "invalid_link",
                    })
                  ),
            }))
          ).pipe(Layer.provide(authorization)),
      },
    });

    await api.handle(customerApiRequest(getReservationAccess));

    expect(authorizations).toEqual([true]);
  });

  test("answers someone else's order as not found", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering({ state: "invalid_link" }),
    });

    const response = await api.handle(customerApiRequest(getReservationAccess));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
  });

  test("answers an order that isn't fulfilled yet as without a code", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering({
        state: "unavailable",
        reason: "reservation-state",
      }),
    });

    const response = await api.handle(customerApiRequest(getReservationAccess));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccessCodeUnavailable",
    });
  });

  test("answers unavailable when the code couldn't be looked up", async () => {
    const api = makeCustomerApiTestServer({
      reservations: answering({
        state: "unavailable",
        reason: "lookup-failed",
      }),
    });

    const response = await api.handle(customerApiRequest(getReservationAccess));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("finishes issuing a code after its client disconnects", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const issued: string[] = [];
    const api = makeCustomerApiTestServer({
      reservations: accessServices(() =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.andThen(Effect.promise(() => release.promise)),
          Effect.andThen(
            Effect.sync((): ReservationAccessViewModel => {
              issued.push("issued");
              return { state: "invalid_link" };
            })
          )
        )
      ),
    });
    const client = new AbortController();

    const response = api.handle(
      customerApiRequest({ ...getReservationAccess, signal: client.signal })
    );
    await started.promise;
    client.abort();
    await Bun.sleep(10);
    expect(issued).toEqual([]);
    release.resolve();
    await response.catch(() => undefined);

    expect(issued).toEqual(["issued"]);
  });
});

describe("getReservationInvoice", () => {
  const getReservationInvoice: CustomerApiCall = {
    method: "GET",
    path: `/reservations/${orderId}/invoice`,
  };

  const issuedInvoice: InvoicePdfFile = {
    bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"),
    fileName: "WS-FV-2026-000042.pdf",
  };

  const invoiceServices = (
    getPdf: ReservationInvoicePdfService["Service"]["getPdf"]
  ): Partial<CustomerReservationServiceLayers> => ({
    authorization: ownOrderAuthorization(true),
    invoice: () => Layer.mock(ReservationInvoicePdfService, { getPdf }),
  });

  const failingWith = (
    failure: Effect.Error<
      ReturnType<ReservationInvoicePdfService["Service"]["getPdf"]>
    >
  ) => invoiceServices(() => Effect.fail(failure));

  testCustomerEndpointGuards(getReservationInvoice);

  test("downloads the issued invoice of the account's order as a PDF named by its number", async () => {
    const getPdf = mock(() => Effect.succeed(issuedInvoice));
    const api = makeCustomerApiTestServer({
      reservations: invoiceServices(getPdf),
    });

    const response = await api.handle(
      customerApiRequest(getReservationInvoice)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="WS-FV-2026-000042.pdf"'
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(body.subarray(0, 5))).toBe("%PDF-");
    expect(body).toEqual(issuedInvoice.bytes);
    // The session alone authorizes it: no access cookie or link token.
    expect(getPdf).toHaveBeenCalledWith({ orderId, locale: "en-US" });
  });

  test("hands the invoice service the authorization read through the session", async () => {
    const authorizations: boolean[] = [];
    const api = makeCustomerApiTestServer({
      reservations: {
        authorization: ownOrderAuthorization(true),
        invoice: (authorization) =>
          Layer.effect(
            ReservationInvoicePdfService,
            Effect.map(ReservationAuthorizationService, (authorizer) => ({
              getPdf: (input) =>
                authorizer
                  .authorize({ ...input, permission: "view-invoice" })
                  .pipe(
                    Effect.tap((authorized) =>
                      Effect.sync(() => authorizations.push(authorized))
                    ),
                    Effect.andThen(
                      Effect.fail(
                        new ReservationInvoiceNotFoundError({ orderId })
                      )
                    )
                  ),
            }))
          ).pipe(Layer.provide(authorization)),
      },
    });

    await api.handle(customerApiRequest(getReservationInvoice));

    expect(authorizations).toEqual([true]);
  });

  test("answers someone else's order, or one that doesn't exist, as not found", async () => {
    const api = makeCustomerApiTestServer({
      reservations: failingWith(
        new ReservationInvoiceNotFoundError({ orderId })
      ),
    });

    const response = await api.handle(
      customerApiRequest(getReservationInvoice)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerReservationNotFound",
    });
  });

  test("answers an order without an issued invoice, such as one not fulfilled yet, as not issued", async () => {
    const api = makeCustomerApiTestServer({
      reservations: failingWith(
        new ReservationInvoiceNotIssuedError({ orderId })
      ),
    });

    const response = await api.handle(
      customerApiRequest(getReservationInvoice)
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerInvoiceNotIssued",
    });
  });

  test.each([
    [
      "whether the account may see the order can't be read",
      new ReservationAuthorizationUnavailableError({
        orderId,
        cause: customerAccountUnavailable("account-link.read"),
      }),
    ],
    [
      "the stored invoice can't be rendered",
      new InvoicePdfRenderingError({ message: "renderer failed" }),
    ],
  ])("answers unavailable when %s", async (_case, failure) => {
    const api = makeCustomerApiTestServer({
      reservations: failingWith(failure),
    });

    const response = await api.handle(
      customerApiRequest(getReservationInvoice)
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});
