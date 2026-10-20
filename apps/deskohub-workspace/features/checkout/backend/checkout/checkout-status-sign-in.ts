import { Effect } from "effect";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { getAccountSignInPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import type { CheckoutStatusReturnOutcome } from "./checkout-status.service";

/**
 * The sign-in page for a reservation status page a signed-out visitor can't
 * see, returning to it with its payment outcome after sign-in.
 */
export const getReservationStatusSignInPath = (
  locale: Locale,
  orderId: WorkspaceReservationId,
  outcome?: Exclude<CheckoutStatusReturnOutcome, "unknown">
) => {
  const statusPath = `/${locale}${reservationStatusPath}/${orderId}`;
  return getAccountSignInPath(
    locale,
    outcome ? `${statusPath}?${new URLSearchParams({ outcome })}` : statusPath,
    "reservation"
  );
};

/** Whether no account is signed in; an unreadable session isn't signed out. */
export const isStatusViewerSignedOut = Effect.fn(
  "checkout.status.readSignedOut"
)(
  function* () {
    const contacts = yield* CustomerAccountContactService;
    const account = yield* contacts.currentAccount;
    return account.status === "signed-out";
  },
  Effect.orElseSucceed(() => false)
);
