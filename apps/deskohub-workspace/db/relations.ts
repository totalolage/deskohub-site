import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
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
      optional: false,
    }),
  },
  invoices: {
    accountingDocumentSnapshot: r.one.accountingDocumentSnapshots({
      from: r.invoices.paymentAttemptId,
      to: r.accountingDocumentSnapshots.paymentAttemptId,
      optional: false,
    }),
    workspaceReservation: r.one.workspaceReservations({
      from: r.invoices.workspaceReservationId,
      to: r.workspaceReservations.id,
      optional: false,
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
      optional: false,
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
