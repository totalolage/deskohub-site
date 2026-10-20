import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CustomerEmailLocaleService } from "./customer-email-locale.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();

describe.skipIf(!testDatabase)(
  "CustomerEmailLocaleService on disposable Postgres",
  () => {
    // Read only inside tests: registration runs even when the suite is
    // skipped without a database.
    const dbLayer = () => testDatabase!.layer;

    const insertAccountWithLink = async (
      dotyposCustomerId: string,
      options: {
        readonly locale?: string;
        readonly recordedOnAccount?: boolean;
      } = {}
    ) => {
      const accountId = uniqueId();
      await testDatabase!.pool.query(
        options.recordedOnAccount
          ? `insert into customer_accounts (id, dotypos_customer_id) values ($1, $2)`
          : `insert into customer_accounts (id) values ($1) on conflict do nothing`,
        options.recordedOnAccount ? [accountId, dotyposCustomerId] : [accountId]
      );
      await testDatabase!.pool.query(
        `insert into auth."user" (id, name, email, locale) values ($1, '', $2, $3)`,
        [
          accountId,
          testEmailAddress(`locale-${accountId}`),
          options.locale ?? null,
        ]
      );
      if (!options.recordedOnAccount) {
        await testDatabase!.pool.query(
          `update customer_accounts set dotypos_customer_id = $2 where id = $1`,
          [accountId, dotyposCustomerId]
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
            CustomerEmailLocaleService.Default.pipe(Layer.provide(dbLayer()))
          )
        )
      );

      expect(outcome).toEqual({ kind: "account", locale: "cs-CZ" });
    });

    test("resolves the preference of an account linked on the account alone", async () => {
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `locale-column-${uniqueId()}`
      );
      await insertAccountWithLink(dotyposCustomerId, {
        locale: "cs-CZ",
        recordedOnAccount: true,
      });

      const outcome = await Effect.runPromise(
        Effect.flatMap(CustomerEmailLocaleService, (service) =>
          service.byDotyposCustomer(dotyposCustomerId)
        ).pipe(
          Effect.provide(
            CustomerEmailLocaleService.Default.pipe(Layer.provide(dbLayer()))
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
            CustomerEmailLocaleService.Default.pipe(Layer.provide(dbLayer()))
          )
        )
      );

      expect(outcome).toEqual({ kind: "guest" });
    });

    test("keeps the reservation locale for a linked account without a locale preference", async () => {
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `locale-missing-${uniqueId()}`
      );
      await insertAccountWithLink(dotyposCustomerId);

      const outcome = await Effect.runPromise(
        Effect.flatMap(CustomerEmailLocaleService, (service) =>
          service.byDotyposCustomer(dotyposCustomerId)
        ).pipe(
          Effect.provide(
            CustomerEmailLocaleService.Default.pipe(Layer.provide(dbLayer()))
          )
        )
      );

      expect(outcome).toEqual({ kind: "guest" });
    });
  }
);
