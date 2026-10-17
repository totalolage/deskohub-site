import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteTestAccounts,
  insertTestAccount,
} from "@/shared/testing/workspace-test-accounts.test-utils";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();
const testAccounts: AdministratorAccountActor[] = [];

/** Inserts a synthetic session owned by `approvedBy` and rolls it back. */
const insertSessionOwnedBy = async (
  approvedBy: string | null,
  account?: AdministratorAccountActor
) => {
  const client = await postgresDatabase!.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into cli_sessions (
         approved_by, approved_by_account_id, approved_by_account_email,
         token_hash, client_name, cli_version, build_target
       ) values ($1, $2, $3, repeat('a', 43), 'Synthetic CLI', '1.0.0', 'development')`,
      [approvedBy, account?.accountId ?? null, account?.email ?? null]
    );
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
};

const insertAuthenticationRequest = async (input: {
  readonly approvedAt?: Date | null;
  readonly approvedBy?: string | null;
  readonly approvedByAccountId?: string | null;
  readonly approvedByAccountEmail?: string | null;
  readonly grantExpiresAt?: Date | null;
}) => {
  const client = await postgresDatabase!.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into cli_authentication_requests (
         code_hash, challenge, client_name, cli_version, build_target,
         expires_at, approved_at, approved_by, approved_by_account_id,
         approved_by_account_email, grant_expires_at
       ) values (
         repeat('a', 43), repeat('b', 43), 'Synthetic CLI', '1.0.0', 'development',
         now() + interval '5 minutes', $1, $2, $3, $4, $5
       )`,
      [
        input.approvedAt ?? null,
        input.approvedBy ?? null,
        input.approvedByAccountId ?? null,
        input.approvedByAccountEmail ?? null,
        input.grantExpiresAt ?? null,
      ]
    );
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
};

describe.skipIf(!postgresDatabase)("cli session ownership on Postgres", () => {
  afterAll(async () => {
    await deleteTestAccounts(postgresDatabase!, testAccounts);
  });

  test("stores a session owned by a syntactically valid administrator", async () => {
    await expect(
      insertSessionOwnedBy("alice.admin-1")
    ).resolves.toBeUndefined();
  });

  test("rejects a session without an owner", async () => {
    await expect(insertSessionOwnedBy(null)).rejects.toMatchObject({
      code: "23514",
      constraint: "cli_sessions_approver_check",
    });
  });

  test("accepts a session with only the account approver", async () => {
    const account = await insertTestAccount(
      postgresDatabase!,
      "cli-session-approver"
    );
    testAccounts.push(account);

    await expect(insertSessionOwnedBy(null, account)).resolves.toBeUndefined();
  });

  test.each(["Alice", " alice", "-alice", "alice smith", "a".repeat(81)])(
    "rejects a session owned by the malformed administrator %p",
    async (approvedBy) => {
      await expect(insertSessionOwnedBy(approvedBy)).rejects.toMatchObject({
        code: "23514",
        constraint: "cli_sessions_approved_by_check",
      });
    }
  );

  test("enforces authentication request approver constraints", async () => {
    const account = await insertTestAccount(
      postgresDatabase!,
      "cli-authentication-approver"
    );
    testAccounts.push(account);
    const approvedAt = new Date();
    const grantExpiresAt = new Date(Date.now() + 60_000);

    // Requests approved before approvers were recorded have none, and stay valid.
    await expect(
      insertAuthenticationRequest({ approvedAt, grantExpiresAt })
    ).resolves.toBeUndefined();
    await expect(
      insertAuthenticationRequest({
        approvedByAccountId: account.accountId,
        approvedByAccountEmail: account.email,
      })
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "cli_authentication_requests_approval_check",
    });
    await expect(
      insertAuthenticationRequest({
        approvedAt,
        approvedBy: "alice.admin-1",
        approvedByAccountId: account.accountId,
        grantExpiresAt,
      })
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "cli_authentication_requests_approved_by_account_check",
    });
  });
});
