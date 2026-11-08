import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { CustomerAccountAccessError } from "@/features/account";
import { CustomerAccountReservationOwnership } from "@/features/account/backend/customer-account-reservation-ownership";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { ReviewSandbox } from "@/features/review-accounts";
import { makeCoworkInvoiceDocument } from "../invoice.test-utils";
import {
  InvoiceRepository,
  type ReservationInvoice,
} from "./invoice.repository";
import { InvoiceStorageError } from "./invoice-reads";
import { ReservationInvoicePdfService } from "./reservation-invoice-pdf.service";

const orderId = workspaceReservationIdSchema.make("reservation-1");
const signedInAccountId = customerAccountIdSchema.make("account-id");
const reservationCustomerId = "reservation-customer";

const document = makeCoworkInvoiceDocument("en-US");
const issuedInvoice = {
  id: invoiceIdSchema.make("01980000-0000-7000-8000-000000000001"),
  workspaceReservationId: orderId,
  paymentAttemptId: "payment-attempt",
  dotyposCustomerId: reservationCustomerId,
  invoiceNumber: document.invoiceNumber,
  issuedAt: Temporal.Instant.from(document.issuedAt),
  document,
} as ReservationInvoice;

type Visitor =
  /** Signed in with the account linked to the reservation's customer. */
  | "customer"
  /** Signed in with the account that booked it for another customer. */
  | "author"
  /** Signed in with an unrelated account. */
  | "other-account"
  /** Not signed in. */
  | "anonymous"
  /** The signed-in account can't be read. */
  | "unreadable-account";

const runGetPdf = async (options: {
  readonly visitor: Visitor;
  readonly accessToken?: ReservationAccessToken;
  readonly reservationExists?: boolean;
  readonly invoice?: ReservationInvoice | null | "unreadable";
}) => {
  const reservation = {
    dotyposCustomerId: reservationCustomerId,
    authorAccountId:
      options.visitor === "author"
        ? signedInAccountId
        : customerAccountIdSchema.make("booking-author"),
  } as WorkspaceReservation;
  const findByReservationId = mock(() =>
    options.invoice === "unreadable"
      ? Effect.fail(
          new InvoiceStorageError({
            operation: "decrypt",
            paymentAttemptId: orderId,
            message: "Synthetic decryption failure.",
          })
        )
      : Effect.succeed(
          options.invoice === undefined ? issuedInvoice : options.invoice
        )
  );
  const ownership = Layer.succeed(CustomerAccountReservationOwnership, {
    activeAccountId:
      options.visitor === "anonymous" ||
      options.visitor === "unreadable-account"
        ? Effect.fail(
            new CustomerAccountAccessError({
              reason:
                options.visitor === "anonymous"
                  ? "unauthenticated"
                  : "unavailable",
            })
          )
        : Effect.succeed(signedInAccountId),
    resolve: Effect.succeed({
      accountId: signedInAccountId,
      dotyposCustomerId:
        options.visitor === "customer"
          ? reservationCustomerId
          : "another-customer",
    }),
  });

  const result = await Effect.gen(function* () {
    const service = yield* ReservationInvoicePdfService;
    return yield* service.getPdf({
      orderId,
      locale: "en-US",
      accessToken: options.accessToken,
    });
  }).pipe(
    Effect.provide(ReservationInvoicePdfService.Default),
    Effect.provide(ReservationAuthorizationService.Default),
    Effect.provide(
      Layer.mergeAll(
        ownership,
        Layer.mock(WorkspaceReservationRepository, {
          findById: () =>
            Effect.succeed(
              options.reservationExists === false ? null : reservation
            ),
        }),
        Layer.mock(ReviewSandbox, { isOrderOf: () => Effect.succeed(false) }),
        Layer.mock(InvoiceRepository, { findByReservationId })
      )
    ),
    Effect.result,
    Effect.runPromise
  );

  return { result, findByReservationId };
};

const expectPdfFile = (
  result: Awaited<ReturnType<typeof runGetPdf>>["result"]
) => {
  if (result._tag !== "Success")
    throw new Error(`Expected a PDF, got ${result.failure._tag}.`);
  expect(Buffer.from(result.success.bytes).subarray(0, 5).toString()).toBe(
    "%PDF-"
  );
  expect(result.success.fileName).toBe(`${document.invoiceNumber}.pdf`);
};

describe("ReservationInvoicePdfService", () => {
  test("gives the reservation's customer its issued invoice as a PDF named by the invoice number", async () => {
    const { result, findByReservationId } = await runGetPdf({
      visitor: "customer",
    });

    expectPdfFile(result);
    expect(findByReservationId).toHaveBeenCalledWith(orderId);
  });

  test("gives the invoice to a valid emailed link without an account", async () => {
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({ orderId, locale: "en-US" })
    );

    const { result } = await runGetPdf({ visitor: "anonymous", accessToken });

    expectPdfFile(result);
  });

  test.each([
    ["the author who booked it for another customer", { visitor: "author" }],
    ["an unrelated account", { visitor: "other-account" }],
    ["a visitor without an account or link", { visitor: "anonymous" }],
    ["a missing order", { visitor: "customer", reservationExists: false }],
  ] as const)(
    "reports not found to %s without reading the invoice",
    async (_label, options) => {
      const { result, findByReservationId } = await runGetPdf(options);

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ReservationInvoiceNotFoundError", orderId },
      });
      expect(findByReservationId).not.toHaveBeenCalled();
    }
  );

  test("reports not found to a valid emailed link for an order that no longer exists", async () => {
    const accessToken = await Effect.runPromise(
      createReservationAccessToken({ orderId, locale: "en-US" })
    );

    const { result } = await runGetPdf({
      visitor: "anonymous",
      accessToken,
      reservationExists: false,
      invoice: null,
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ReservationInvoiceNotFoundError", orderId },
    });
  });

  // The repository finds no invoice for a reservation that is unpaid,
  // unfulfilled, or fulfilled without one (invoice.repository.postgres.test.ts).
  test("reports not issued while no invoice exists for the reservation", async () => {
    const { result } = await runGetPdf({ visitor: "customer", invoice: null });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ReservationInvoiceNotIssuedError", orderId },
    });
  });

  test("keeps an unreadable account in the error channel instead of reporting not found", async () => {
    const { result, findByReservationId } = await runGetPdf({
      visitor: "unreadable-account",
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ReservationAuthorizationUnavailableError", orderId },
    });
    expect(findByReservationId).not.toHaveBeenCalled();
  });

  test("keeps an invoice storage failure in the error channel", async () => {
    const { result } = await runGetPdf({
      visitor: "customer",
      invoice: "unreadable",
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "InvoiceStorageError", operation: "decrypt" },
    });
  });
});
