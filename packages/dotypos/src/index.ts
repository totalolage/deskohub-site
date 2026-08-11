export type {
  CustomerLookupField,
  DotyposCustomerDiscount,
  DotyposCustomerDiscountGroup,
  DotyposCustomerLookupData,
  FindCustomerOptions,
} from "./backend/service";
export { DotyposService, FindCustomerResult } from "./backend/service";
export type { DotyposRuntimeConfigObj } from "./config";
export {
  DotyposRuntimeConfig,
  DotyposRuntimeConfigSchema,
  makeDotyposRuntimeConfigLayer,
} from "./config";

export {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "./errors";
export type {
  CreateDotyposReservationInput,
  DotyposBranchId,
  DotyposCategory,
  DotyposCategoryId,
  DotyposClientId,
  DotyposCloudId,
  DotyposCustomer,
  DotyposCustomerId,
  DotyposDiscountGroup,
  DotyposDiscountGroupId,
  DotyposEmployeeId,
  DotyposProduct,
  DotyposProductId,
  DotyposReservation,
  DotyposReservation as Reservation,
  DotyposReservationId,
  DotyposReservationInterval,
  DotyposReservationStatus,
  DotyposSellerId,
  DotyposTable,
  DotyposTableGroupId,
  DotyposTableId,
  UpdateDotyposReservationInput,
} from "./types";
export {
  DotyposBranchIdSchema,
  DotyposCategoryIdSchema,
  DotyposCategorySchema,
  DotyposClientIdSchema,
  DotyposCloudIdSchema,
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  DotyposDiscountGroupIdSchema,
  DotyposDiscountGroupSchema,
  DotyposEmployeeIdSchema,
  DotyposProductIdSchema,
  DotyposProductSchema,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
  DotyposSellerIdSchema,
  DotyposTableGroupIdSchema,
  DotyposTableIdSchema,
  DotyposTableSchema,
} from "./types";
export { normalizePhoneNumber } from "./utils/phone-formatting";
