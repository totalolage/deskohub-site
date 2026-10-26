import { and, eq, isNull } from "drizzle-orm";
import { Effect, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { authUser } from "@/db/schema/auth";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";

type ActiveCustomerAccount = {
  readonly accountId: CustomerAccountId;
  /** The login email, as stored. */
  readonly email: string;
};

/**
 * Finds the active account that signs in with `email`, with its stored login
 * email. Accounts with an unverified email or a pending deletion yield none.
 */
export const findActiveCustomerAccountByEmail = Effect.fn(
  "CustomerAccount.findActiveByEmail"
)(function* (email: string) {
  const { db } = yield* WorkspaceDatabase;
  const [row] = yield* db
    .select({ id: authUser.id, email: authUser.email })
    .from(authUser)
    .where(
      and(
        // Better Auth stores login emails lowercased.
        eq(authUser.email, email.trim().toLowerCase()),
        eq(authUser.emailVerified, true),
        isNull(authUser.deletionRequestedAt)
      )
    )
    .limit(1);
  return Option.fromNullishOr(row).pipe(
    Option.map(
      (account): ActiveCustomerAccount => ({
        accountId: customerAccountIdSchema.make(account.id),
        email: account.email,
      })
    )
  );
});
