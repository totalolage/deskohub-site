import type { CreateReservationRequest } from "./generated";

export type DotyposReservationStatus = CreateReservationRequest["status"];

export interface DotyposReservationInterval {
  readonly startDate: Date;
  readonly endDate: Date;
}

export interface CreateDotyposReservationInput
  extends DotyposReservationInterval {
  readonly customerId: string;
  readonly seats: number;
  readonly tableId: string;
  readonly status: DotyposReservationStatus;
  readonly note?: string;
}

export interface UpdateDotyposReservationInput {
  readonly reservationId: string;
  readonly note: string;
}
