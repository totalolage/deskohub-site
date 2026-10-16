import type { CustomerAccountId } from "@/features/account/customer-account";

/** Roles an account can be granted. Only administrators exist today. */
export const accountRoles = ["administrator"] as const;
export type AccountRole = (typeof accountRoles)[number];

/**
 * The account an administrator acted as, with the login email it had then.
 * The snapshot keeps provenance readable after the account is deleted.
 */
export type AdministratorAccountActor = {
  readonly accountId: CustomerAccountId;
  readonly email: string;
};
