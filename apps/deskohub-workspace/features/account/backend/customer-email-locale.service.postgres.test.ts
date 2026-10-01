import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CustomerEmailLocaleService } from "./customer-email-locale.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();

describe.skipIf(!testDatabase)(
  "CustomerEmailLocaleService on disposable Postgres",
  () => {
    const dbLayer = Layer.succeed(
      WorkspaceDatabase,
      WorkspaceDatabase.of({ db: testDatabase!.db })
    );

    const insertAccountWithLink = async (
      dotyposCustomerId: string,
      options: { readonly locale?: string } = {}
    ) => {
      const accountId = uniqueId();
      await testDatabase!.pool.query(
        `insert into auth."user" (id, name, email) values ($1, '', $2)`,
        [accountId, `locale-${accountId}@deskohub.test`]
      );
      await testDatabase!.pool.query(
        `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [accountId, dotyposCustomerId]
      );
      if (options.locale) {
        await testDatabase!.pool.query(
          `insert into customer_communication_preferences (customer_account_id, locale) values ($1, $2)`,
          [accountId, options.locale]
        );
      }
    };

    test("resolves a linked account's saved preference", async () => {
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `locale-linked-${uniqueId()}`
      );
      await insertAccountWithLink(dotyposCustomerId, { locale: "cs-CZ" });

      const outcome = await Effect.runPromise(
        Effect.flatMap(CustomerEmailLocaleService, (service) =>
          service.byDotyposCustomer(dotyposCustomerId)
        ).pipe(
          Effect.provide(
            CustomerEmailLocaleService.Default.pipe(Layer.provide(dbLayer))
          )
        )
      );

      expect(outcome).toEqual({ kind: "account", locale: "cs-CZ" });
    });

    test("keeps an unlinked guest reservation on the reservation locale", async () => {
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `locale-guest-${uniqueId()}`
      );

      const outcome = await Effect.runPromise(
        Effect.flatMap(CustomerEmailLocaleService, (service) =>
          service.byDotyposCustomer(dotyposCustomerId)
        ).pipe(
          Effect.provide(
            CustomerEmailLocaleService.Default.pipe(Layer.provide(dbLayer))
          )
        )
      );

      expect(outcome).toEqual({ kind: "guest" });
    });

    test("fails with the typed missing error for a linked account without a preference row", async () => {
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `locale-missing-${uniqueId()}`
      );
      await insertAccountWithLink(dotyposCustomerId);

      const outcome = await Effect.runPromise(
        Effect.flatMap(CustomerEmailLocaleService, (service) =>
          service.byDotyposCustomer(dotyposCustomerId)
        ).pipe(
          Effect.result,
          Effect.provide(
            CustomerEmailLocaleService.Default.pipe(Layer.provide(dbLayer))
          )
        )
      );

      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        expect((outcome.failure as { readonly code?: string }).code).toBe(
          "customer-email-locale.missing"
        );
      }
    });
  }
);
