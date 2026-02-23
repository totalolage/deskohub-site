export { DotyposApi } from "./backend/api";
export { DotyposService } from "./backend/service";
export type { DotyposRuntimeConfigObj } from "./config";
export { DotyposRuntimeConfig, makeDotyposRuntimeConfigLayer } from "./config";

export {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "./errors";
export type { Reservation } from "./generated/types.gen";
export type { TableReservationInput } from "./types";
export { isCategoryDisplayable } from "./utils/category-utils";
export { createNoteData, parseNoteData } from "./utils/note-metadata";
export { normalizePhoneNumber } from "./utils/phone-formatting";
export {
  formatDateTime,
  formatDuration,
  getReservationDisplayData,
} from "./utils/reservation-display";
