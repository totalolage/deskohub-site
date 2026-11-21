import { Schema } from "effect";
import {
  type CreateReservationRequest,
  Category as GeneratedCategorySchema,
  Customer as GeneratedCustomerSchema,
  DiscountGroup as GeneratedDiscountGroupSchema,
  Product as GeneratedProductSchema,
  Reservation as GeneratedReservationSchema,
  Table as GeneratedTableSchema,
} from "./generated";

const dotyposOpaqueId = <const BrandName extends string>(
  brand: Parameters<typeof Schema.brand<BrandName>>[0],
  description: string
) =>
  Schema.Trim.check(Schema.isNonEmpty())
    .pipe(Schema.brand<BrandName>(brand))
    .annotate({
      identifier: brand,
      description,
    });

export const DotyposClientIdSchema = dotyposOpaqueId(
  "DotyposClientId",
  "Identifier of an OAuth client registered with Dotypos."
);
export type DotyposClientId = typeof DotyposClientIdSchema.Type;

export const DotyposCloudIdSchema = dotyposOpaqueId(
  "DotyposCloudId",
  "Opaque identifier assigned to a Dotypos cloud."
);
export type DotyposCloudId = typeof DotyposCloudIdSchema.Type;

export const DotyposBranchIdSchema = dotyposOpaqueId(
  "DotyposBranchId",
  "Opaque identifier assigned to a Dotypos branch."
);
export type DotyposBranchId = typeof DotyposBranchIdSchema.Type;

export const DotyposEmployeeIdSchema = dotyposOpaqueId(
  "DotyposEmployeeId",
  "Opaque identifier assigned to a Dotypos employee."
);
export type DotyposEmployeeId = typeof DotyposEmployeeIdSchema.Type;

export const DotyposSellerIdSchema = dotyposOpaqueId(
  "DotyposSellerId",
  "Opaque identifier assigned to a Dotypos seller."
);
export type DotyposSellerId = typeof DotyposSellerIdSchema.Type;

export const DotyposTableGroupIdSchema = dotyposOpaqueId(
  "DotyposTableGroupId",
  "Opaque identifier assigned to a Dotypos table group."
);
export type DotyposTableGroupId = typeof DotyposTableGroupIdSchema.Type;

export const DotyposCustomerIdSchema = dotyposOpaqueId(
  "DotyposCustomerId",
  "Opaque identifier assigned to a Dotypos customer."
);
export type DotyposCustomerId = typeof DotyposCustomerIdSchema.Type;

export const DotyposReservationIdSchema = dotyposOpaqueId(
  "DotyposReservationId",
  "Opaque identifier assigned to a Dotypos reservation."
);
export type DotyposReservationId = typeof DotyposReservationIdSchema.Type;

export const DotyposTableIdSchema = dotyposOpaqueId(
  "DotyposTableId",
  "Opaque identifier assigned to a Dotypos table."
);
export type DotyposTableId = typeof DotyposTableIdSchema.Type;

export const DotyposProductIdSchema = dotyposOpaqueId(
  "DotyposProductId",
  "Opaque identifier assigned to a Dotypos product."
);
export type DotyposProductId = typeof DotyposProductIdSchema.Type;

export const DotyposCategoryIdSchema = dotyposOpaqueId(
  "DotyposCategoryId",
  "Opaque identifier assigned to a Dotypos product category."
);
export type DotyposCategoryId = typeof DotyposCategoryIdSchema.Type;

export const DotyposDiscountGroupIdSchema = dotyposOpaqueId(
  "DotyposDiscountGroupId",
  "Opaque identifier assigned to a Dotypos discount group."
);
export type DotyposDiscountGroupId = typeof DotyposDiscountGroupIdSchema.Type;

export const DotyposReservationSchema = Schema.Struct({
  ...GeneratedReservationSchema.fields,
  id: DotyposReservationIdSchema,
  _branchId: DotyposBranchIdSchema,
  _cloudId: DotyposCloudIdSchema,
  _customerId: Schema.optionalKey(DotyposCustomerIdSchema),
  _employeeId: Schema.optionalKey(DotyposEmployeeIdSchema),
  _tableId: Schema.optionalKey(DotyposTableIdSchema),
}).annotate({
  identifier: "DotyposReservation",
  description:
    "A Dotypos reservation with provider identifiers decoded by role.",
});
export type DotyposReservation = typeof DotyposReservationSchema.Type;

export const DotyposCustomerSchema = Schema.Struct({
  ...GeneratedCustomerSchema.fields,
  id: DotyposCustomerIdSchema,
  _cloudId: DotyposCloudIdSchema,
  _discountGroupId: Schema.optionalKey(
    Schema.NullOr(DotyposDiscountGroupIdSchema)
  ),
  _sellerId: Schema.optionalKey(Schema.NullOr(DotyposSellerIdSchema)),
}).annotate({
  identifier: "DotyposCustomer",
  description: "A Dotypos customer with provider identifiers decoded by role.",
});
export type DotyposCustomer = typeof DotyposCustomerSchema.Type;

export const DotyposCustomerWriteRecordSchema = Schema.Struct({
  ...DotyposCustomerSchema.fields,
  id: Schema.optionalKey(DotyposCustomerIdSchema),
}).annotate({
  identifier: "DotyposCustomerWriteRecord",
  description:
    "A Dotypos customer a create returned. Create responses aren't known to carry the id, so callers keep a fallback.",
});
export type DotyposCustomerWriteRecord =
  typeof DotyposCustomerWriteRecordSchema.Type;

export const DotyposDiscountGroupSchema = Schema.Struct({
  ...GeneratedDiscountGroupSchema.fields,
  id: Schema.optionalKey(DotyposDiscountGroupIdSchema),
  _cloudId: Schema.optionalKey(DotyposCloudIdSchema),
}).annotate({
  identifier: "DotyposDiscountGroup",
  description:
    "A Dotypos discount group with provider identifiers decoded by role.",
});
export type DotyposDiscountGroup = typeof DotyposDiscountGroupSchema.Type;

export const DotyposTableSchema = Schema.Struct({
  ...GeneratedTableSchema.fields,
  id: DotyposTableIdSchema,
  _branchId: Schema.optionalKey(DotyposBranchIdSchema),
  _cloudId: DotyposCloudIdSchema,
  _sellerId: Schema.optionalKey(Schema.NullOr(DotyposSellerIdSchema)),
  _tableGroupId: Schema.optionalKey(DotyposTableGroupIdSchema),
}).annotate({
  identifier: "DotyposTable",
  description: "A Dotypos table with provider identifiers decoded by role.",
});
export type DotyposTable = typeof DotyposTableSchema.Type;

export const DotyposProductSchema = Schema.Struct({
  ...GeneratedProductSchema.fields,
  id: Schema.optionalKey(DotyposProductIdSchema),
  _categoryId: DotyposCategoryIdSchema,
  _cloudId: Schema.optionalKey(DotyposCloudIdSchema),
}).annotate({
  identifier: "DotyposProduct",
  description: "A Dotypos product with provider identifiers decoded by role.",
});
export type DotyposProduct = typeof DotyposProductSchema.Type;

export const DotyposCategorySchema = Schema.Struct({
  ...GeneratedCategorySchema.fields,
  id: Schema.optionalKey(DotyposCategoryIdSchema),
  _cloudId: Schema.optionalKey(DotyposCloudIdSchema),
}).annotate({
  identifier: "DotyposCategory",
  description: "A Dotypos category with provider identifiers decoded by role.",
});
export type DotyposCategory = typeof DotyposCategorySchema.Type;

export type DotyposReservationStatus = CreateReservationRequest["status"];

export interface DotyposReservationInterval {
  readonly startDate: Date;
  readonly endDate: Date;
}

/** Who holds which table, when, and for how many seats: the facts a reservation books. */
export interface DotyposReservationBooking extends DotyposReservationInterval {
  readonly customerId: DotyposCustomerId;
  readonly seats: number;
  readonly tableId: DotyposTableId;
}

export interface CreateDotyposReservationInput
  extends DotyposReservationBooking {
  readonly status: DotyposReservationStatus;
  readonly note?: string;
  /** The caller has stored a marker and will reconcile an inconclusive POST. */
  readonly singleAttempt?: true;
}

export interface SetMatchingDotyposReservationStatusInput {
  readonly reservationId: DotyposReservationId;
  readonly status: "CONFIRMED" | "CANCELLED";
  readonly expectedBooking: DotyposReservationBooking;
  readonly expectedNoteLine: string;
}

export interface UpdateDotyposReservationInput {
  readonly reservationId: DotyposReservationId;
  readonly note: string;
}

export interface RestoreDotyposReservationInput {
  readonly reservationId: DotyposReservationId;
  /** The booking the caller holds for the reservation. A reservation that books anything else is not restored. */
  readonly expectedBooking: DotyposReservationBooking;
}
