import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { AdministrationInvoiceCreateInput } from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AccountingSnapshotKeyService } from "../backend/accounting-snapshot-key.service";
import { getManualInvoiceCreationRequestJson } from "./invoice-administration.service";
import { ManualInvoiceCreationRequests } from "./manual-invoice-creation-requests.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const getRequests = () =>
  Effect.gen(function* () {
    return yield* ManualInvoiceCreationRequests;
  }).pipe(
    Effect.provide(
      ManualInvoiceCreationRequests.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              WorkspaceDatabase,
              WorkspaceDatabase.make(testDatabase!.db)
            ),
            AccountingSnapshotKeyService.Default
          )
        )
      )
    ),
    Effect.runPromise
  );

const createdInvoiceIds: string[] = [];

const uniqueInvoiceId = () => {
  const invoiceId = invoiceIdSchema.make(crypto.randomUUID());
  createdInvoiceIds.push(invoiceId);
  return invoiceId;
};

const syntheticRequestJson = () =>
  JSON.stringify({ request: crypto.randomUUID() });

const readClaimedAtEpoch = async (invoiceId: string) => {
  const { rows } = await testDatabase!.pool.query<{ epoch: number }>(
    `select extract(epoch from claimed_at)::float8 as epoch
     from manual_invoice_creation_requests
     where invoice_id = $1`,
    [invoiceId]
  );
  return rows[0]!.epoch;
};

const customerDetails = {
  kind: "business",
  email: testEmailAddress("billing-claim"),
  phone: "+420 111 222 333",
  companyName: "Synthetic Claims s.r.o.",
  companyId: "87654321",
  vatId: "CZ87654321",
  firstName: "Synthetic",
  lastName: "Claimant",
  address: {
    line1: "Synthetic Street 1",
    line2: "Floor 3",
    city: "Testville",
    postalCode: "999 99",
    country: "CZ",
  },
} as const;

describe.skipIf(!testDatabase)(
  "ManualInvoiceCreationRequests on disposable Postgres",
  () => {
    afterAll(async () => {
      await testDatabase!.pool.query(
        "delete from manual_invoice_creation_requests where invoice_id = any($1)",
        [createdInvoiceIds]
      );
    });

    test("reports an identical retry of a fresh claim as in progress", async () => {
      const requests = await getRequests();
      const invoiceId = uniqueInvoiceId();
      const normalizedRequestJson = syntheticRequestJson();

      const first = await Effect.runPromise(
        requests.claim({ invoiceId, normalizedRequestJson })
      );
      const claimedAt = await readClaimedAtEpoch(invoiceId);
      const retry = await Effect.runPromise(
        requests.claim({ invoiceId, normalizedRequestJson })
      );

      expect(first).toEqual({ kind: "claimed" });
      expect(retry).toEqual({ kind: "in-progress" });
      expect(await readClaimedAtEpoch(invoiceId)).toEqual(claimedAt);
    });

    test("rejects a retry whose request differs from the claim", async () => {
      const requests = await getRequests();
      const invoiceId = uniqueInvoiceId();

      await Effect.runPromise(
        requests.claim({
          invoiceId,
          normalizedRequestJson: syntheticRequestJson(),
        })
      );
      const retry = await Effect.runPromise(
        requests.claim({
          invoiceId,
          normalizedRequestJson: syntheticRequestJson(),
        })
      );

      expect(retry).toEqual({ kind: "mismatch" });
    });

    test("reports a completed request as completed and completes it only once", async () => {
      const requests = await getRequests();
      const invoiceId = uniqueInvoiceId();
      const normalizedRequestJson = syntheticRequestJson();

      await Effect.runPromise(
        requests.claim({ invoiceId, normalizedRequestJson })
      );
      await Effect.runPromise(requests.complete(invoiceId));
      const retry = await Effect.runPromise(
        requests.claim({ invoiceId, normalizedRequestJson })
      );
      const secondCompletion = await Effect.runPromise(
        Effect.flip(requests.complete(invoiceId))
      );
      const { rows } = await testDatabase!.pool.query<{ completed: boolean }>(
        `select completed_at is not null as completed
         from manual_invoice_creation_requests
         where invoice_id = $1`,
        [invoiceId]
      );

      expect(retry).toEqual({ kind: "completed" });
      expect(secondCompletion).toMatchObject({
        _tag: "ManualInvoiceCreationRequestError",
      });
      expect(rows).toEqual([{ completed: true }]);
    });

    test("cannot complete a request that was never claimed", async () => {
      const requests = await getRequests();

      const error = await Effect.runPromise(
        Effect.flip(requests.complete(uniqueInvoiceId()))
      );

      expect(error).toMatchObject({
        _tag: "ManualInvoiceCreationRequestError",
      });
    });

    test("reclaims an identical request whose claim is older than a minute", async () => {
      const requests = await getRequests();
      const invoiceId = uniqueInvoiceId();
      const normalizedRequestJson = syntheticRequestJson();

      await Effect.runPromise(
        requests.claim({ invoiceId, normalizedRequestJson })
      );
      await testDatabase!.pool.query(
        `update manual_invoice_creation_requests
         set claimed_at = claimed_at - interval '2 minutes'
         where invoice_id = $1`,
        [invoiceId]
      );
      const staleClaimedAt = await readClaimedAtEpoch(invoiceId);
      const retry = await Effect.runPromise(
        requests.claim({ invoiceId, normalizedRequestJson })
      );

      expect(retry).toEqual({ kind: "claimed" });
      expect(await readClaimedAtEpoch(invoiceId)).toBeGreaterThan(
        staleClaimedAt
      );
    });

    test("stores a claim without the customer contact details it binds", async () => {
      const requests = await getRequests();
      const invoiceId = uniqueInvoiceId();
      const input = Schema.decodeUnknownSync(AdministrationInvoiceCreateInput)({
        invoiceId,
        customer: { kind: "new", details: customerDetails },
        locale: "en-US",
        serviceDate: "2026-08-18",
        payment: { status: "due", date: "2026-09-01" },
        currency: "CZK",
        variableSymbol: "2026000001",
        lines: [{ description: "Room hire", price: "1200.00" }],
      });

      const claim = await Effect.runPromise(
        requests.claim({
          invoiceId,
          normalizedRequestJson: getManualInvoiceCreationRequestJson(input, {
            source: "admin-ui",
            actor: testEmailAddress("invoice-claim-administrator"),
          }),
        })
      );
      const { rows } = await testDatabase!.pool.query<{ stored: string }>(
        `select row_to_json(request)::text as stored
         from manual_invoice_creation_requests request
         where invoice_id = $1`,
        [invoiceId]
      );

      expect(claim).toEqual({ kind: "claimed" });
      expect(rows).toHaveLength(1);
      const stored = rows[0]!.stored.toLowerCase();
      for (const value of [
        customerDetails.email,
        customerDetails.phone,
        customerDetails.companyName,
        customerDetails.companyId,
        customerDetails.firstName,
        customerDetails.lastName,
        customerDetails.address.line1,
        customerDetails.address.city,
      ]) {
        expect(stored).not.toContain(value.toLowerCase());
      }
    });
  }
);
