import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  orders: {
    lines: r.many.orderLines(),
    paymentAttempts: r.many.paymentAttempts(),
    accountingDocumentSnapshots: r.many.accountingDocumentSnapshots(),
    invoices: r.many.invoices(),
    discountApplications: r.many.discountApplications(),
    discountCodeRedemptions: r.many.discountCodeRedemptions(),
    voucherRedemptions: r.many.voucherRedemptions(),
    legalEvidenceEvents: r.many.legalEvidenceEvents(),
    activePaymentAttempt: r.one.paymentAttempts({
      from: r.orders.activePaymentAttemptId,
      to: r.paymentAttempts.id,
    }),
  },
  orderLines: {
    order: r.one.orders({
      from: r.orderLines.orderId,
      to: r.orders.id,
      optional: false,
    }),
  },
  cliSessions: {
    authenticationRequest: r.one.cliAuthenticationRequests({
      from: r.cliSessions.id,
      to: r.cliAuthenticationRequests.sessionId,
    }),
  },
  cliAuthenticationRequests: {
    session: r.one.cliSessions({
      from: r.cliAuthenticationRequests.sessionId,
      to: r.cliSessions.id,
    }),
  },
  accountingDocumentSnapshots: {
    order: r.one.orders({
      from: r.accountingDocumentSnapshots.orderId,
      to: r.orders.id,
    }),
    invoice: r.one.invoices({
      from: r.accountingDocumentSnapshots.paymentAttemptId,
      to: r.invoices.paymentAttemptId,
    }),
    paymentAttempt: r.one.paymentAttempts({
      from: r.accountingDocumentSnapshots.paymentAttemptId,
      to: r.paymentAttempts.id,
      optional: false,
    }),
    workspaceReservation: r.one.workspaceReservations({
      from: r.accountingDocumentSnapshots.workspaceReservationId,
      to: r.workspaceReservations.id,
    }),
  },
  invoices: {
    order: r.one.orders({
      from: r.invoices.orderId,
      to: r.orders.id,
    }),
    accountingDocumentSnapshot: r.one.accountingDocumentSnapshots({
      from: r.invoices.paymentAttemptId,
      to: r.accountingDocumentSnapshots.paymentAttemptId,
      optional: false,
    }),
    workspaceReservation: r.one.workspaceReservations({
      from: r.invoices.workspaceReservationId,
      to: r.workspaceReservations.id,
    }),
    emailDeliveries: r.many.invoiceEmailDeliveries(),
  },
  invoiceEmailDeliveries: {
    invoice: r.one.invoices({
      from: r.invoiceEmailDeliveries.invoiceId,
      to: r.invoices.id,
      optional: false,
    }),
  },
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
    promotion: r.one.promotionCodes({
      from: r.discountCodes.promotionCodeId,
      to: r.promotionCodes.id,
      optional: false,
    }),
    discount: r.one.discounts({
      from: r.discountCodes.discountId,
      to: r.discounts.id,
      optional: false,
    }),
    redemptions: r.many.discountCodeRedemptions(),
    legacyCustomers: r.many.discountCodeCustomers(),
  },
  discountCodeCustomers: {
    code: r.one.discountCodes({
      from: r.discountCodeCustomers.codeId,
      to: r.discountCodes.id,
      optional: false,
    }),
  },
  vouchers: {
    promotion: r.one.promotionCodes({
      from: r.vouchers.promotionCodeId,
      to: r.promotionCodes.id,
      optional: false,
    }),
    redemptions: r.many.voucherRedemptions(),
  },
  promotionCodes: {
    customers: r.many.promotionCodeCustomers(),
    discountCode: r.one.discountCodes({
      from: r.promotionCodes.id,
      to: r.discountCodes.promotionCodeId,
    }),
    voucher: r.one.vouchers({
      from: r.promotionCodes.id,
      to: r.vouchers.promotionCodeId,
    }),
  },
  promotionCodeCustomers: {
    promotion: r.one.promotionCodes({
      from: r.promotionCodeCustomers.promotionCodeId,
      to: r.promotionCodes.id,
      optional: false,
    }),
  },
  discountApplications: {
    order: r.one.orders({
      from: r.discountApplications.orderId,
      to: r.orders.id,
    }),
    paymentAttempt: r.one.paymentAttempts({
      from: r.discountApplications.paymentAttemptId,
      to: r.paymentAttempts.id,
    }),
    workspaceReservation: r.one.workspaceReservations({
      from: r.discountApplications.workspaceReservationId,
      to: r.workspaceReservations.id,
    }),
    codeRedemption: r.one.discountCodeRedemptions({
      from: r.discountApplications.id,
      to: r.discountCodeRedemptions.applicationId,
    }),
    voucherRedemption: r.one.voucherRedemptions({
      from: r.discountApplications.id,
      to: r.voucherRedemptions.applicationId,
    }),
  },
  voucherRedemptions: {
    order: r.one.orders({
      from: r.voucherRedemptions.orderId,
      to: r.orders.id,
    }),
    voucher: r.one.vouchers({
      from: r.voucherRedemptions.voucherId,
      to: r.vouchers.id,
      optional: false,
    }),
    application: r.one.discountApplications({
      from: r.voucherRedemptions.applicationId,
      to: r.discountApplications.id,
      optional: false,
    }),
    paymentAttempt: r.one.paymentAttempts({
      from: r.voucherRedemptions.paymentAttemptId,
      to: r.paymentAttempts.id,
    }),
  },
  discountCodeRedemptions: {
    order: r.one.orders({
      from: r.discountCodeRedemptions.orderId,
      to: r.orders.id,
    }),
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
    }),
  },
  legalEvidenceEvents: {
    order: r.one.orders({
      from: r.legalEvidenceEvents.orderId,
      to: r.orders.id,
    }),
    workspaceReservation: r.one.workspaceReservations({
      from: r.legalEvidenceEvents.workspaceReservationId,
      to: r.workspaceReservations.id,
    }),
  },
  paymentAttempts: {
    order: r.one.orders({
      from: r.paymentAttempts.orderId,
      to: r.orders.id,
    }),
    accountingDocumentSnapshot: r.one.accountingDocumentSnapshots({
      from: r.paymentAttempts.id,
      to: r.accountingDocumentSnapshots.paymentAttemptId,
    }),
    invoice: r.one.invoices({
      from: r.paymentAttempts.id,
      to: r.invoices.paymentAttemptId,
    }),
    workspaceReservation: r.one.workspaceReservations({
      from: r.paymentAttempts.workspaceReservationId,
      to: r.workspaceReservations.id,
    }),
    latePaymentRecovery: r.one.latePaymentRecoveries({
      from: r.paymentAttempts.id,
      to: r.latePaymentRecoveries.paymentAttemptId,
    }),
  },
  latePaymentRecoveries: {
    paymentAttempt: r.one.paymentAttempts({
      from: r.latePaymentRecoveries.paymentAttemptId,
      to: r.paymentAttempts.id,
      optional: false,
    }),
    workspaceReservation: r.one.workspaceReservations({
      from: r.latePaymentRecoveries.workspaceReservationId,
      to: r.workspaceReservations.id,
      optional: false,
    }),
  },
  reservationAccessGrants: {
    workspaceReservation: r.one.workspaceReservations({
      from: r.reservationAccessGrants.workspaceReservationId,
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
