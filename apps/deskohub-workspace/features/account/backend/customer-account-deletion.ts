import { Effect } from "effect";
import type { CustomerAccountId } from "../customer-account";

export const deleteCustomerIdentity = <E, R, E2, R2>(
  accountId: CustomerAccountId,
  unlink: (accountId: CustomerAccountId) => Effect.Effect<void, E, R>,
  deleteUser: Effect.Effect<void, E2, R2>
) => unlink(accountId).pipe(Effect.andThen(deleteUser));
