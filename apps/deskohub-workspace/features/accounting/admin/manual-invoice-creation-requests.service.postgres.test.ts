import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { AdministrationInvoiceCreateInput } from "@deskohub/workspace-admin-api";
import { Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoiceIdSchema } from "@/features/accounting/manual-invoice";
import { waitForAdvisoryLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
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
              WorkspaceDatabase.of({ db: testDatabase!.db })
            ),
            AccountingSnapshotKeyService.Default
          )
        )
      )
    ),
    Effect.runPromise
  );

const uniqueInvoiceId = () => invoiceIdSchema.make(crypto.randomUUID());

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

    test("serializes creation per invoice ID", async () => {
      const requests = await getRequests();
      const invoiceId = uniqueInvoiceId();
      const events: string[] = [];

      await Effect.runPromise(
        Effect.gen(function* () {
          const acquired = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const holder = yield* Effect.forkChild(
            requests.withLock(
              invoiceId,
              Deferred.succeed(acquired, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(Effect.sync(() => events.push("holder")))
              )
            )
          );
          yield* Deferred.await(acquired);
          const contender = yield* Effect.forkChild(
            requests.withLock(
              invoiceId,
              Effect.sync(() => events.push("contender"))
            )
          );
          yield* Effect.promise(() =>
            waitForAdvisoryLockWaiter(testDatabase!.pool, [
              "manual-invoice-creation",
              invoiceId,
            ])
          );

          yield* requests.withLock(
            uniqueInvoiceId(),
            Effect.sync(() => events.push("other invoice"))
          );
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(holder);
          yield* Fiber.join(contender);
        })
      );

      expect(events).toEqual(["other invoice", "holder", "contender"]);
    });
  }
);
