import { Effect } from "effect";
import { requireAccountFeature } from "./account-feature-withheld";
import { PasskeyReleaseGate } from "./account-release-gates";
import { CustomerPasskeys } from "./auth/customer-passkeys.service";

/**
 * The signed-in account's passkeys, oldest first, while `login_passkeys` is
 * released. A withheld feature fails with `AccountFeatureWithheldError`
 * before Better Auth is asked, so a passkey list served on its own, such as
 * the customer API's, enforces the gate the account page applies. The
 * caller has already resolved the session. Renaming and deleting a passkey
 * stay Better Auth's own endpoints.
 *
 * The account state reads the same gate itself, because there a withheld or
 * unreadable flag hides the section and an unreadable list degrades it.
 */
export const listCurrentCustomerPasskeys = requireAccountFeature(
  "passkeys",
  PasskeyReleaseGate.isOpen
).pipe(
  Effect.andThen(Effect.flatMap(CustomerPasskeys, (passkeys) => passkeys.list))
);
