import type { Customer } from "@deskohub/dotypos/generated/types.gen";
import type { WorkspaceReservation } from "@/db/schema/workspace-reservations";

const mockDate = new Date("2026-06-12T09:00:00.000+02:00");

export const workspaceReservationEmailPreviewTableName = "12";

export const createWorkspaceReservationEmailPreviewReservation = (
  locale: string
): WorkspaceReservation => ({
  id: "workspace_01JY4J8R6Z9Q2N8K7M5P3A1B0C",
  reservationIntentKey: "preview-reservation-intent",
  correlationId: "preview-correlation-id",
  dotyposCustomerId: "987654321",
  dotyposReservationId: "123456789",
  customerAccessCode: "4829",
  reservationState: "confirmed",
  paymentState: "paid",
  fulfillmentState: "fulfilled",
  activePaymentAttemptId: "preview-payment-attempt",
  productTier: "profi",
  productCoffee: true,
  productMonitorOption: "2x27-qhd",
  locale,
  reservationHoldExpiresAt: null,
  reservationHoldExpiredAt: null,
  reservationCreatedAt: mockDate,
  reservationConfirmedAt: mockDate,
  reservationCancelledAt: null,
  paidAt: mockDate,
  fulfilledAt: mockDate,
  fulfillmentFailedAt: null,
  failureCode: null,
  fulfillmentFailureCode: null,
  createdAt: mockDate,
  updatedAt: mockDate,
});

export const workspaceReservationEmailPreviewCustomer: Customer = {
  _cloudId: "preview-cloud-id",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: "Analytical Engines Ltd.",
  email: "customer@example.com",
  phone: "+420 123 456 789",
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};
