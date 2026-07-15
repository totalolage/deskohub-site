import { relations } from "drizzle-orm";
import {
  discountApplications,
  discountCodeRedemptions,
} from "./discount-applications";
import {
  discountCodeCustomers,
  discountCodes,
  discountProductTargets,
  discounts,
} from "./discounts";
import { paymentAttempts } from "./payment-attempts";
import { workspaceReservations } from "./workspace-reservations";

export const discountsRelations = relations(discounts, ({ many }) => ({
  productTargets: many(discountProductTargets),
  codes: many(discountCodes),
}));

export const discountProductTargetsRelations = relations(
  discountProductTargets,
  ({ one }) => ({
    discount: one(discounts, {
      fields: [discountProductTargets.discountId],
      references: [discounts.id],
    }),
  })
);

export const discountCodesRelations = relations(
  discountCodes,
  ({ one, many }) => ({
    discount: one(discounts, {
      fields: [discountCodes.discountId],
      references: [discounts.id],
    }),
    customers: many(discountCodeCustomers),
    redemptions: many(discountCodeRedemptions),
  })
);

export const discountCodeCustomersRelations = relations(
  discountCodeCustomers,
  ({ one }) => ({
    code: one(discountCodes, {
      fields: [discountCodeCustomers.codeId],
      references: [discountCodes.id],
    }),
  })
);

export const discountApplicationsRelations = relations(
  discountApplications,
  ({ one }) => ({
    paymentAttempt: one(paymentAttempts, {
      fields: [discountApplications.paymentAttemptId],
      references: [paymentAttempts.id],
    }),
    workspaceReservation: one(workspaceReservations, {
      fields: [discountApplications.workspaceReservationId],
      references: [workspaceReservations.id],
    }),
    codeRedemption: one(discountCodeRedemptions),
  })
);

export const discountCodeRedemptionsRelations = relations(
  discountCodeRedemptions,
  ({ one }) => ({
    code: one(discountCodes, {
      fields: [discountCodeRedemptions.codeId],
      references: [discountCodes.id],
    }),
    application: one(discountApplications, {
      fields: [discountCodeRedemptions.applicationId],
      references: [discountApplications.id],
    }),
    paymentAttempt: one(paymentAttempts, {
      fields: [discountCodeRedemptions.paymentAttemptId],
      references: [paymentAttempts.id],
    }),
  })
);
