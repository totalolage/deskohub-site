import type { DotyposReservationId } from "@deskohub/dotypos";
import type { WorkspaceReservationRow } from "@/db/schema";

export const supersedableReservationPaymentStates = [
  "not_started",
  "failed",
  "cancelled",
  "expired",
] as const satisfies readonly WorkspaceReservationRow["paymentState"][];

export type SupersedableReservation = WorkspaceReservationRow & {
  readonly dotyposReservationId: DotyposReservationId;
};

export const isReservationSupersedable = (
  reservation: WorkspaceReservationRow
): reservation is SupersedableReservation =>
  reservation.reservationState === "held" &&
  supersedableReservationPaymentStates.some(
    (paymentState) => paymentState === reservation.paymentState
  ) &&
  Boolean(reservation.dotyposReservationId);
