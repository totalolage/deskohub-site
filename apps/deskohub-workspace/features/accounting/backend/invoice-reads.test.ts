import { expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { makeInvoiceReads } from "./invoice-reads";

test("reads text that is no invoice id as not found without a query", async () => {
  const recording = await makeRecordingWorkspaceDatabase();

  const found = await Effect.runPromise(
    makeInvoiceReads.pipe(
      Effect.flatMap((reads) =>
        reads.findForCustomer(
          DotyposCustomerIdSchema.make("synthetic-invoice-customer"),
          "not-an-invoice-id"
        )
      ),
      Effect.provide(
        Layer.mergeAll(
          recording.layer,
          Layer.mock(AccountingSnapshotKeyService, {})
        )
      )
    )
  );

  expect(found).toBeNull();
  expect(recording.statements).toEqual([]);
});
