import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect } from "effect";
import { CustomerAccountContactService } from "@/features/account";
import { ReferralService } from "@/features/referrals";

/**
 * Whether the booker's own referral is settled, so the browser's remembered
 * referral code is of no further use. The booker is the signed-in account's
 * linked customer. When the session no longer has one, such as after signing
 * out before paying, the booked customer stands in for the booker, and a paid
 * booking settles it. Booking for someone else never settles the booker's
 * code. A failed check reports false, so the code is kept.
 */
export const isBookerReferralSettled = Effect.fn(
  "checkout.isBookerReferralSettled"
)(
  function* (booking: {
    readonly bookedCustomerId?: DotyposCustomerId;
    readonly paid: boolean;
  }) {
    const contacts = yield* CustomerAccountContactService;
    const referrals = yield* ReferralService;
    const account = yield* contacts.currentAccount;
    if (account.status === "linked") {
      return yield* referrals.hasSettledReferral({
        dotyposCustomerId: account.dotyposCustomerId,
      });
    }
    // An account without a profile yet has no referral of its own to settle.
    if (account.status === "unlinked") return false;
    if (booking.paid) return true;
    if (booking.bookedCustomerId === undefined) return false;
    return yield* referrals.hasSettledReferral({
      dotyposCustomerId: booking.bookedCustomerId,
    });
  },
  Effect.catch((cause) =>
    Effect.logWarning("Booker referral settlement could not be checked", {
      cause,
    }).pipe(Effect.as(false))
  )
);
