import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerReservationHistoryService } from "./customer-reservation-history.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
    Math.random() * 900
  )}`;

const insertAuthUser = async (id: string, email: string) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

describe.skipIf(!testDatabase)(
  "CustomerReservationHistoryService on disposable Postgres",
  () => {
    test("blocks reservation activity for a deletion marker or a removed account, never for anonymous flows", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, `h-${account}@deskohub.test`);
      await testDatabase!.pool.query(
        `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [account, dotyposCustomerId]
      );

      const layer = CustomerReservationHistoryService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(
              WorkspaceDatabase,
              WorkspaceDatabase.of({ db: testDatabase!.db })
            ),
            Layer.mock(DotyposService, {
              listReservations: () => Effect.succeed([]),
            } as Partial<DotyposService["Service"]>),
            CustomerAccountLinkRepository.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(
                    WorkspaceDatabase,
                    WorkspaceDatabase.of({ db: testDatabase!.db })
                  ),
                  WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
                )
              )
            )
          )
        )
      );

      const runLoad = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const history = yield* CustomerReservationHistoryService;
            return yield* history.load({
              accountId: account,
              dotyposCustomerId,
            });
          }).pipe(Effect.provide(layer), Effect.result)
        );

      const active = await runLoad();
      expect(active._tag).toBe("Success");

      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [account]
      );
      const marked = await runLoad();
      expect(marked._tag).toBe("Failure");
      if (marked._tag === "Failure") {
        const error = marked.failure as {
          reason?: string;
          linkReason?: string;
        };
        expect(error.reason).toBe("link-required");
        expect(error.linkReason).toBe("deletion-requested");
      }

      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        account,
      ]);
      const removed = await runLoad();
      expect(removed._tag).toBe("Failure");
      if (removed._tag === "Failure") {
        const error = removed.failure as { reason?: string };
        expect(error.reason).toBe("unauthenticated");
      }
    });
  }
);
