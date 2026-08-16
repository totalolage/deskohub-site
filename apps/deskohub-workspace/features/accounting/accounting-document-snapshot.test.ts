import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { accountingDocumentSnapshots } from "@/db/schema";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote.test-utils";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import {
  CENSORED_LOG_VALUE,
  censorDatabaseQueryParams,
} from "@/shared/backend/logging/censorship";
import {
  accountingDocumentSnapshotSchema,
  decodeStoredAccountingDocumentSnapshot,
  encodeStoredAccountingDocumentSnapshot,
  getAccountingDocumentOrderId,
  makeGoodsAccountingDocumentSnapshot,
  makeReservationAccountingDocumentSnapshot,
} from "./accounting-document-snapshot";
import {
  decryptAccountingSnapshot,
  encryptAccountingSnapshot,
} from "./backend/accounting-snapshot-sql";
import {
  makeGoodsAccountingDocumentSnapshotForTest,
  makeGoodsAccountingDocumentSnapshotInputForTest,
} from "./invoice.test-utils";

const coworkOrder = {
  entryTier: "basic",
  coffee: true,
} satisfies CoworkReservationQuoteOrder;

const prepared = {
  kind: "cowork",
  reservation: {
    kind: "cowork",
    ...coworkOrder,
    date: "2099-01-01",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420 777 777 777",
  },
  quote: buildCoworkReservationQuote(coworkOrder),
} as PreparedCustomerQuote;

const makeSnapshot = () =>
  makeReservationAccountingDocumentSnapshot({
    workspaceReservationId: "reservation-id",
    dotyposReservationId: "dotypos-reservation-id",
    dotyposCustomerId: "dotypos-customer-id",
    locale: "en-US",
    prepared,
  });

test("derives the generic order id from unchanged reservation snapshots", () => {
  expect(getAccountingDocumentOrderId(makeSnapshot())).toBe("reservation-id");
});

const officeReservation = normalizedOfficeReservationOrderSchema.make({
  kind: "office",
  startsOn: "2099-06-20",
  endsOn: "2099-06-21",
  seats: 3,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
});

const officePrepared: PreparedCustomerQuote = {
  kind: "office",
  reservation: officeReservation,
  quote: Effect.runSync(buildOfficeReservationQuote(officeReservation)),
};

describe("accounting document snapshot", () => {
  test("freezes supplier, buyer, reservation, and accepted quote facts", () => {
    expect(makeSnapshot()).toMatchObject({
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "en-US",
      supplier: {
        legalName: "Desktechub s.r.o.",
        companyId: "24531596",
        vatStatus: "not-vat-payer",
      },
      buyer: {
        kind: "person",
        legalName: "Ada Lovelace",
      },
      delivery: {
        email: "ada@example.com",
      },
      reservation: {
        kind: "cowork",
        date: "2099-01-01",
      },
      quote: prepared.quote,
    });
  });

  test("freezes only the reservation email needed for invoice delivery", () => {
    const serialized = JSON.stringify(makeSnapshot());

    expect(serialized).toContain("ada@example.com");
    expect(serialized).not.toContain("+420 777 777 777");
    expect(serialized).not.toContain('"message"');
  });

  test("freezes reconciled goods facts and server-fetched customer identity", () => {
    const snapshot = makeGoodsAccountingDocumentSnapshotForTest();

    expect(getAccountingDocumentOrderId(snapshot)).toBe("goods-order-1");
    expect(snapshot).toMatchObject({
      orderId: "goods-order-1",
      dotyposCustomerId: "goods-customer-1",
      fulfilledAt: "2026-08-11T23:30:00.000Z",
      billing: { purpose: "personal", invoice: "requested" },
      buyer: {
        kind: "person",
        legalName: "Synthetic Customer",
        address: { line1: "Synthetic 1", country: "CZ" },
      },
      delivery: { email: "goods-invoice@example.test" },
      totals: {
        undiscounted: { value: 15_000, exponent: 2, currency: "CZK" },
        discount: { value: 2500, exponent: 2, currency: "CZK" },
        payable: { value: 12_500, exponent: 2, currency: "CZK" },
      },
    });
    expect(snapshot.lines[0]).toMatchObject({
      description: "Sparkling water",
      quantity: 2,
      undiscountedTotal: { value: 10_000 },
      payableTotal: { value: 7500 },
      discounts: [
        { discount: { label: "Member price" }, amount: { value: 2500 } },
      ],
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("+420 700 000 000");
    expect(serialized).not.toContain('"phone"');
  });

  test("rejects goods price drift and incomplete provider billing identity", async () => {
    const input = makeGoodsAccountingDocumentSnapshotInputForTest();
    await expect(
      Effect.runPromise(
        makeGoodsAccountingDocumentSnapshot({
          ...input,
          displayedQuote: {
            ...input.displayedQuote,
            discountedSubtotal: {
              ...input.displayedQuote.discountedSubtotal,
              value: 12_499,
            },
          },
        })
      )
    ).rejects.toMatchObject({
      _tag: "GoodsAccountingDocumentSnapshotInputError",
    });
    await expect(
      Effect.runPromise(
        makeGoodsAccountingDocumentSnapshot({
          ...input,
          customer: {
            ...input.customer,
            companyName: null,
            companyId: null,
          },
          billing: { purpose: "business", invoice: "required" },
        })
      )
    ).rejects.toMatchObject({
      _tag: "GoodsAccountingDocumentSnapshotInputError",
    });
  });

  test("rejects stored goods totals that do not reconcile", async () => {
    const snapshot = makeGoodsAccountingDocumentSnapshotForTest();

    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          totals: {
            ...snapshot.totals,
            payable: { ...snapshot.totals.payable, value: 12_499 },
          },
        })
      )
    ).rejects.toBeDefined();
  });

  test("keeps frozen goods PII out of SQL and uncensored query parameters", () => {
    const snapshotJson = JSON.stringify(
      makeGoodsAccountingDocumentSnapshotForTest()
    );
    const query = new PgDialect().sqlToQuery(
      encryptAccountingSnapshot(snapshotJson, "synthetic-encryption-key")
    );

    expect(query.sql).not.toContain("Synthetic Customer");
    expect(query.sql).not.toContain("goods-invoice@example.test");
    expect(censorDatabaseQueryParams(query.sql, query.params)).not.toContain(
      snapshotJson
    );
  });

  test("freezes office reservation and accepted quote facts", async () => {
    const snapshot = makeReservationAccountingDocumentSnapshot({
      workspaceReservationId: "office-reservation-id",
      dotyposReservationId: "dotypos-office-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "en-US",
      prepared: officePrepared,
    });

    expect(snapshot).toMatchObject({
      reservation: {
        kind: "office",
        startsOn: "2099-06-20",
        endsOn: "2099-06-21",
        seats: 3,
      },
      quote: officePrepared.quote,
    });
    await expect(
      Effect.runPromise(
        Schema.decodeUnknownEffect(accountingDocumentSnapshotSchema, {
          onExcessProperty: "error",
        })(snapshot)
      )
    ).resolves.toEqual(snapshot);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain("ada@example.com");
    expect(serialized).not.toContain("+420 777 777 777");
  });

  test("supports a reservation-specific business billing identity", () => {
    const buyer = {
      kind: "business" as const,
      legalName: "Analytical Engines s.r.o.",
      companyId: "12345678",
      vatId: "CZ12345678",
      address: {
        line1: "Počernická 1",
        city: "Praha",
        postalCode: "100 00",
        country: "CZ",
      },
    };
    const snapshot = makeReservationAccountingDocumentSnapshot({
      workspaceReservationId: "business-reservation",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "cs-CZ",
      prepared: {
        ...prepared,
        reservation: {
          ...prepared.reservation,
          billing: { purpose: "business", invoice: "required", buyer },
        },
      },
    });

    expect(snapshot.buyer).toEqual(buyer);
  });

  test("round-trips strictly through the schema", async () => {
    const snapshot = makeSnapshot();
    const decode = Schema.decodeUnknownEffect(
      accountingDocumentSnapshotSchema,
      {
        onExcessProperty: "error",
      }
    );

    await expect(Effect.runPromise(decode(snapshot))).resolves.toEqual(
      snapshot
    );
    await expect(
      Effect.runPromise(decode({ ...snapshot, unexpected: true }))
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(decode({ ...snapshot, schemaVersion: 1 }))
    ).rejects.toBeDefined();
  });

  test("decodes historical snapshots without an invoice instruction", async () => {
    const { billing: _billing, ...historicalSnapshot } = makeSnapshot();

    const decoded = await Effect.runPromise(
      decodeStoredAccountingDocumentSnapshot(historicalSnapshot)
    );

    expect(decoded.billing).toBeUndefined();
  });

  test("rejects schema-version metadata from stored snapshots", async () => {
    const snapshot = makeSnapshot();

    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          schemaVersion: 1,
        })
      )
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          unexpected: true,
        })
      )
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          schemaVersion: 2,
        })
      )
    ).rejects.toBeDefined();
  });

  test("writes versionless snapshots", () => {
    const snapshot = makeSnapshot();

    expect(encodeStoredAccountingDocumentSnapshot(snapshot)).toEqual(snapshot);
  });

  test("parameterizes both plaintext and key in pgcrypto SQL", () => {
    const plaintextSentinel = "PRIVATE-INVOICE-SNAPSHOT-SENTINEL";
    const keySentinel = "PRIVATE-INVOICE-KEY-SENTINEL-123456789";
    const query = new PgDialect().sqlToQuery(
      encryptAccountingSnapshot(plaintextSentinel, keySentinel)
    );

    expect(query.sql).toBe(
      "pgp_sym_encrypt(/* deskohub:sensitive */ $1, /* deskohub:sensitive */ $2, $3)"
    );
    expect(query.sql).not.toContain(plaintextSentinel);
    expect(query.sql).not.toContain(keySentinel);
    expect(query.params).toEqual([
      plaintextSentinel,
      keySentinel,
      "cipher-algo=aes256,compress-algo=1,unicode-mode=1",
    ]);
    expect(censorDatabaseQueryParams(query.sql, query.params)).toEqual([
      CENSORED_LOG_VALUE,
      CENSORED_LOG_VALUE,
      "cipher-algo=aes256,compress-algo=1,unicode-mode=1",
    ]);
  });

  test("marks only the pgcrypto decryption key as sensitive", () => {
    const keySentinel = "PRIVATE-INVOICE-KEY-SENTINEL-123456789";
    const query = new PgDialect().sqlToQuery(
      decryptAccountingSnapshot(
        accountingDocumentSnapshots.encryptedSnapshot,
        keySentinel
      )
    );

    expect(query.sql).toContain(
      'pgp_sym_decrypt("accounting_document_snapshots"."encrypted_snapshot", /* deskohub:sensitive */ $1)'
    );
    expect(query.params).toEqual([keySentinel]);
    expect(censorDatabaseQueryParams(query.sql, query.params)).toEqual([
      CENSORED_LOG_VALUE,
    ]);
  });

  test("resolves a nonempty environment passphrase by key ID", async () => {
    const { AccountingSnapshotKeyService } = await import(
      "./backend/accounting-snapshot-key.service"
    );
    const key = await Effect.gen(function* () {
      const keys = yield* AccountingSnapshotKeyService;
      return yield* keys.getActive;
    }).pipe(
      Effect.provide(AccountingSnapshotKeyService.Default),
      Effect.runPromise
    );

    expect(key.id).toBe("K202608");
    expect(key.secret).toBe("synthetic accounting snapshot secret!");
  });
});
