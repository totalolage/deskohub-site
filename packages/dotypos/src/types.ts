import { Schema } from "effect";
import {
  type CreateReservationRequest,
  Category as GeneratedCategorySchema,
  Customer as GeneratedCustomerSchema,
  DiscountGroup as GeneratedDiscountGroupSchema,
  Product as GeneratedProductSchema,
  Reservation as GeneratedReservationSchema,
  Table as GeneratedTableSchema,
  WarehouseProduct as GeneratedWarehouseProductSchema,
  Warehouse as GeneratedWarehouseSchema,
} from "./generated";

const dotyposOpaqueId = <const BrandName extends string>(
  brand: BrandName,
  description: string
) =>
  Schema.Trim.check(Schema.isNonEmpty()).pipe(Schema.brand(brand)).annotate({
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

export const DotyposWarehouseIdSchema = dotyposOpaqueId(
  "DotyposWarehouseId",
  "Opaque identifier assigned to a Dotypos warehouse."
);
export type DotyposWarehouseId = typeof DotyposWarehouseIdSchema.Type;

export const DotyposDiscountGroupIdSchema = dotyposOpaqueId(
  "DotyposDiscountGroupId",
  "Opaque identifier assigned to a Dotypos discount group."
);
export type DotyposDiscountGroupId = typeof DotyposDiscountGroupIdSchema.Type;

export const DotyposReservationSchema = Schema.Struct({
  ...GeneratedReservationSchema.fields,
  id: Schema.optionalKey(DotyposReservationIdSchema),
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
  id: Schema.optionalKey(DotyposCustomerIdSchema),
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
  id: Schema.optionalKey(DotyposTableIdSchema),
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

export const DotyposWarehouseSchema = Schema.Struct({
  ...GeneratedWarehouseSchema.fields,
  id: DotyposWarehouseIdSchema,
  _cloudId: DotyposCloudIdSchema,
}).annotate({
  identifier: "DotyposWarehouse",
  description: "A Dotypos warehouse with provider identifiers decoded by role.",
});
export type DotyposWarehouse = typeof DotyposWarehouseSchema.Type;

export const DotyposWarehouseProductSchema = Schema.Struct({
  ...GeneratedWarehouseProductSchema.fields,
  id: Schema.optionalKey(DotyposProductIdSchema),
  _categoryId: DotyposCategoryIdSchema,
  _cloudId: Schema.optionalKey(DotyposCloudIdSchema),
  _warehouseId: DotyposWarehouseIdSchema,
}).annotate({
  identifier: "DotyposWarehouseProduct",
  description: "A Dotypos product with backend-only warehouse stock status.",
});
export type DotyposWarehouseProduct = typeof DotyposWarehouseProductSchema.Type;

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

export interface CreateDotyposReservationInput
  extends DotyposReservationInterval {
  readonly customerId: DotyposCustomerId;
  readonly seats: number;
  readonly tableId: DotyposTableId;
  readonly status: DotyposReservationStatus;
  readonly note?: string;
}

export interface UpdateDotyposReservationInput {
  readonly reservationId: DotyposReservationId;
  readonly note: string;
}

export interface DeductDotyposWarehouseStockItem {
  readonly productId: DotyposProductId;
  readonly quantity: number;
  readonly note?: string;
}
