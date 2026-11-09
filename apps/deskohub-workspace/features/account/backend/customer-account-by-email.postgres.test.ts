import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Option } from "effect";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { findActiveCustomerAccountByEmail } from "./customer-account-by-email";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const insertAccount = (input: {
  readonly emailVerified: boolean;
  readonly deletionRequested?: boolean;
}) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("account-by-email", {
      verified: input.emailVerified,
      deletionRequested: input.deletionRequested,
    })
  );

const find = (email: string) =>
  Effect.runPromise(
    findActiveCustomerAccountByEmail(email).pipe(
      Effect.provide(testDatabase!.layer)
    )
  );

describe.skipIf(!testDatabase)(
  "findActiveCustomerAccountByEmail on disposable Postgres",
  () => {
    test("finds a verified account regardless of email case and spacing", async () => {
      const account = await insertAccount({ emailVerified: true });

      const found = await find(`  ${account.email.toUpperCase()} `);

      expect(found).toEqual(Option.some(account));
    });

    test("ignores unverified, deletion-pending, and unknown emails", async () => {
      const unverified = await insertAccount({ emailVerified: false });
      const deleting = await insertAccount({
        emailVerified: true,
        deletionRequested: true,
      });

      expect(await find(unverified.email)).toEqual(Option.none());
      expect(await find(deleting.email)).toEqual(Option.none());
      expect(await find(testEmailAddress("account-by-email-unknown"))).toEqual(
        Option.none()
      );
    });
  }
);
