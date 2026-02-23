import type { TableReservationInput } from "../../types";

export interface NoteData extends TableReservationInput {
  readonly timestamp: Date;
  readonly source: "website";
}
