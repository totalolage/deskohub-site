import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService, ExternalAPIError } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { InvoiceRepository } from "./invoice.repository";
import { InvoiceEmailDeliveryService } from "./invoice-email-delivery.service";
import { ReservationInvoiceService } from "./reservation-invoice";
import { ReservationInvoiceServiceLive } from "./reservation-invoice.service";

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
    const billingFailure = new ExternalAPIError({
      service: "Dotypos",
      operation: "patchCustomer",
      statusCode: 412,
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
});

const runProcessing = (harness: ReturnType<typeof makeHarness>) =>
  Effect.gen(function* () {
    const service = yield* ReservationInvoiceService;
    yield* service.processByPaymentAttemptId({ paymentAttemptId });
  }).pipe(
    Effect.provide(
      ReservationInvoiceServiceLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              AccountingDocumentSnapshotRepository,
              harness.accountingSnapshots
            ),
            Layer.mock(DotyposService, harness.dotypos),
            Layer.mock(InvoiceRepository, harness.invoices),
            Layer.mock(InvoiceEmailDeliveryService, harness.deliveries)
          )
        )
      )
    ),
    Effect.runPromise
  );

const makeHarness = (
  source: AccountingDocumentSnapshot | null,
  options: {
    readonly billingFailure?: ExternalAPIError;
    readonly existingInvoice?: object;
  } = {}
) => {
  const issue = mock(() =>
    Effect.succeed({ invoice: {} as never, changed: true })
  );
  const deliver = mock(() =>
    Effect.succeed({ status: "delivered" as const, changed: true })
  );
  const updateBilling = mock(() =>
    options.billingFailure ? Effect.fail(options.billingFailure) : Effect.void
  );

  return {
    accountingSnapshots: {
      findByPaymentAttemptId: mock(() => Effect.succeed(source)),
    },
    invoices: {
      findByPaymentAttemptId: mock(() =>
        Effect.succeed((options.existingInvoice ?? null) as never)
      ),
      issue,
    },
    dotypos: {
      updateCustomerBillingDetails: updateBilling,
    },
    deliveries: { deliverByPaymentAttemptId: deliver },
    updateBilling,
    issue,
    deliver,
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
    delivery: { email: "synthetic@example.test" },
  });
};
