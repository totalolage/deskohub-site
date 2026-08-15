import { Effect } from "effect";
import type { CustomerAccountId } from "../customer-account";
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
      const lockedAccountId = yield* currentAccountId;
      if (lockedAccountId !== accountId) {
        return yield* Effect.fail("session-changed" as const);
      }
      yield* unlink(accountId);
      yield* deleteUser;
      yield* unlink(accountId);
    })
  );
