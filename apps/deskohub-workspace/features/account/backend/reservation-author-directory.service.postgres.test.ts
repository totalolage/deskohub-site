import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import {
  isCustomerOwnAuthor,
  ReservationAuthorDirectory,
} from "./reservation-author-directory.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "ReservationAuthorDirectory on disposable Postgres",
  () => {
    // Read only inside tests: registration runs even when the suite is
    // skipped without a database.
    const query = (text: string, values: readonly unknown[]) =>
      testDatabase!.pool.query(text, [...values]);

    const insertAccount = async (options: {
      readonly identity?: boolean;
      readonly linkedCustomer?: string;
      readonly locale?: string;
      readonly deletionRequested?: boolean;
      readonly tombstoned?: boolean;
    }) => {
      const accountId = customerAccountIdSchema.make(crypto.randomUUID());
      await query(
        `insert into customer_accounts (id, deleted_at) values ($1, $2)`,
        [accountId, options.tombstoned ? new Date() : null]
      );
      if (options.identity !== false) {
        await query(
          `insert into auth."user" (id, name, email, locale, deletion_requested_at)
           values ($1, '', $2, $3, $4)`,
          [
            accountId,
            testEmailAddress(`reservation-author-${accountId}`),
            options.locale ?? null,
            options.deletionRequested ? new Date() : null,
          ]
        );
      }
      if (options.linkedCustomer) {
        await query(
          `update customer_accounts set dotypos_customer_id = $2 where id = $1`,
          [accountId, options.linkedCustomer]
        );
      }
      return accountId;
    };

    const describeAuthors = (accountIds: readonly CustomerAccountId[]) =>
      Effect.runPromise(
        Effect.flatMap(ReservationAuthorDirectory, (directory) =>
          directory.describe(accountIds)
        ).pipe(
          Effect.provide(
            ReservationAuthorDirectory.Default.pipe(
              Layer.provide(testDatabase!.layer)
            )
          )
        )
      );

    test("describes an author linked on the account alone", async () => {
      const customerId = DotyposCustomerIdSchema.make(
        `author-column-${crypto.randomUUID()}`
      );
      const author = await insertAccount({});
      await query(
        "update customer_accounts set dotypos_customer_id = $2 where id = $1",
        [author, customerId]
      );

      const authors = await describeAuthors([author]);

      expect(authors.get(author)).toMatchObject({
        kind: "active",
        dotyposCustomerId: customerId,
      });
    });

    test("describes active and deleted authors in one read", async () => {
      const customerId = DotyposCustomerIdSchema.make(
        `author-customer-${crypto.randomUUID()}`
      );
      const active = await insertAccount({
        linkedCustomer: customerId,
        locale: "cs-CZ",
      });
      const unlinked = await insertAccount({});
      const tombstone = await insertAccount({
        identity: false,
        tombstoned: true,
      });
      const pendingDeletion = await insertAccount({ deletionRequested: true });
      const identityGone = await insertAccount({ identity: false });

      const authors = await describeAuthors([
        active,
        unlinked,
        tombstone,
        pendingDeletion,
        identityGone,
        active,
      ]);

      expect(authors.get(active)).toEqual({
        kind: "active",
        accountId: active,
        dotyposCustomerId: customerId,
        email: testEmailAddress(`reservation-author-${active}`),
        locale: "cs-CZ",
      });
      expect(authors.get(unlinked)).toMatchObject({
        kind: "active",
        dotyposCustomerId: null,
        locale: null,
      });
      for (const deleted of [tombstone, pendingDeletion, identityGone]) {
        expect(authors.get(deleted)).toEqual({
          kind: "deleted",
          accountId: deleted,
        });
      }
      expect(authors.size).toBe(5);
    });

    test("reads nothing for no authors", async () => {
      expect((await describeAuthors([])).size).toBe(0);
    });
  }
);

describe("isCustomerOwnAuthor", () => {
  const accountId = customerAccountIdSchema.make("account-id");
  const customerId = DotyposCustomerIdSchema.make("customer-own");
  const otherCustomerId = DotyposCustomerIdSchema.make("customer-other");
  const active = {
    kind: "active",
    accountId,
    dotyposCustomerId: customerId,
    email: testEmailAddress("reservation-author-own"),
    locale: null,
  } as const;

  test.each([
    ["an authorless reservation", null, true],
    ["the customer's own account", active, true],
    [
      "another customer's account",
      { ...active, dotyposCustomerId: otherCustomerId },
      false,
    ],
    ["an unlinked account", { ...active, dotyposCustomerId: null }, false],
    ["a deleted account", { kind: "deleted", accountId } as const, false],
  ] as const)("treats %s", (_label, author, expected) => {
    expect(isCustomerOwnAuthor(author, customerId)).toBe(expected);
  });
});
