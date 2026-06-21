export type {
  CustomerLookupField,
  DotyposCustomerDiscount,
  DotyposCustomerLookupData,
  FindCustomerOptions,
} from "./backend/service";
export { DotyposService, FindCustomerResult } from "./backend/service";
export type { DotyposRuntimeConfigObj } from "./config";
export { DotyposRuntimeConfig, makeDotyposRuntimeConfigLayer } from "./config";

export {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "./errors";
export type { Reservation } from "./generated";
export type {
  CreateDotyposReservationInput,
  DotyposReservationStatus,
} from "./types";
export { normalizePhoneNumber } from "./utils/phone-formatting";
