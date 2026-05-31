export { DotyposApi } from "./backend/api";
export type { DotyposCustomerDiscount } from "./backend/service";
export { DotyposService } from "./backend/service";
export type { DotyposRuntimeConfigObj } from "./config";
export { DotyposRuntimeConfig, makeDotyposRuntimeConfigLayer } from "./config";

export {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "./errors";
export type { Reservation } from "./generated/types.gen";
export type {
  CreateDotyposReservationInput,
  DotyposReservationStatus,
} from "./types";
export { normalizePhoneNumber } from "./utils/phone-formatting";
