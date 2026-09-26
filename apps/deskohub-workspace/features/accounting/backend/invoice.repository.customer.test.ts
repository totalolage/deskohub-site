import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import {
  CENSORED_LOG_VALUE,
  censorDatabaseQueryParams,
} from "@/shared/backend/logging/censorship";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import {
  AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { InvoiceRepository } from "./invoice.repository";

mock.module("server-only", () => ({}) as never);

const issuedAtIso = "2026-08-12T12:34:56.789Z";
const invoiceUuid = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23";
const ownerId = "dotypos-customer-1";
const otherOwnerId = "dotypos-customer-2";

const makeHarness = async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const snapshotLayer = Layer.succeed(
    AccountingDocumentSnapshotRepository,
    AccountingDocumentSnapshotRepository.of({
      findByPaymentAttemptId: () => Effect.die("unused in these tests"),
    } as never)
  );
  const keysLayer = Layer.succeed(
    AccountingSnapshotKeyService,
    AccountingSnapshotKeyService.of({
      getActive: Effect.succeed({
        id: "key-1" as never,
        secret: "synthetic-secret",
      }),
      getById: (keyId: string) =>
        keyId === "key-1"
          ? Effect.succeed({ id: "key-1" as never, secret: "synthetic-secret" })
          : Effect.fail(
              new AccountingSnapshotKeyError({
                keyId,
                message: "Synthetic key is unavailable.",
              })
            ),
    } as never)
  );
  const repository = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* InvoiceRepository;
    }).pipe(
      Effect.provide(
        InvoiceRepository.Default.pipe(
          Layer.provide(snapshotLayer),
          Layer.provide(keysLayer),
          Layer.provide(recording.layer)
        )
      )
    )
  );
  return { recording, repository };
};

// Canned rows are positional arrays in the selected column order.
const metadataRow = (id: string) => [id, "key-1", issuedAtIso];
describe("customer-scoped invoice repository", () => {
  test("filters the ledger by owner in SQL before any decryption", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([
      [metadataRow(invoiceUuid)],
      [[invoiceUuid, JSON.stringify(makeCoworkInvoiceDocument("en-US"))]],
    ]);

    const summaries = await Effect.runPromise(
      repository.listForCustomer(ownerId as never)
    );

    const decryptIndex = recording.statements.findIndex(({ sql }) =>
      sql.includes("pgp_sym_decrypt")
    );
    expect(decryptIndex).toBeGreaterThan(-1);
    const ownerIndex = recording.statements.findIndex(({ sql }) =>
      sql.includes("dotypos_customer_id")
    );
    expect(ownerIndex).toBeGreaterThan(-1);
    expect(ownerIndex).toBeLessThan(decryptIndex);
    expect(recording.statements[0]?.params).toContain(ownerId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.id).toBe(invoiceUuid);
  });

  test("returns an empty list without touching ciphertext for an owner without invoices", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([[]]);

    const summaries = await Effect.runPromise(
      repository.listForCustomer(otherOwnerId as never)
    );

    expect(summaries).toEqual([]);
    expect(
      recording.statements.some(({ sql }) => sql.includes("pgp_sym_decrypt"))
    ).toBe(false);
    expect(recording.statements[0]?.params).toContain(otherOwnerId);
  });

  test("includes manual and reservation invoices in one ledger listing", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([
      [metadataRow("manual-invoice"), metadataRow("reservation-invoice")],
      [
        [
          "manual-invoice",
          JSON.stringify(makeTestManualInvoiceDocument("en-US")),
        ],
        [
          "reservation-invoice",
          JSON.stringify(makeCoworkInvoiceDocument("en-US")),
        ],
      ],
    ]);

    const summaries = await Effect.runPromise(
      repository.listForCustomer(ownerId as never)
    );

    expect(summaries.map((summary) => summary.id).toSorted()).toEqual([
      "manual-invoice",
      "reservation-invoice",
    ]);
    expect(
      summaries.find((summary) => summary.id === "reservation-invoice")
        ?.paymentStatus
    ).toBe("paid");
  });

  test("fails closed when a listed document cannot be decrypted", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([[metadataRow(invoiceUuid)]]);
    recording.failStatementsMatching(
      /pgp_sym_decrypt/,
      new Error("synthetic decrypt failure")
    );

    const outcome = await Effect.runPromise(
      repository.listForCustomer(ownerId as never).pipe(Effect.result)
    );

    // The failure happens at the decryption query itself, after the metadata
    // read and key lookup succeeded.
    const decryptAttempt = recording.statements.find(({ sql }) =>
      sql.includes("pgp_sym_decrypt")
    );
    expect(decryptAttempt?.failed).toBe(true);
    expect(outcome.success).toBeUndefined();
    expect(outcome.failure?._tag).toBe("InvoiceStorageError");
    const serializedFailure = JSON.stringify(outcome);
    expect(serializedFailure).not.toContain("synthetic-secret");
    expect(serializedFailure).not.toContain("synthetic decrypt failure");
    // The decryption secret stays marked sensitive in the recorded statement
    // and the production query-log censor redacts it from the recorded params.
    expect(decryptAttempt?.sql).toContain("deskohub:sensitive");
    const censoredParams = decryptAttempt
      ? censorDatabaseQueryParams(decryptAttempt.sql, decryptAttempt.params)
      : [];
    expect(JSON.stringify(censoredParams)).not.toContain("synthetic-secret");
    expect(censoredParams[0]).toBe(CENSORED_LOG_VALUE);
  });

  test("fails closed when a listed invoice references a missing key", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([[["key-missing", "key-missing", issuedAtIso]]]);

    const outcome = await Effect.runPromise(
      repository.listForCustomer(ownerId as never).pipe(Effect.result)
    );

    expect(outcome.success).toBeUndefined();
    expect(outcome.failure?._tag).toBe("InvoiceStorageError");
    // The key lookup fails before any decryption query runs.
    expect(
      recording.statements.some(({ sql }) => sql.includes("pgp_sym_decrypt"))
    ).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain("synthetic-secret");
  });

  test("fails closed when a decrypted document fails schema decoding", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([
      [metadataRow(invoiceUuid)],
      [[invoiceUuid, '{"documentKind": "unknown"}']],
    ]);

    const outcome = await Effect.runPromise(
      repository.listForCustomer(ownerId as never).pipe(Effect.result)
    );

    expect(outcome.failure?._tag).toBe("InvoiceStorageError");
  });

  test("never returns another customer's invoice for a guessed id", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([[]]);

    const invoice = await Effect.runPromise(
      repository.findForCustomer(ownerId as never, invoiceUuid)
    );

    expect(invoice).toBeNull();
    const [firstStatement] = recording.statements;
    expect(firstStatement?.sql).toContain("dotypos_customer_id");
    expect(firstStatement?.params).toContain(ownerId);
    expect(firstStatement?.params).toContain(invoiceUuid);
    expect(
      recording.statements.some(({ sql }) => sql.includes("pgp_sym_decrypt"))
    ).toBe(false);
  });

  test("maps a malformed invoice id to the common not-found null", async () => {
    const { recording, repository } = await makeHarness();
    recording.setRows([[]]);

    const invoice = await Effect.runPromise(
      repository.findForCustomer(ownerId as never, "not-a-uuid")
    );

    expect(invoice).toBeNull();
    expect(recording.statements).toEqual([]);
  });

  test("decrypts an owned invoice only after the owner filter matched", async () => {
    const { recording, repository } = await makeHarness();
    const document = makeCoworkInvoiceDocument("en-US");
    recording.setRows([
      [["key-1"]],
      [
        [
          invoiceUuid,
          "reservation-1",
          "payment-attempt-1",
          ownerId,
          document.invoiceNumber,
          issuedAtIso,
          JSON.stringify(document),
        ],
      ],
    ]);

    const invoice = await Effect.runPromise(
      repository.findForCustomer(ownerId as never, invoiceUuid)
    );

    expect(invoice?.dotyposCustomerId).toBe(ownerId);
    const metadataIndex = recording.statements.findIndex(({ sql }) =>
      sql.includes("dotypos_customer_id")
    );
    const decryptIndex = recording.statements.findIndex(({ sql }) =>
      sql.includes("pgp_sym_decrypt")
    );
    expect(metadataIndex).toBeGreaterThan(-1);
    expect(decryptIndex).toBeGreaterThan(metadataIndex);
    expect(recording.statements[metadataIndex]?.params).toContain(ownerId);
  });
});
