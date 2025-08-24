import type z from "zod/v4";
import type { getTableReservationSchema } from "./schemas/table-reservation";

export interface TableReservationData
  extends z.output<ReturnType<typeof getTableReservationSchema>> {
  id: string;
  submittedAt: Date;
}

export interface TableReservationResponse {
  success: boolean;
  reservationId?: string;
  message: string;
  data?: TableReservationData;
}

export interface TableReservationStorageItem {
  id: string;
  data: TableReservationData;
  createdAt: Date;
}
