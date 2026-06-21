import type { CreateReservationRequest } from "./generated";

export type DotyposReservationStatus = CreateReservationRequest["status"];

export interface CreateDotyposReservationInput {
  readonly customerId: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly seats: number;
  readonly tableId: string;
  readonly status: DotyposReservationStatus;
  readonly note?: string;
}
