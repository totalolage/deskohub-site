import { testEmailAddress } from "@deskohub/test-email";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import type { WorkspacePostgresTestDatabase } from "./workspace-postgres-test-database.test-utils";

/**
 * Inserts a customer account with a synthetic login email, verified and not
 * awaiting deletion unless the options say otherwise. The returned actor is
 * the account id and that email.
 */
export const insertTestAccount = async (
  database: WorkspacePostgresTestDatabase,
  label: string,
  {
    emailVerified = true,
    deletionRequested = false,
    review = false,
  }: {
    readonly emailVerified?: boolean;
    readonly deletionRequested?: boolean;
    readonly review?: boolean;
  } = {}
): Promise<AdministratorAccountActor> => {
  const accountId = customerAccountIdSchema.make(crypto.randomUUID());
  const email = testEmailAddress(`${label}-${accountId}`);
  await database.pool.query(
    "insert into customer_accounts (id, review) values ($1, $2)",
    [accountId, review]
  );
  await database.pool.query(
    `insert into auth."user" (id, name, email, email_verified, deletion_requested_at)
     values ($1, '', $2, $3, case when $4 then now() end)`,
    [accountId, email, emailVerified, deletionRequested]
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

/**
 * Deletes test accounts' logins; their grants cascade, actor ids become null,
 * and the customer accounts stay as records do in production.
 */
export const deleteTestAccounts = async (
  database: WorkspacePostgresTestDatabase,
  accounts: readonly AdministratorAccountActor[]
) => {
  if (accounts.length === 0) return;
  await database.pool.query(`delete from auth."user" where id = any($1)`, [
    accounts.map(({ accountId }) => accountId),
  ]);
};
