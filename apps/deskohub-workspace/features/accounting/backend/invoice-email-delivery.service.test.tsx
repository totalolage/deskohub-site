import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProviderConfig,
  type EmailSendResult,
} from "@deskohub/email";
import {
  EmailConfigTag,
  type EmailService,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import { Effect, Layer, Schema } from "effect";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
} from "@/features/accounting/accounting-document-snapshot";
import { isManualInvoiceDocument } from "@/features/accounting/invoice";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import type { InvoiceEmailDeliveryAudience } from "@/features/accounting/invoice-email-delivery";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import {
  type IInvoiceRepository,
  type Invoice,
  InvoiceRepository,
  type ReservationInvoice,
} from "./invoice.repository";
import {
  type IInvoiceEmailDeliveryRepository,
  InvoiceEmailDeliveryRepository,
} from "./invoice-email-delivery.repository";
import { InvoiceEmailDeliveryService } from "./invoice-email-delivery.service";

mock.module("server-only", () => ({}));

const document = makeCoworkInvoiceDocument("en-US");
const invoice = {
  id: "invoice-id",
  workspaceReservationId: document.workspaceReservationId,
  paymentAttemptId: document.paymentAttemptId,
  dotyposCustomerId: document.dotyposCustomerId,
  invoiceNumber: document.invoiceNumber,
  issuedAt: Temporal.Instant.from(document.issuedAt),
  document,
};
const source = makeSourceSnapshot("frozen-recipient@example.test");

const emailConfig: EmailProviderConfig = {
  provider: "console",
  defaultFrom: {
    email: "reservations@workspace.deskohub.cz",
    name: "Deskohub Workspace",
  },
};

const sentResult = (id: string): EmailSendResult => ({
  id: EmailDeliveryIdSchema.make(id),
  status: "sent",
  provider: "test",
  timestamp: new Date(),
});

describe("invoice email delivery", () => {
  test("does nothing when no invoice was issued", async () => {
    const sentMessages: EmailMessage[] = [];
    const harness = makeHarness({ invoice: null, sentMessages });

    const result = await runDelivery(harness);

    expect(result).toEqual({ status: "not_issued" });
    expect(sentMessages).toEqual([]);
    expect(harness.claim).not.toHaveBeenCalled();
  });

  test("sends the same immutable PDF to the frozen recipient and internal copy", async () => {
    const sentMessages: EmailMessage[] = [];
    const harness = makeHarness({ sentMessages });

    const result = await runDelivery(harness);

    expect(result).toEqual({ status: "delivered", changed: true });
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toMatchObject({
      to: { email: "frozen-recipient@example.test" },
      subject: `Invoice ${document.invoiceNumber}`,
      tags: ["workspace-invoice-customer"],
      idempotencyKey: `workspace-invoice-customer-${invoice.id}`,
      attachments: [
        {
          filename: `${document.invoiceNumber}.pdf`,
          contentType: "application/pdf",
        },
      ],
    });
    expect(sentMessages[1]).toMatchObject({
      to: { email: "delivered+workspace-internal@resend.dev" },
      subject: `[TESTING] Faktura ${document.invoiceNumber}`,
      tags: ["workspace-invoice-internal"],
      idempotencyKey: `workspace-invoice-internal-${invoice.id}`,
      attachments: [
        {
          filename: `${document.invoiceNumber}.pdf`,
          contentType: "application/pdf",
        },
      ],
    });
    const customerPdf = sentMessages[0]?.attachments?.[0]?.content;
    const internalPdf = sentMessages[1]?.attachments?.[0]?.content;
    expect(Buffer.isBuffer(customerPdf)).toBe(true);
    expect(customerPdf).toEqual(internalPdf);
    expect((customerPdf as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    expect(harness.markAccepted).toHaveBeenCalledTimes(2);
    expect(harness.markFailed).not.toHaveBeenCalled();
  });

  test("retries only the failed audience without replacing the invoice", async () => {
    const sentMessages: EmailMessage[] = [];
    let failInternal = true;
    const harness = makeHarness({
      sentMessages,
      send: (message) => {
        sentMessages.push(message);
        if (
          failInternal &&
          message.tags?.includes("workspace-invoice-internal")
        ) {
          failInternal = false;
          return Effect.fail(new EmailServiceError("synthetic failure"));
        }
        return Effect.succeed(sentResult(`email-${sentMessages.length}`));
      },
    });

    await expect(runDelivery(harness)).rejects.toMatchObject({
      code: "email_delivery_failed",
      paymentAttemptId: document.paymentAttemptId,
      customerDelivered: true,
    });
    expect(sentMessages).toHaveLength(2);
    expect(harness.markFailed).toHaveBeenCalledWith({
      invoiceId: invoice.id,
      audience: "internal",
      attemptNumber: 1,
      failureCode: "email_send_failed",
    });

    const retry = await runDelivery(harness);

    expect(retry).toEqual({ status: "delivered", changed: true });
    expect(sentMessages).toHaveLength(3);
    expect(sentMessages[2]?.tags).toEqual(["workspace-invoice-internal"]);
    expect(sentMessages[2]?.idempotencyKey).toBe(
      sentMessages[1]?.idempotencyKey
    );
    expect(sentMessages[2]?.attachments?.[0]?.filename).toBe(
      `${document.invoiceNumber}.pdf`
    );
  });

  test("explicitly resends only the customer copy with a new idempotency key", async () => {
    const sentMessages: EmailMessage[] = [];
    const harness = makeHarness({ sentMessages });

    await runDelivery(harness);
    const result = await runCustomerResend(harness);

    expect(result).toEqual({ status: "delivered", changed: true });
    expect(sentMessages).toHaveLength(3);
    expect(sentMessages[2]).toMatchObject({
      to: { email: "frozen-recipient@example.test" },
      tags: ["workspace-invoice-customer"],
      idempotencyKey: "workspace-invoice-customer-resend-invoice-id-2",
    });
    expect(harness.claimResend).toHaveBeenCalledTimes(1);
  });

  test("does not report a resend while another resend owns the claim", async () => {
    const sentMessages: EmailMessage[] = [];
    const harness = makeHarness({ sentMessages, resendClaimed: false });

    await expect(runCustomerResend(harness)).rejects.toMatchObject({
      code: "delivery_in_progress",
    });
    expect(sentMessages).toEqual([]);
  });

  test("rejects legacy snapshots without a frozen recipient", async () => {
    const sentMessages: EmailMessage[] = [];
    const { delivery: _delivery, ...legacySource } = source;
    const harness = makeHarness({
      sentMessages,
      source: Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)(
        legacySource
      ),
    });

    await expect(runDelivery(harness)).rejects.toMatchObject({
      code: "delivery_recipient_unavailable",
    });
    expect(sentMessages).toEqual([]);
    expect(harness.claim).not.toHaveBeenCalled();
  });

  test("delivers a manual invoice to its immutable document recipient", async () => {
    const sentMessages: EmailMessage[] = [];
    const manualDocument = makeTestManualInvoiceDocument("en-US");
    const manualInvoice: Invoice = {
      id: manualDocument.invoiceId,
      workspaceReservationId: null,
      paymentAttemptId: null,
      dotyposCustomerId: manualDocument.dotyposCustomerId,
      invoiceNumber: manualDocument.invoiceNumber,
      issuedAt: Temporal.Instant.from(manualDocument.issuedAt),
      document: manualDocument,
    };
    const harness = makeHarness({ invoice: manualInvoice, sentMessages });

    const result = await runDeliveryByInvoiceId(harness, manualInvoice.id);

    expect(result).toEqual({ status: "delivered", changed: true });
    expect(sentMessages[0]?.to).toEqual({
      email: "manual-invoice@example.test",
    });
    expect(sentMessages[0]?.idempotencyKey).toBe(
      `${sentMessages[0]?.tags?.[0]}-${manualInvoice.id}`
    );
    expect(
      harness.accountingSnapshots.findByPaymentAttemptId
    ).not.toHaveBeenCalled();
  });
});

const runDelivery = (harness: ReturnType<typeof makeHarness>) =>
  Effect.gen(function* () {
    const service = yield* InvoiceEmailDeliveryService;
    return yield* service.deliverByPaymentAttemptId({
      paymentAttemptId: document.paymentAttemptId,
    });
  }).pipe(
    Effect.provide(
      InvoiceEmailDeliveryService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(InvoiceRepository, harness.invoices),
            Layer.succeed(
              AccountingDocumentSnapshotRepository,
              harness.accountingSnapshots
            ),
            Layer.succeed(InvoiceEmailDeliveryRepository, harness.deliveries),
            Layer.succeed(EmailServiceTag, harness.emailService),
            Layer.succeed(EmailConfigTag, emailConfig)
          )
        )
      )
    ),
    Effect.runPromise
  );

const runCustomerResend = (harness: ReturnType<typeof makeHarness>) =>
  Effect.gen(function* () {
    const service = yield* InvoiceEmailDeliveryService;
    return yield* service.resendCustomerByPaymentAttemptId({
      paymentAttemptId: document.paymentAttemptId,
    });
  }).pipe(
    Effect.provide(
      InvoiceEmailDeliveryService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(InvoiceRepository, harness.invoices),
            Layer.succeed(
              AccountingDocumentSnapshotRepository,
              harness.accountingSnapshots
            ),
            Layer.succeed(InvoiceEmailDeliveryRepository, harness.deliveries),
            Layer.succeed(EmailServiceTag, harness.emailService),
            Layer.succeed(EmailConfigTag, emailConfig)
          )
        )
      )
    ),
    Effect.runPromise
  );

const runDeliveryByInvoiceId = (
  harness: ReturnType<typeof makeHarness>,
  invoiceId: string
) =>
  Effect.gen(function* () {
    const service = yield* InvoiceEmailDeliveryService;
    return yield* service.deliverByInvoiceId({ invoiceId });
  }).pipe(
    Effect.provide(
      InvoiceEmailDeliveryService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(InvoiceRepository, harness.invoices),
            Layer.succeed(
              AccountingDocumentSnapshotRepository,
              harness.accountingSnapshots
            ),
            Layer.succeed(InvoiceEmailDeliveryRepository, harness.deliveries),
            Layer.succeed(EmailServiceTag, harness.emailService),
            Layer.succeed(EmailConfigTag, emailConfig)
          )
        )
      )
    ),
    Effect.runPromise
  );

const makeHarness = (options: {
  readonly sentMessages: EmailMessage[];
  readonly invoice?: Invoice | null;
  readonly source?: AccountingDocumentSnapshot;
  readonly send?: EmailService["send"];
  readonly resendClaimed?: boolean;
}) => {
  const states = new Map<InvoiceEmailDeliveryAudience, "accepted" | "failed">();
  const attempts = new Map<InvoiceEmailDeliveryAudience, number>();
  const claim = mock(
    ({ audience }: Parameters<IInvoiceEmailDeliveryRepository["claim"]>[0]) => {
      if (states.get(audience) === "accepted") return Effect.succeed(null);
      const attemptNumber = (attempts.get(audience) ?? 0) + 1;
      attempts.set(audience, attemptNumber);
      return Effect.succeed({ attemptNumber });
    }
  );
  const markAccepted = mock(
    (input: Parameters<IInvoiceEmailDeliveryRepository["markAccepted"]>[0]) => {
      states.set(input.audience, "accepted");
      return Effect.void;
    }
  );
  const claimResend = mock(() => {
    if (options.resendClaimed === false) return Effect.succeed(null);
    const attemptNumber = (attempts.get("customer") ?? 0) + 1;
    attempts.set("customer", attemptNumber);
    return Effect.succeed({ attemptNumber });
  });
  const markFailed = mock(
    (input: Parameters<IInvoiceEmailDeliveryRepository["markFailed"]>[0]) => {
      states.set(input.audience, "failed");
      return Effect.void;
    }
  );
  const deliveries: IInvoiceEmailDeliveryRepository = {
    claim,
    claimResend,
    markAccepted,
    markFailed,
  };
  const selectedInvoice =
    options.invoice === undefined ? invoice : options.invoice;
  const invoices: IInvoiceRepository = {
    findById: mock(() => Effect.succeed(selectedInvoice)),
    findByPaymentAttemptId: mock(() =>
      Effect.succeed(
        selectedInvoice && !isManualInvoiceDocument(selectedInvoice.document)
          ? (selectedInvoice as ReservationInvoice)
          : null
      )
    ),
    getSuggestedVariableSymbol: mock(() => Effect.succeed("2026000001")),
    issue: mock(() => Effect.die("issuance is not used by delivery")),
    issueManual: mock(() => Effect.die("issuance is not used by delivery")),
    list: mock(() => Effect.succeed([])),
  };
  const accountingSnapshots = {
    findByPaymentAttemptId: mock(() =>
      Effect.succeed(options.source ?? source)
    ),
  };
  const emailService: EmailService = {
    send:
      options.send ??
      mock((message: EmailMessage) => {
        options.sentMessages.push(message);
        return Effect.succeed(
          sentResult(`email-${options.sentMessages.length}`)
        );
      }),
    sendTemplate: mock(() => Effect.die("sendTemplate is not used")),
    verify: Effect.succeed(true),
  };

  return {
    accountingSnapshots,
    claim,
    claimResend,
    deliveries,
    emailService,
    invoices,
    markAccepted,
    markFailed,
  };
};

function makeSourceSnapshot(email: string): AccountingDocumentSnapshot {
  const {
    paymentAttemptId: _paymentAttemptId,
    invoiceNumber: _invoiceNumber,
    issuedAt: _issuedAt,
    fulfilledAt: _fulfilledAt,
    paidAt: _paidAt,
    supplier: invoiceSupplier,
    ...identity
  } = document;
  const { commercialRegister: _commercialRegister, ...supplier } =
    invoiceSupplier;

  return Schema.decodeUnknownSync(accountingDocumentSnapshotSchema)({
    ...identity,
    supplier,
    delivery: { email },
  });
}
