import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  discounts: {
    productTargets: r.many.discountProductTargets(),
    codes: r.many.discountCodes(),
  },
  discountProductTargets: {
    discount: r.one.discounts({
      from: r.discountProductTargets.discountId,
      to: r.discounts.id,
      optional: false,
    }),
  },
  discountCodes: {
    discount: r.one.discounts({
      from: r.discountCodes.discountId,
      to: r.discounts.id,
      optional: false,
    }),
    customers: r.many.discountCodeCustomers(),
    redemptions: r.many.discountCodeRedemptions(),
  },
  discountCodeCustomers: {
    code: r.one.discountCodes({
      from: r.discountCodeCustomers.codeId,
      to: r.discountCodes.id,
      optional: false,
    }),
  },
  discountApplications: {
    paymentAttempt: r.one.paymentAttempts({
      from: r.discountApplications.paymentAttemptId,
      to: r.paymentAttempts.id,
      optional: false,
    }),
    workspaceReservation: r.one.workspaceReservations({
      from: r.discountApplications.workspaceReservationId,
      to: r.workspaceReservations.id,
      optional: false,
    }),
    codeRedemption: r.one.discountCodeRedemptions({
      from: r.discountApplications.id,
      to: r.discountCodeRedemptions.applicationId,
    }),
  },
  discountCodeRedemptions: {
    code: r.one.discountCodes({
      from: r.discountCodeRedemptions.codeId,
      to: r.discountCodes.id,
      optional: false,
    }),
    application: r.one.discountApplications({
      from: r.discountCodeRedemptions.applicationId,
      to: r.discountApplications.id,
      optional: false,
    }),
    paymentAttempt: r.one.paymentAttempts({
      from: r.discountCodeRedemptions.paymentAttemptId,
      to: r.paymentAttempts.id,
      optional: false,
    }),
  },
  paymentAttempts: {
    workspaceReservation: r.one.workspaceReservations({
      from: r.paymentAttempts.workspaceReservationId,
      to: r.workspaceReservations.id,
      optional: false,
    }),
  },
  webhookEvents: {
    paymentAttempt: r.one.paymentAttempts({
      from: r.webhookEvents.paymentAttemptId,
      to: r.paymentAttempts.id,
    }),
  },
}));
