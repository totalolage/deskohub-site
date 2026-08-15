import { Effect } from "effect";
import type { CustomerAccountId } from "../customer-account";
import type { CustomerAccountLock } from "./customer-account-link.repository";

export const deleteCustomerIdentity = <E, R, E2, R2>(
  accountId: CustomerAccountId,
  withAccountLock: CustomerAccountLock,
  unlink: (accountId: CustomerAccountId) => Effect.Effect<void, E, R>,
  deleteUser: Effect.Effect<void, E2, R2>
) =>
  withAccountLock(
    accountId,
    unlink(accountId).pipe(
      Effect.andThen(deleteUser),
      Effect.andThen(unlink(accountId))
    )
  );
