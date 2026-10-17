import { testEmailAddress } from "@deskohub/test-email";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import type { WorkspacePostgresTestDatabase } from "./workspace-postgres-test-database.test-utils";

/**
 * Inserts a verified customer account with a synthetic login email. The
 * returned actor is the account id and that email.
 */
export const insertTestAccount = async (
  database: WorkspacePostgresTestDatabase,
  label: string
): Promise<AdministratorAccountActor> => {
  const accountId = customerAccountIdSchema.make(crypto.randomUUID());
  const email = testEmailAddress(`${label}-${accountId}`);
  await database.pool.query(
    `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, true)`,
    [accountId, email]
  );
  return { accountId, email };
};

/** Inserts a verified account that holds the administrator role. */
export const insertTestAdministrator = async (
  database: WorkspacePostgresTestDatabase,
  label: string
): Promise<AdministratorAccountActor> => {
  const administrator = await insertTestAccount(database, label);
  await database.pool.query(
    `insert into account_role_grants (account_id, role) values ($1, 'administrator')`,
    [administrator.accountId]
  );
  return administrator;
};

/** Deletes test accounts; their grants cascade and actor ids become null. */
export const deleteTestAccounts = async (
  database: WorkspacePostgresTestDatabase,
  accounts: readonly AdministratorAccountActor[]
) => {
  if (accounts.length === 0) return;
  await database.pool.query(`delete from auth."user" where id = any($1)`, [
    accounts.map(({ accountId }) => accountId),
  ]);
};
