import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService, DotyposVersionConflict } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { InvoiceRepository } from "./invoice.repository";
import { ReservationInvoiceService } from "./reservation-invoice.service";

mock.module("server-only", () => ({}));

const { InvoiceEmailDeliveryError, InvoiceEmailDeliveryService } = await import(
  "./invoice-email-delivery.service"
);

const paymentAttemptId = paymentAttemptIdSchema.make("payment-attempt-1");
const personalAddress = {
  line1: "Synthetic 1",
  city: "Praha",
  postalCode: "100 00",
  country: "CZ",
};

describe("reservation invoice processing", () => {
  test("does nothing for personal reservations without an invoice request", async () => {
    const harness = makeHarness(
      makeSource({ purpose: "personal", invoice: "none" })
    );

    await runProcessing(harness);

    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("issues and delivers a requested personal invoice from frozen details", async () => {
    const harness = makeHarness(
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      })
    );

    await runProcessing(harness);

    expect(harness.updateBilling).toHaveBeenCalledWith("dotypos-customer-1", {
      addressLine1: "Synthetic 1",
      addressLine2: "",
      city: "Praha",
      zip: "100 00",
      country: "CZ",
      companyName: "",
      companyId: "",
      vatId: "",
    });
    expect(harness.issue).toHaveBeenCalledWith({
      paymentAttemptId,
      buyer: {
        kind: "person",
        legalName: "Ada Lovelace",
        address: personalAddress,
      },
    });
    expect(harness.deliver).toHaveBeenCalledWith({ paymentAttemptId });
  });

  test("business reservations are always invoiced", async () => {
    const source = makeSource({
      purpose: "business",
      invoice: "required",
      buyer: {
        kind: "business",
        legalName: "Synthetic Company s.r.o.",
        companyId: "12345678",
        address: personalAddress,
      },
    });
    const harness = makeHarness(source);

    await runProcessing(harness);

    expect(harness.updateBilling).toHaveBeenCalledWith("dotypos-customer-1", {
      addressLine1: "Synthetic 1",
      addressLine2: "",
      city: "Praha",
      zip: "100 00",
      country: "CZ",
      companyName: "Synthetic Company s.r.o.",
      companyId: "12345678",
      vatId: "",
    });
    expect(harness.issue).toHaveBeenCalledWith({
      paymentAttemptId,
      buyer: source.billing?.purpose === "business" ? source.billing.buyer : {},
    });
    expect(harness.deliver).toHaveBeenCalledTimes(1);
  });

  test("legacy snapshots remain ineligible for automatic invoicing", async () => {
    const { billing: _billing, ...legacySource } = makeSource({
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    });
    const harness = makeHarness(
      Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)(legacySource)
    );

    await runProcessing(harness);

    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("does not overwrite billing after the invoice has been issued", async () => {
    const harness = makeHarness(
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      }),
      { existingInvoice: {} }
    );

    await runProcessing(harness);

    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).toHaveBeenCalledTimes(1);
    expect(harness.deliver).toHaveBeenCalledTimes(1);
  });

  test("does not issue when committed billing persistence fails", async () => {
    const billingFailure = new DotyposVersionConflict({
      operation: "patchCustomer",
    });
    const harness = makeHarness(
      makeSource({
        purpose: "personal",
        invoice: "requested",
        address: personalAddress,
      }),
      { billingFailure }
    );

    await expect(runProcessing(harness)).rejects.toBe(billingFailure);
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("rejects an invalid capability before loading the reservation", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source);

    const state = await runPostOrderState(harness, "invalid-token");

    expect(state).toBe("unavailable");
    expect(harness.findReservation).not.toHaveBeenCalled();
  });

  test("creates a personal invoice from a protected post-order request", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source);
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({
        orderId: source.workspaceReservationId,
        locale: "en-US",
      })
    );

    const state = await runPostOrderState(harness, accessToken);
    const result = await runPostOrderCreate(harness, accessToken);

    expect(state).toBe("create");
    expect(result).toEqual({ status: "created", delivered: true });
    expect(harness.issue).toHaveBeenCalledWith({
      paymentAttemptId,
      buyer: {
        kind: "person",
        legalName: "Ada Lovelace",
        address: personalAddress,
      },
      provenance: { source: "post-order-link" },
    });
  });

  test("reconciles a losing concurrent request to the issued buyer", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const committedAddress = { ...personalAddress, line1: "Winner 1" };
    const harness = makeHarness(source, {
      issuedInvoice: {
        document: {
          ...makeCoworkInvoiceDocument("en-US"),
          buyer: {
            kind: "person",
            legalName: "Ada Lovelace",
            address: committedAddress,
          },
        },
      },
      issueChanged: false,
    });
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({
        orderId: source.workspaceReservationId,
        locale: "en-US",
      })
    );

    const result = await runPostOrderCreate(harness, accessToken);

    expect(result).toEqual({ status: "already-issued", delivered: true });
    expect(harness.updateBilling).toHaveBeenCalledTimes(2);
    expect(harness.updateBilling).toHaveBeenLastCalledWith(
      "dotypos-customer-1",
      expect.objectContaining({ addressLine1: "Winner 1" })
    );
  });

  test("does not offer customer resend when only the internal copy failed", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      deliveryFailure: new InvoiceEmailDeliveryError({
        code: "email_delivery_failed",
        paymentAttemptId,
        message: "Internal invoice email delivery failed.",
        customerDelivered: true,
      }),
    });
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({
        orderId: source.workspaceReservationId,
        locale: "en-US",
      })
    );

    const result = await runPostOrderCreate(harness, accessToken);

    expect(result).toEqual({ status: "created", delivered: true });
  });

  test("refuses a losing concurrent request whose issued buyer is not a person", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      issuedInvoice: {
        document: {
          ...makeCoworkInvoiceDocument("en-US"),
          buyer: {
            kind: "business",
            legalName: "Synthetic Company s.r.o.",
            companyId: "12345678",
            address: personalAddress,
          },
        },
      },
      issueChanged: false,
    });

    await expect(
      runPostOrderCreate(harness, await makeAccessToken(source))
    ).rejects.toMatchObject({ _tag: "PostOrderInvoiceUnavailableError" });
    expect(harness.updateBilling).toHaveBeenCalledTimes(1);
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("offers customer resend when the customer copy failed", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      deliveryFailure: new InvoiceEmailDeliveryError({
        code: "email_delivery_failed",
        paymentAttemptId,
        message: "Customer invoice email delivery failed.",
        customerDelivered: false,
      }),
    });

    const result = await runPostOrderCreate(
      harness,
      await makeAccessToken(source)
    );

    expect(result).toEqual({ status: "created", delivered: false });
  });

  test("returns an issued invoice without issuing or delivering again", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, { existingInvoice: {} });

    const result = await runPostOrderCreate(
      harness,
      await makeAccessToken(source)
    );

    expect(result).toEqual({ status: "already-issued", delivered: true });
    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
  });

  test("refuses creation and resend when the post-order page is unavailable", async () => {
    const source = makeSource({
      purpose: "personal",
      invoice: "requested",
      address: personalAddress,
    });
    const harness = makeHarness(source);
    const accessToken = await makeAccessToken(source);

    await expect(
      runPostOrderCreate(harness, accessToken)
    ).rejects.toMatchObject({ _tag: "PostOrderInvoiceUnavailableError" });
    await expect(
      runPostOrderResend(harness, accessToken)
    ).rejects.toMatchObject({ _tag: "PostOrderInvoiceUnavailableError" });
    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
    expect(harness.resend).not.toHaveBeenCalled();
  });

  test("is unavailable without a capability, before loading the reservation", async () => {
    const harness = makeHarness(
      makeSource({ purpose: "personal", invoice: "none" })
    );

    const state = await runPostOrderState(harness, undefined);

    expect(state).toBe("unavailable");
    expect(harness.findReservation).not.toHaveBeenCalled();
  });

  test.each([
    ["is missing", null],
    ["is in another locale", { locale: "cs" }],
    ["is unpaid", { paymentState: "pending" }],
    ["is unconfirmed", { reservationState: "held" }],
    [
      "has no delivered access code",
      { fulfillmentState: "processing", fulfilledAt: null },
    ],
    ["has no active payment attempt", { activePaymentAttemptId: null }],
  ] as const)(
    "is unavailable when the reservation %s",
    async (_, reservation) => {
      const source = makeSource({ purpose: "personal", invoice: "none" });
      const harness = makeHarness(source, { reservation });

      const state = await runPostOrderState(
        harness,
        await makeAccessToken(source)
      );

      expect(state).toBe("unavailable");
      expect(harness.findSnapshot).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["is missing", () => null],
    [
      "has no delivery recipient",
      ({ delivery: _delivery, ...source }: AccountingDocumentSnapshot) =>
        source,
    ],
    [
      "belongs to another reservation",
      (source: AccountingDocumentSnapshot) => ({
        ...source,
        workspaceReservationId: "other-reservation",
      }),
    ],
    [
      "belongs to another customer",
      (source: AccountingDocumentSnapshot) => ({
        ...source,
        dotyposCustomerId: "other-customer",
      }),
    ],
  ] as const)("is unavailable when the snapshot %s", async (_, snapshotOf) => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      snapshot: snapshotOf(source) as AccountingDocumentSnapshot | null,
    });

    const state = await runPostOrderState(
      harness,
      await makeAccessToken(source)
    );

    expect(state).toBe("unavailable");
    expect(harness.findInvoice).not.toHaveBeenCalled();
  });

  test.each([
    [
      "the reservation is a business one",
      { reservation: { reservationPurpose: "business" } },
    ],
    [
      "the snapshot already requested an invoice",
      {
        snapshot: makeSource({
          purpose: "personal",
          invoice: "requested",
          address: personalAddress,
        }),
      },
    ],
    [
      "the snapshot has no billing selection",
      {
        snapshot: (() => {
          const { billing: _billing, ...legacy } = makeSource({
            purpose: "personal",
            invoice: "none",
          });
          return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)(
            legacy
          );
        })(),
      },
    ],
    [
      "the snapshot buyer is not a person",
      {
        snapshot: Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
          ...makeSource({ purpose: "personal", invoice: "none" }),
          buyer: {
            kind: "business",
            legalName: "Synthetic Company s.r.o.",
            companyId: "12345678",
            address: personalAddress,
          },
        }),
      },
    ],
  ] as const)("does not offer creation when %s", async (_, options) => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, {
      reservation: { reservationPurpose: "personal" },
      ...options,
    });

    const state = await runPostOrderState(
      harness,
      await makeAccessToken(source)
    );

    expect(state).toBe("unavailable");
    expect(harness.findInvoice).toHaveBeenCalledTimes(1);
  });

  test("resends an existing invoice only through the customer resend path", async () => {
    const source = makeSource({ purpose: "personal", invoice: "none" });
    const harness = makeHarness(source, { existingInvoice: {} });
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({
        orderId: source.workspaceReservationId,
        locale: "en-US",
      })
    );

    await runPostOrderResend(harness, accessToken);

    expect(harness.resend).toHaveBeenCalledWith({ paymentAttemptId });
    expect(harness.updateBilling).not.toHaveBeenCalled();
    expect(harness.issue).not.toHaveBeenCalled();
  });
});

const runProcessing = (harness: ReturnType<typeof makeHarness>) =>
  Effect.gen(function* () {
    const service = yield* ReservationInvoiceService;
    yield* service.processByPaymentAttemptId({ paymentAttemptId });
  }).pipe(
    Effect.provide(
      ReservationInvoiceService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              AccountingDocumentSnapshotRepository,
              harness.accountingSnapshots
            ),
            Layer.mock(DotyposService, harness.dotypos),
            Layer.mock(InvoiceRepository, harness.invoices),
            Layer.mock(InvoiceEmailDeliveryService, harness.deliveries),
            Layer.mock(WorkspaceReservationRepository, harness.reservations)
          )
        )
      )
    ),
    Effect.runPromise
  );

const makeAccessToken = (source: AccountingDocumentSnapshot) =>
  Effect.runPromise(
    createReservationAccessToken({
      orderId: source.workspaceReservationId,
      locale: "en-US",
    })
  );

const runPostOrderState = (
  harness: ReturnType<typeof makeHarness>,
  accessToken: ReservationAccessToken | undefined
) =>
  runWithHarness(
    harness,
    Effect.gen(function* () {
      const service = yield* ReservationInvoiceService;
      return yield* service.getPostOrderState({
        orderId: harness.source?.workspaceReservationId as never,
        locale: "en-US",
        accessToken,
      });
    })
  );

const runPostOrderCreate = (
  harness: ReturnType<typeof makeHarness>,
  accessToken: ReservationAccessToken
) =>
  runWithHarness(
    harness,
    Effect.gen(function* () {
      const service = yield* ReservationInvoiceService;
      return yield* service.createPostOrderInvoice({
        orderId: harness.source?.workspaceReservationId as never,
        locale: "en-US",
        accessToken,
        address: personalAddress,
      });
    })
  );

const runPostOrderResend = (
  harness: ReturnType<typeof makeHarness>,
  accessToken: ReservationAccessToken
) =>
  runWithHarness(
    harness,
    Effect.gen(function* () {
      const service = yield* ReservationInvoiceService;
      yield* service.resendPostOrderInvoice({
        orderId: harness.source?.workspaceReservationId as never,
        locale: "en-US",
        accessToken,
      });
    })
  );

const runWithHarness = <A, E>(
  harness: ReturnType<typeof makeHarness>,
  effect: Effect.Effect<A, E, ReservationInvoiceService>
) =>
  effect.pipe(
    Effect.provide(
      ReservationInvoiceService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              AccountingDocumentSnapshotRepository,
              harness.accountingSnapshots
            ),
            Layer.mock(DotyposService, harness.dotypos),
            Layer.mock(InvoiceRepository, harness.invoices),
            Layer.mock(InvoiceEmailDeliveryService, harness.deliveries),
            Layer.mock(WorkspaceReservationRepository, harness.reservations)
          )
        )
      )
    ),
    Effect.runPromise
  );

const makeHarness = (
  source: AccountingDocumentSnapshot | null,
  options: {
    readonly billingFailure?: DotyposVersionConflict;
    readonly existingInvoice?: object;
    readonly issuedInvoice?: object;
    readonly issueChanged?: boolean;
    readonly deliveryFailure?: InstanceType<typeof InvoiceEmailDeliveryError>;
    readonly reservation?: object | null;
    readonly snapshot?: AccountingDocumentSnapshot | null;
  } = {}
) => {
  const issue = mock(() =>
    Effect.succeed({
      invoice: (options.issuedInvoice ?? {}) as never,
      changed: options.issueChanged ?? true,
    })
  );
  const deliver = mock(() =>
    options.deliveryFailure
      ? Effect.fail(options.deliveryFailure)
      : Effect.succeed({ status: "delivered" as const, changed: true })
  );
  const updateBilling = mock(() =>
    options.billingFailure ? Effect.fail(options.billingFailure) : Effect.void
  );
  const findReservation = mock(() =>
    Effect.succeed(
      source && options.reservation !== null
        ? ({
            id: source.workspaceReservationId,
            locale: source.locale,
            paymentState: "paid",
            reservationState: "confirmed",
            fulfillmentState: "fulfilled",
            fulfilledAt: Temporal.Instant.from("2026-08-13T12:00:00Z"),
            activePaymentAttemptId: paymentAttemptId,
            reservationPurpose: source.billing?.purpose ?? null,
            dotyposCustomerId: source.dotyposCustomerId,
            ...options.reservation,
          } as never)
        : null
    )
  );
  const resend = mock(() =>
    Effect.succeed({ status: "delivered" as const, changed: true })
  );

  const findSnapshot = mock(() =>
    Effect.succeed(options.snapshot === undefined ? source : options.snapshot)
  );
  const findInvoice = mock(() =>
    Effect.succeed((options.existingInvoice ?? null) as never)
  );

  return {
    accountingSnapshots: {
      findByPaymentAttemptId: findSnapshot,
    },
    invoices: {
      findByPaymentAttemptId: findInvoice,
      issue,
    },
    dotypos: {
      updateCustomerBillingDetails: updateBilling,
    },
    deliveries: {
      deliverByPaymentAttemptId: deliver,
      resendCustomerByPaymentAttemptId: resend,
    },
    reservations: { findById: findReservation },
    source,
    findReservation,
    findSnapshot,
    findInvoice,
    updateBilling,
    issue,
    deliver,
    resend,
  };
};

const makeSource = (
  billing: NonNullable<AccountingDocumentSnapshot["billing"]>
): AccountingDocumentSnapshot => {
  const document = makeCoworkInvoiceDocument("en-US");
  const {
    fulfilledAt: _fulfilledAt,
    invoiceNumber: _invoiceNumber,
    issuedAt: _issuedAt,
    paidAt: _paidAt,
    paymentAttemptId: _paymentAttemptId,
    supplier: invoiceSupplier,
    ...identity
  } = document;
  const { commercialRegister: _commercialRegister, ...supplier } =
    invoiceSupplier;

  return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
    ...identity,
    supplier,
    billing,
    delivery: { email: testEmailAddress("synthetic") },
  });
};
