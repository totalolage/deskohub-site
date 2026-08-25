import { Effect } from "effect";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import type { CustomerAccountLock } from "./customer-account-link.repository";

export const deleteCustomerIdentity = <E, R, E2, R2, E3, R3>(
  accountId: CustomerAccountId,
  withAccountLock: CustomerAccountLock,
  currentAccountId: Effect.Effect<CustomerAccountId | null, E3, R3>,
  unlink: (accountId: CustomerAccountId) => Effect.Effect<void, E, R>,
  deleteUser: Effect.Effect<void, E2, R2>
) =>
  withAccountLock(
    accountId,
    Effect.gen(function* () {
      const lockedAccountId = yield* currentAccountId.pipe(
        Effect.mapError(mapCustomerAccountFailure("authentication.session"))
      );
      if (lockedAccountId !== accountId) {
        return yield* new CustomerAccountAccessError({
          reason: "unauthenticated",
        });
      }
      yield* unlink(accountId).pipe(
        Effect.mapError(mapCustomerAccountFailure("account-link.unlink"))
      );
      yield* deleteUser.pipe(
        Effect.mapError(
          mapCustomerAccountFailure("authentication.account-delete")
        )
      );
      yield* unlink(accountId).pipe(
        Effect.mapError(mapCustomerAccountFailure("account-link.unlink"))
      );
    })
  ).pipe(Effect.mapError(mapCustomerAccountFailure("account-link.lock")));
