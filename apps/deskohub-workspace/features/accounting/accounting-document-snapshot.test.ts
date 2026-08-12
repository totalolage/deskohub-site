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
  makeAccountingDocumentSnapshot,
} from "./accounting-document-snapshot";
import { AccountingSnapshotKeyService } from "./backend/accounting-snapshot-key.service";
import {
  decryptAccountingSnapshot,
  encryptAccountingSnapshot,
} from "./backend/accounting-snapshot-sql";

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
  makeAccountingDocumentSnapshot({
    workspaceReservationId: "reservation-id",
    dotyposReservationId: "dotypos-reservation-id",
    dotyposCustomerId: "dotypos-customer-id",
    locale: "en-US",
    prepared,
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
      reservation: {
        kind: "cowork",
        date: "2099-01-01",
      },
      quote: prepared.quote,
    });
  });

  test("does not copy contact or free-form customer data", () => {
    const serialized = JSON.stringify(makeSnapshot());

    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("+420 777 777 777");
    expect(serialized).not.toContain('"message"');
  });

  test("freezes office reservation and accepted quote facts", async () => {
    const snapshot = makeAccountingDocumentSnapshot({
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
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("+420 777 777 777");
  });

  test("supports a reservation-specific business billing identity", () => {
    const snapshot = makeAccountingDocumentSnapshot({
      workspaceReservationId: "business-reservation",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      locale: "cs-CZ",
      prepared,
      buyer: {
        kind: "business",
        legalName: "Analytical Engines s.r.o.",
        companyId: "12345678",
        vatId: "CZ12345678",
        address: {
          line1: "Počernická 1",
          city: "Praha",
          postalCode: "100 00",
          country: "CZ",
        },
      },
    });

    expect(snapshot.buyer).toEqual({
      kind: "business",
      legalName: "Analytical Engines s.r.o.",
      companyId: "12345678",
      vatId: "CZ12345678",
      address: {
        line1: "Počernická 1",
        city: "Praha",
        postalCode: "100 00",
        country: "CZ",
      },
    });
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

  test("reads previously stored snapshots without retaining obsolete metadata", async () => {
    const snapshot = makeSnapshot();

    await expect(
      Effect.runPromise(
        decodeStoredAccountingDocumentSnapshot({
          ...snapshot,
          schemaVersion: 1,
        })
      )
    ).resolves.toEqual(snapshot);
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

  test("keeps new writes readable by overlapping legacy instances", () => {
    const snapshot = makeSnapshot();

    expect(encodeStoredAccountingDocumentSnapshot(snapshot)).toEqual({
      ...snapshot,
      schemaVersion: 1,
    });
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
    const key = await Effect.gen(function* () {
      const keys = yield* AccountingSnapshotKeyService;
      return yield* keys.getActive;
    }).pipe(
      Effect.provide(AccountingSnapshotKeyService.Live),
      Effect.runPromise
    );

    expect(key.id).toBe("K202608");
    expect(key.secret).toBe("synthetic accounting snapshot secret!");
  });
});
