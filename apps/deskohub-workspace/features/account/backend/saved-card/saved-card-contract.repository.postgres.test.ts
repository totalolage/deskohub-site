import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { NexiContractIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../../customer-account";
import { SavedCardContractRepository } from "./saved-card-contract.repository";
import { getSavedCardCustomerReference } from "./saved-card-customer-reference";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const makeRepositoryLayer = () =>
  SavedCardContractRepository.Default.pipe(
    Layer.provide(
      Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db: testDatabase!.db })
      )
    )
  );

const uniqueId = () => crypto.randomUUID();

const insertAuthUser = async (id: string, email: string) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

describe.skipIf(!testDatabase)(
  "SavedCardContractRepository on disposable Postgres",
  () => {
    test("scopes enrollments and contracts by account and transitions idempotently", async () => {
      const firstAccount = customerAccountIdSchema.make(uniqueId());
      const secondAccount = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(firstAccount, `cards-${firstAccount}@deskohub.test`);
      await insertAuthUser(
        secondAccount,
        `cards-${secondAccount}@deskohub.test`
      );

      const providerCustomerId = getSavedCardCustomerReference(firstAccount);
      const contractId = NexiContractIdSchema.make(
        `dh${uniqueId().replaceAll("-", "").slice(0, 12)}`
      );
      const contractIdA = NexiContractIdSchema.make(
        `dh${uniqueId().replaceAll("-", "").slice(0, 12)}`
      );
      const contractIdB = NexiContractIdSchema.make(
        `dh${uniqueId().replaceAll("-", "").slice(0, 12)}`
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const repository = yield* SavedCardContractRepository;

          const created = yield* repository.createEnrollment({
            customerAccountId: firstAccount,
            orderId: NexiOrderIdSchema.make("dhcardpgtest1"),
            providerCustomerId,
            providerContractId: contractId,
            securityTokenDigest: "a".repeat(64),
          });
          expect(created.state).toBe("pending");
          expect(created.orderId).toBe("dhcardpgtest1");

          // Order lookup finds the row; scoped transitions require the account.
          const byOrder = yield* repository.findEnrollmentByOrderId(
            "dhcardpgtest1" as never
          );
          expect(byOrder?.customerAccountId).toBe(firstAccount);

          yield* repository.upsertActiveContract({
            customerAccountId: firstAccount,
            providerCustomerId,
            providerContractId: contractIdA,
            displayCircuit: "VISA",
            displaySuffix: "4242",
          });
          // Same contract id under another account must not touch the row.
          yield* repository.upsertActiveContract({
            customerAccountId: secondAccount,
            providerCustomerId: getSavedCardCustomerReference(secondAccount),
            providerContractId: contractIdA,
          });

          const firstCards =
            yield* repository.listActiveContracts(firstAccount);
          expect(firstCards).toHaveLength(1);
          expect(firstCards[0].displayCircuit).toBe("VISA");

          const secondCards =
            yield* repository.listActiveContracts(secondAccount);
          expect(secondCards).toHaveLength(0);

          yield* repository.transitionEnrollment({
            orderId: "dhcardpgtest1" as never,
            customerAccountId: firstAccount,
            state: "confirmed",
          });
          const secondTransition = yield* repository.transitionEnrollment({
            orderId: "dhcardpgtest1" as never,
            customerAccountId: secondAccount,
            state: "failed",
            failureCode: "enrollment.failed",
          });
          expect(secondTransition).toBeNull();

          yield* repository.markContractRemoved({
            customerAccountId: firstAccount,
            providerContractId: contractIdA,
          });
          const refreshed = yield* repository.listActiveContracts(firstAccount);
          expect(refreshed).toHaveLength(0);
          // Idempotent re-removal is a no-op.
          yield* repository.markContractRemoved({
            customerAccountId: firstAccount,
            providerContractId: contractIdB,
          });
          expect(
            yield* repository.listActiveContracts(firstAccount)
          ).toHaveLength(0);
        }).pipe(Effect.provide(makeRepositoryLayer()))
      );
    });
  }
);
