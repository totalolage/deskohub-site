export type {
  CustomerLookupField,
  DotyposCustomerDiscount,
  DotyposCustomerDiscountGroup,
  DotyposCustomerLookupData,
  FindCustomerOptions,
  PreparedDotyposReservationCreation,
} from "./backend/service";
export {
  DotyposService,
  FindCustomerResult,
  hasValidDotyposReservationRequestEvidence,
} from "./backend/service";
export type { DotyposRuntimeConfigObj } from "./config";
export { DotyposRuntimeConfig, makeDotyposRuntimeConfigLayer } from "./config";

export { ExternalAPIError, NetworkError, ValidationError } from "./errors";
export type { Reservation } from "./generated";
export { canonicalizeDotyposEntityId } from "./identity";
export type {
  CreateDotyposReservationInput,
  DotyposReservationStatus,
  UpdateDotyposReservationInput,
} from "./types";
export { normalizePhoneNumber } from "./utils/phone-formatting";
