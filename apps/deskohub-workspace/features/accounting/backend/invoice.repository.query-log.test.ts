import "@/shared/polyfills/temporal";

import { describe, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { manualInvoiceInputSchema } from "@/features/accounting/manual-invoice";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
  type IAccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";
import { InvoiceRepository } from "./invoice.repository";

const issuer = {
  accountId: customerAccountIdSchema.make(
    "01980000-0000-7000-8000-000000000301"
  ),
  email: testEmailAddress("invoice-query-log-issuer"),
};
const key: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K202608"),
  secret: "synthetic query log snapshot key",
};
const keys: IAccountingSnapshotKeyService = {
  getActive: Effect.succeed(key),
  getById: (keyId) =>
    Effect.fail(
      new AccountingSnapshotKeyError({
        keyId,
        message: "Synthetic query log key is unavailable.",
      })
    ),
};

describe("InvoiceRepository query logging", () => {
  test("censors the issuing administrator email in a manual invoice actor insert", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[], [], [], [[1]], [], [], []]);

    const input = Schema.decodeUnknownSync(manualInvoiceInputSchema)({
      invoiceId: "01980000-0000-7000-8000-000000000302",
      dotyposCustomerId: DotyposCustomerIdSchema.make(
        "synthetic-query-log-customer"
      ),
      buyer: {
        kind: "person",
        legalName: "Synthetic Invoice Customer",
        address: {
          line1: "Synthetic 1",
          city: "Praha",
          postalCode: "100 00",
          country: "CZ",
        },
      },
      deliveryEmail: testEmailAddress("invoice-query-log-delivery"),
      locale: "en-US",
      serviceDate: "2099-01-01",
      payment: { status: "paid", date: "2099-01-01" },
      currency: "CZK",
      lines: [{ description: "Synthetic line", price: "100.00" }],
      provenance: { source: "admin-ui", actor: issuer.email },
    });
    const baseLayer = Layer.merge(
      recording.layer,
      Layer.succeed(
        AccountingSnapshotKeyService,
        AccountingSnapshotKeyService.of(keys)
      )
    );
    const repositoryLayer = InvoiceRepository.Default.pipe(
      Layer.provide(
        Layer.merge(
          baseLayer,
          AccountingDocumentSnapshotRepository.Default.pipe(
            Layer.provide(baseLayer)
          )
        )
      )
    );

    const logs = await collectDatabaseQueryLogs(
      Effect.gen(function* () {
        const repository = yield* InvoiceRepository;
        yield* repository.issueManual({ ...input, issuedBy: issuer });
      }).pipe(Effect.provide(repositoryLayer))
    );

    expectQueryLogsToCensor({ recording, logs, values: [issuer.email] });
  });
});
