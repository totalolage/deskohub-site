import { Effect } from "effect";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
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

/**
 * Whether no account is signed in, or only one awaiting deletion; an
 * unreadable session isn't signed out.
 */
export const isStatusViewerSignedOut = Effect.fn(
  "checkout.status.readSignedOut"
)(
  function* () {
    const current = yield* CurrentCustomerAccount;
    const standing = yield* current.peek;
    // A session awaiting deletion can't book or link, so it reads as signed
    // out; an unverified or unreadable account doesn't.
    return standing.kind === "signed-out" || standing.kind === "deletion-pending";
  },
  Effect.orElseSucceed(() => false)
);
