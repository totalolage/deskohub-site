import {
  reservationAccessPath,
  reservationInvoicePath,
} from "@/features/reservation/routes";
import {
  getProtectedReservationPath,
  type ProtectedReservationPathInput,
} from "./protected-reservation-path";

export const getReservationAccessPath = (
  input: ProtectedReservationPathInput
) => getProtectedReservationPath(reservationAccessPath, input);

export const getReservationInvoicePath = (
  input: ProtectedReservationPathInput
) => getProtectedReservationPath(reservationInvoicePath, input);
