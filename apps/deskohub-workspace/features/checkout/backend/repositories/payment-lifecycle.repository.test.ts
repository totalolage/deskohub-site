import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { getTableColumns } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { paymentAttempts } from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  accountingDocumentSnapshotSchema,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import {
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import {
  getAccountingSnapshotServiceDate,
  PaymentLifecycleRepository,
  validateCommitmentServiceDate,
  validateDiscountCommitment,
  validateInternalPaymentCommitment,
} from "./payment-lifecycle.repository";

const readRepository = () =>
  Bun.file(
    new URL("./payment-lifecycle.repository.ts", import.meta.url)
  ).text();

const sliceFrom = (source: string, startNeedle: string, endNeedle: string) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const makeSource = (): AccountingDocumentSnapshot => {
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
    billing: {
      purpose: "personal",
      invoice: "none",
    },
    delivery: { email: "synthetic@example.test" },
  });
};

const makeAccountingSnapshot = (
  prepared: PreparedCustomerQuote
): AccountingDocumentSnapshot =>
  makeAccountingDocumentSnapshot({
    workspaceReservationId: workspaceReservationIdSchema.make(
      "service-date-test-reservation"
    ),
    dotyposReservationId: DotyposReservationIdSchema.make(
      "service-date-test-reservation"
    ),
    dotyposCustomerId: DotyposCustomerIdSchema.make(
      "service-date-test-customer"
    ),
    locale: "en-US",
    prepared,
  });

const makeCoworkSnapshot = (date: string): AccountingDocumentSnapshot => {
  const reservation = normalizedCoworkReservationOrderSchema.make({
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
    date,
    name: "Synthetic Customer",
    email: "service-date@example.test",
    phone: "+420 700 000 000",
    billing: defaultReservationBillingSelection,
  });

  return makeAccountingSnapshot({
    kind: "cowork",
    reservation,
    quote: Effect.runSync(buildCoworkReservationQuote(reservation)),
  });
};

const makeOfficeSnapshot = (
  startsOn: string,
  endsOn: string
): AccountingDocumentSnapshot => {
  const reservation = normalizedOfficeReservationOrderSchema.make({
    kind: "office",
    startsOn,
    endsOn,
    seats: 2,
    name: "Synthetic Customer",
    email: "service-date@example.test",
    phone: "+420 700 000 000",
    billing: defaultReservationBillingSelection,
  });

  return makeAccountingSnapshot({
    kind: "office",
    reservation,
    quote: Effect.runSync(buildOfficeReservationQuote(reservation)),
  });
};

const makeMeetingRoomSnapshot = (input: {
  readonly reservationDate: string;
  readonly startsAt: string;
  readonly endsAt: string;
}): AccountingDocumentSnapshot => {
  const reservation = normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "day", amount: 1 },
    reservationDate: input.reservationDate,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    name: "Synthetic Customer",
    email: "service-date@example.test",
    phone: "+420 700 000 000",
    billing: defaultReservationBillingSelection,
  });
  const quote = Effect.runSync(getMeetingRoomReservationQuote(reservation));

  return makeAccountingSnapshot({
    kind: "meeting-room",
    reservation,
    quote: {
      ...quote,
      fingerprint: getReservationQuoteFingerprint(reservation, quote),
    },
  });
};

const makeRepository = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const repository = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* PaymentLifecycleRepository;
    }).pipe(
      Effect.provide(
        PaymentLifecycleRepository.Default.pipe(Layer.provide(recording.layer))
      )
    )
  );
  return { recording, repository };
};

// The recording database answers in pg's array row mode: build positional
// rows from the table's column order.
const attemptRow = (): readonly unknown[] =>
  Object.entries(getTableColumns(paymentAttempts)).map(([propertyKey]) =>
    propertyKey === "id" ? "attempt-1" : null
  );

describe("PaymentLifecycleRepository", () => {
  test("owns attempt, reservation, and snapshot admission in one transaction", async () => {
    const { recording, repository } = await makeRepository();
    const snapshot = makeSource();
    recording.setRows([
      // BEGIN
      [
        [
          "reservation-1",
          "dotypos-customer-1",
          "dotypos-reservation-1",
          "2099-01-01T00:00:00Z",
        ],
      ],
      [attemptRow()],
      [], // snapshot insert
      [["reservation-1"]], // linking the attempt to the held reservation
    ]);

    await Effect.runPromise(
      repository.createPendingNexiAttempt({
        workspaceReservationId: "reservation-1" as never,
        providerOrderId: "order-1" as never,
        amount: snapshot.quote.payment.expectedPrice,
        commitment: makeDiscountCommitment({
          product: { kind: "cowork", tier: "basic" },
          reservationDate: getAccountingSnapshotServiceDate(snapshot),
          applications: [],
        }),
        locale: "en-US",
        accountingSnapshot: snapshot,
      })
    ).catch(() => undefined);

    const statements = recording.statements;
    expect(statements[0].sql.toLowerCase()).toBe("begin");
    const reservationLockIndex = statements.findIndex(
      ({ sql }) =>
        sql.includes('from "workspace_reservations"') &&
        sql.includes("for update")
    );
    const attemptInsertIndex = statements.findIndex(({ sql }) =>
      sql.includes('insert into "payment_attempts"')
    );
    const snapshotInsertIndex = statements.findIndex(({ sql }) =>
      sql.includes('insert into "accounting_document_snapshots"')
    );
    const linkUpdateIndex = statements.findIndex(
      ({ sql }) =>
        sql.startsWith('update "workspace_reservations"') &&
        sql.includes('"active_payment_attempt_id"')
    );

    expect(reservationLockIndex).toBeGreaterThan(0);
    expect(attemptInsertIndex).toBeGreaterThan(reservationLockIndex);
    expect(snapshotInsertIndex).toBeGreaterThan(attemptInsertIndex);
    expect(linkUpdateIndex).toBeGreaterThan(snapshotInsertIndex);
  });

  test("rejects inconsistent committed money before opening a transaction", async () => {
    const discountId =
      Schema.decodeUnknownSync(discountIdSchema)("public-discount");
    const application = {
      discount: {
        id: discountId,
        label: "Test discount",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: {
        value: 35_000,
        exponent: 2,
        currency: "CZK",
      },
      amount: { value: 7000, exponent: 2, currency: "CZK" },
      subtotalAfter: {
        value: 27_999,
        exponent: 2,
        currency: "CZK",
      },
    };
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      reservationDate: "2026-07-15",
      applications: [
        {
          application,
          candidate: {
            discount: application.discount,
            provenance: {
              providerNamespace: "test",
              providerReference: "test",
            },
          },
        },
      ],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateDiscountCommitment(getDiscountCommitmentPayload(commitment))
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });

  test("rejects an internal payment without a full-discount commitment", async () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      reservationDate: "2026-07-15",
      applications: [],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateInternalPaymentCommitment(
          getDiscountCommitmentPayload(commitment),
          {
            value: 0,
            exponent: 2,
            currency: "CZK",
          }
        )
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });

  test("derives the authoritative service date from the validated accounting snapshot", () => {
    const coworkSnapshot = makeCoworkSnapshot("2026-07-15");
    const officeSnapshot = makeOfficeSnapshot("2026-07-15", "2026-07-20");
    const winterMeetingRoomSnapshot = makeMeetingRoomSnapshot({
      reservationDate: "2026-01-16",
      startsAt: "2026-01-15T23:30:00Z",
      endsAt: "2026-01-16T00:30:00Z",
    });
    const springMeetingRoomSnapshots = [
      makeMeetingRoomSnapshot({
        reservationDate: "2026-03-29",
        startsAt: "2026-03-29T00:30:00Z",
        endsAt: "2026-03-29T01:30:00Z",
      }),
      makeMeetingRoomSnapshot({
        reservationDate: "2026-03-29",
        startsAt: "2026-03-29T01:30:00Z",
        endsAt: "2026-03-29T02:30:00Z",
      }),
    ];
    const fallMeetingRoomSnapshots = [
      makeMeetingRoomSnapshot({
        reservationDate: "2026-10-25",
        startsAt: "2026-10-25T00:30:00Z",
        endsAt: "2026-10-25T01:30:00Z",
      }),
      makeMeetingRoomSnapshot({
        reservationDate: "2026-10-25",
        startsAt: "2026-10-25T01:30:00Z",
        endsAt: "2026-10-25T02:30:00Z",
      }),
    ];

    expect(getAccountingSnapshotServiceDate(coworkSnapshot)).toBe("2026-07-15");
    expect(getAccountingSnapshotServiceDate(officeSnapshot)).toBe("2026-07-15");
    // Prague is UTC+1 in winter: 23:30Z is already the next local day.
    expect(getAccountingSnapshotServiceDate(winterMeetingRoomSnapshot)).toBe(
      "2026-01-16"
    );
    // Spring forward (CET -> CEST): both instants resolve on the transition day.
    for (const snapshot of springMeetingRoomSnapshots) {
      expect(getAccountingSnapshotServiceDate(snapshot)).toBe("2026-03-29");
    }
    // Fall back (CEST -> CET): both offsets still resolve on the same day.
    for (const snapshot of fallMeetingRoomSnapshots) {
      expect(getAccountingSnapshotServiceDate(snapshot)).toBe("2026-10-25");
    }
  });

  test("rejects a commitment whose service date no longer matches the accounting snapshot", async () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      reservationDate: "2026-07-15",
      applications: [],
    });
    const payload = getDiscountCommitmentPayload(commitment);

    const mismatch = await Effect.runPromise(
      Effect.result(validateCommitmentServiceDate(payload, "2026-07-16"))
    );
    expect(mismatch).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "claim_conflict",
      },
    });

    const match = await Effect.runPromise(
      Effect.result(validateCommitmentServiceDate(payload, "2026-07-15"))
    );
    expect(match._tag).toBe("Success");
  });

  test("rechecks the locked discount code service window for the snapshot date and leaves vouchers exempt", async () => {
    const source = await readRepository();
    const reserveClaim = sliceFrom(
      source,
      'const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")',
      'export const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")'
    );

    expect(reserveClaim).toContain(
      "isReservationServiceDateEligible(stored.code, input.reservationDate)"
    );
    expect(reserveClaim).toContain('"service_date_ineligible"');
    // The eligibility recheck runs only for discount-code claims.
    expect(reserveClaim).toMatch(
      /stored\.kind === "discount_code" &&\n\s+!isReservationServiceDateEligible/
    );
  });
});
