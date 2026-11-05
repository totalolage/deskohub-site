import { AdministrationCustomerDetail } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";

/** The synthetic customer's identifier. No Dotypos customer has it. */
export const syntheticEmailCustomerId =
  dotyposCustomerIdSchema.make("sample-customer");

/**
 * The fictional customer whose data fills previews, test sends, and dry runs
 * that do not name a real customer. It contains no personal data.
 */
export const syntheticEmailCustomer: AdministrationCustomerDetail =
  Schema.decodeSync(AdministrationCustomerDetail)({
    profile: {
      customer: {
        id: syntheticEmailCustomerId,
        displayName: "Sample Customer",
        email: "sample.customer@example.com",
        phone: null,
        discountGroupId: null,
      },
      discountGroups: [],
      codes: [],
      claims: [],
      vouchers: [],
      voucherClaims: [],
    },
    activity: {
      reservations: [],
      reservationHistoryTruncated: false,
      transactions: [],
      transactionHistoryTruncated: false,
      stats: {
        reservationCount: 2,
        favoriteProduct: "Coworking",
        revenue: [],
        discountSavings: [],
      },
      marketingConsent: null,
    },
  });
