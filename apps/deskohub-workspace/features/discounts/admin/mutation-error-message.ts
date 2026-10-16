import { Match } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  DiscountAdminAudienceError,
  DiscountAdminConflictError,
  DiscountAdminNotFoundError,
} from "./discount-administration.service";

/**
 * The operator-facing message for a failed discount mutation. The service
 * messages stay English for the administration API, so the screen reads the
 * error's structured data instead.
 */
export const getDiscountAdminMutationErrorMessage = (
  cause: unknown,
  locale: Locale
): string =>
  Match.value(cause).pipe(
    Match.when(Match.instanceOf(DiscountAdminNotFoundError), ({ resource }) =>
      Match.value(resource.kind).pipe(
        Match.when("discount", () => m.discountsErrorDiscountMissing),
        Match.when("discount code", () => m.discountsErrorCodeMissing),
        Match.when("voucher", () => m.discountsErrorVoucherMissing),
        Match.when(
          "Dotypos customer",
          () => m.discountsErrorDotyposCustomerMissing
        ),
        Match.when(
          "Dotypos discount group",
          () => m.discountsErrorDotyposDiscountGroupMissing
        ),
        Match.when(
          "code audience membership",
          () => m.discountsErrorCodeAudienceMembershipMissing
        ),
        Match.when(
          "voucher audience membership",
          () => m.discountsErrorVoucherAudienceMembershipMissing
        ),
        Match.exhaustive
      )({}, { locale })
    ),
    Match.when(
      Match.instanceOf(DiscountAdminAudienceError),
      ({ promotionKind }) =>
        (promotionKind === "voucher"
          ? m.discountsErrorVoucherFinalCustomer
          : m.discountsErrorCodeFinalCustomer)({}, { locale })
    ),
    Match.when(Match.instanceOf(DiscountAdminConflictError), ({ reason }) =>
      Match.value(reason).pipe(
        Match.when(
          "promotion-code-taken",
          () => m.discountsErrorPromotionCodeTaken
        ),
        Match.when(
          "discount-referenced",
          () => m.discountsErrorDiscountReferenced
        ),
        Match.when("discount-code-claimed", () => m.discountsErrorCodeClaimed),
        Match.when("voucher-claimed", () => m.discountsErrorVoucherClaimed),
        Match.when(
          "voucher-credit-below-usage",
          () => m.discountsErrorVoucherCreditBelowUsage
        ),
        Match.when(
          "voucher-currency-locked",
          () => m.discountsErrorVoucherCurrencyLocked
        ),
        Match.exhaustive
      )({}, { locale })
    ),
    Match.orElse(() => m.discountsErrorSaveFailed({}, { locale }))
  );
