import type { DotyposReservationId } from "@deskohub/dotypos";
import type { WorkspaceReservation } from "@/db/schema";

export const supersedableReservationPaymentStates = [
  "not_started",
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly WorkspaceReservation["paymentState"][];

export type SupersedableReservation = WorkspaceReservation & {
  readonly dotyposReservationId: DotyposReservationId;
};

export const isReservationSupersedable = (
  reservation: WorkspaceReservation
): reservation is SupersedableReservation =>
  reservation.reservationState === "held" &&
  supersedableReservationPaymentStates.some(
    (paymentState) => paymentState === reservation.paymentState
  ) &&
  Boolean(reservation.dotyposReservationId);
