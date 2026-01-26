import { TableReservationFormData } from "@/features/table-reservation";

export interface NoteData extends TableReservationFormData {
  timestamp: Date;
  locale: Locale;
  source: "website";
}
