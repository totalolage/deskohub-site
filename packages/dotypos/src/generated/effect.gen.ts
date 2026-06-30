import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
// non-recursive definitions
export type TokenRequest = { readonly "_cloudId"?: string }
export const TokenRequest = Schema.Struct({ "_cloudId": Schema.optionalKey(Schema.String.annotate({ "description": "Cloud ID for cloud-specific token (optional)" })) })
export type TokenResponse = { readonly "accessToken": string }
export const TokenResponse = Schema.Struct({ "accessToken": Schema.String.annotate({ "description": "JWT access token for API authentication" }) })
export type CreateReservationRequest = { readonly "_branchId": string, readonly "_cloudId": string, readonly "_customerId": string, readonly "_employeeId"?: string, readonly "_tableId"?: string, readonly "flags"?: number, readonly "startDate": number, readonly "endDate": number, readonly "seats": number, readonly "status": "NEW" | "CONFIRMED" | "CANCELLED", readonly "note"?: string }
export const CreateReservationRequest = Schema.Struct({ "_branchId": Schema.String.annotate({ "description": "Branch ID (long as string)" }), "_cloudId": Schema.String.annotate({ "description": "Cloud ID (long as string)" }), "_customerId": Schema.String.annotate({ "description": "Customer ID (long as string)" }), "_employeeId": Schema.optionalKey(Schema.String.annotate({ "description": "Employee ID (long as string)" })), "_tableId": Schema.optionalKey(Schema.String.annotate({ "description": "Table ID (long as string)", "default": "0" })), "flags": Schema.optionalKey(Schema.Number.annotate({ "description": "Reservation flags (bitwise flags)", "default": 0 }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))), "startDate": Schema.Number.annotate({ "description": "Start date/time as Unix timestamp in milliseconds" }).check(Schema.isInt()), "endDate": Schema.Number.annotate({ "description": "End date/time as Unix timestamp in milliseconds" }).check(Schema.isInt()), "seats": Schema.Number.annotate({ "description": "Number of seats/guests" }).check(Schema.isInt()), "status": Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"]), "note": Schema.optionalKey(Schema.String.annotate({ "description": "Additional notes (used for customer info)" })) })
export type UpdateReservationRequest = { readonly "startDate"?: number, readonly "endDate"?: number, readonly "seats"?: number, readonly "status"?: "NEW" | "CONFIRMED" | "CANCELLED", readonly "note"?: string }
export const UpdateReservationRequest = Schema.Struct({ "startDate": Schema.optionalKey(Schema.Number.annotate({ "description": "Start date/time as Unix timestamp in milliseconds" }).check(Schema.isInt())), "endDate": Schema.optionalKey(Schema.Number.annotate({ "description": "End date/time as Unix timestamp in milliseconds" }).check(Schema.isInt())), "seats": Schema.optionalKey(Schema.Number.annotate({ "description": "Number of seats/guests" }).check(Schema.isInt())), "status": Schema.optionalKey(Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"])), "note": Schema.optionalKey(Schema.String.annotate({ "description": "Additional notes" })) })
export type Reservation = { readonly "id"?: string, readonly "_branchId": string, readonly "_cloudId": string, readonly "_customerId"?: string, readonly "_employeeId"?: string, readonly "_tableId"?: string, readonly "created"?: string, readonly "flags"?: string, readonly "startDate": string, readonly "endDate": string, readonly "seats": string, readonly "status": "NEW" | "CONFIRMED" | "CANCELLED", readonly "note"?: string, readonly "versionDate"?: string }
export const Reservation = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Reservation ID (long as string)" })), "_branchId": Schema.String.annotate({ "description": "Branch ID (long as string)" }), "_cloudId": Schema.String.annotate({ "description": "Cloud ID (long as string)" }), "_customerId": Schema.optionalKey(Schema.String.annotate({ "description": "Customer ID (long)" })), "_employeeId": Schema.optionalKey(Schema.String.annotate({ "description": "Employee ID (long)" })), "_tableId": Schema.optionalKey(Schema.String.annotate({ "description": "Table ID (long)" })), "created": Schema.optionalKey(Schema.String.annotate({ "description": "Creation timestamp (ISO 8601 format)" })), "flags": Schema.optionalKey(Schema.String.annotate({ "description": "Reservation flags (string representation)" })), "startDate": Schema.String.annotate({ "description": "Start date/time (ISO 8601 format)" }), "endDate": Schema.String.annotate({ "description": "End date/time (ISO 8601 format)" }), "seats": Schema.String.annotate({ "description": "Number of seats (string representation)" }), "status": Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"]).annotate({ "description": "Reservation status" }), "note": Schema.optionalKey(Schema.String.annotate({ "description": "Additional notes" })), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last update timestamp (ISO 8601 format)" })) })
export type Customer = { readonly "id"?: string, readonly "_cloudId": string, readonly "_discountGroupId"?: string | null, readonly "_sellerId"?: string | null, readonly "firstName"?: string | null, readonly "lastName"?: string | null, readonly "companyName"?: string | null, readonly "companyId"?: string | null, readonly "email"?: string | null, readonly "phone"?: string | null, readonly "addressLine1"?: string | null, readonly "addressLine2"?: string | null, readonly "city"?: string | null, readonly "zip"?: string | null, readonly "country"?: string | null, readonly "vatId"?: string | null, readonly "barcode"?: string | null, readonly "birthday"?: string | null, readonly "created"?: string | null, readonly "expireDate"?: string | null, readonly "externalId"?: string | null, readonly "headerPrint"?: string | null, readonly "hexColor"?: string | null, readonly "internalNote"?: string | null, readonly "modifiedBy"?: string | null, readonly "note"?: string | null, readonly "tags"?: ReadonlyArray<string> | null, readonly "points": string | null, readonly "flags": string, readonly "display": boolean, readonly "deleted": boolean, readonly "versionDate"?: string }
export const Customer = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Customer ID" })), "_cloudId": Schema.String.annotate({ "description": "Cloud ID" }), "_discountGroupId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Discount group ID" })), "_sellerId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Seller ID" })), "firstName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "First name (at least one of firstName, lastName, or companyName must be non-blank)" })), "lastName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Last name (at least one of firstName, lastName, or companyName must be non-blank)" })), "companyName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Company name (at least one of firstName, lastName, or companyName must be non-blank)" })), "companyId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Company ID" })), "email": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Email address" })), "phone": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Phone number" })), "addressLine1": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Address line 1" })), "addressLine2": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Address line 2" })), "city": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "City" })), "zip": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "ZIP code" })), "country": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Country code" })), "vatId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "VAT ID" })), "barcode": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer barcode" })), "birthday": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Birthday timestamp" })), "created": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Creation timestamp (ISO 8601)" })), "expireDate": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Expiration date timestamp" })), "externalId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "External ID" })), "headerPrint": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Header print text" })), "hexColor": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Hex color code" })), "internalNote": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Internal note" })), "modifiedBy": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Modified by user ID (string representation)" })), "note": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer note" })), "tags": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Customer tags" })), "points": Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer points (string representation of number)" }), "flags": Schema.String.annotate({ "description": "Customer flags (string representation of long)" }), "display": Schema.Boolean.annotate({ "description": "Is displayed" }), "deleted": Schema.Boolean.annotate({ "description": "Is deleted" }), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last modification timestamp (ISO 8601)" })) })
export type CreateCustomerRequest = { readonly "_cloudId": string, readonly "firstName": string, readonly "lastName": string, readonly "flags": string, readonly "email": string, readonly "phone": string, readonly "addressLine1": string, readonly "addressLine2"?: string | null, readonly "city"?: string | null, readonly "zip": string, readonly "country"?: string | null, readonly "companyName": string, readonly "vatId": string, readonly "note"?: string | null, readonly "display": boolean, readonly "deleted": boolean, readonly "points": string, readonly "internalNote": string, readonly "companyId": string, readonly "hexColor": string, readonly "headerPrint": string, readonly "tags": ReadonlyArray<string>, readonly "barcode": string, readonly "expireDate"?: number | string | null }
export const CreateCustomerRequest = Schema.Struct({ "_cloudId": Schema.String.annotate({ "description": "Cloud ID" }), "firstName": Schema.String.annotate({ "description": "First name" }), "lastName": Schema.String.annotate({ "description": "Last name", "default": "" }), "flags": Schema.String.annotate({ "description": "Customer flags (bitwise flags)", "default": "0" }), "email": Schema.String.annotate({ "description": "Email address" }), "phone": Schema.String.annotate({ "description": "Phone number" }), "addressLine1": Schema.String.annotate({ "description": "Address line 1", "default": "" }), "addressLine2": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Address line 2", "default": null })), "city": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "City", "default": null })), "zip": Schema.String.annotate({ "description": "ZIP code", "default": "" }), "country": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Country code", "default": null })), "companyName": Schema.String.annotate({ "description": "Company name", "default": "" }), "vatId": Schema.String.annotate({ "description": "VAT ID", "default": "" }), "note": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer note", "default": null })), "display": Schema.Boolean.annotate({ "description": "Is displayed", "default": true }), "deleted": Schema.Boolean.annotate({ "description": "Is deleted", "default": false }), "points": Schema.String.annotate({ "description": "Customer points", "default": "0" }), "internalNote": Schema.String.annotate({ "description": "Internal note", "default": "" }), "companyId": Schema.String.annotate({ "description": "Company ID", "default": "" }), "hexColor": Schema.String.annotate({ "description": "Hex color for customer", "default": "#000000" }), "headerPrint": Schema.String.annotate({ "description": "Header print text", "default": "" }), "tags": Schema.Array(Schema.String).annotate({ "description": "Customer tags", "default": [] }), "barcode": Schema.String.annotate({ "description": "Customer barcode", "default": "" }), "expireDate": Schema.optionalKey(Schema.Union([Schema.Union([Schema.Number.annotate({ "description": "Unix timestamp (seconds or milliseconds since epoch)", "examples": [1735689600] }).check(Schema.isInt()), Schema.String.annotate({ "description": "ISO 8601 datetime string", "examples": ["2025-01-01T00:00:00Z"], "format": "date-time" })], { mode: "oneOf" }).annotate({ "description": "Expiration date as either a Unix timestamp (seconds or milliseconds) or an ISO 8601 datetime string." }), Schema.Null])) })
export type UpdateCustomerRequest = { readonly "firstName"?: string, readonly "lastName"?: string, readonly "email"?: string, readonly "phone"?: string, readonly "addressLine1"?: string, readonly "addressLine2"?: string, readonly "city"?: string, readonly "zip"?: string, readonly "country"?: string, readonly "companyName"?: string, readonly "vatId"?: string, readonly "note"?: string, readonly "display"?: boolean, readonly "deleted"?: boolean, readonly "points"?: string, readonly "internalNote"?: string, readonly "hexColor"?: string, readonly "headerPrint"?: string, readonly "tags"?: ReadonlyArray<string>, readonly "barcode"?: string, readonly "companyId"?: string, readonly "flags"?: number }
export const UpdateCustomerRequest = Schema.Struct({ "firstName": Schema.optionalKey(Schema.String.annotate({ "description": "First name" })), "lastName": Schema.optionalKey(Schema.String.annotate({ "description": "Last name" })), "email": Schema.optionalKey(Schema.String.annotate({ "description": "Email address" })), "phone": Schema.optionalKey(Schema.String.annotate({ "description": "Phone number" })), "addressLine1": Schema.optionalKey(Schema.String.annotate({ "description": "Address line 1" })), "addressLine2": Schema.optionalKey(Schema.String.annotate({ "description": "Address line 2" })), "city": Schema.optionalKey(Schema.String.annotate({ "description": "City" })), "zip": Schema.optionalKey(Schema.String.annotate({ "description": "ZIP code" })), "country": Schema.optionalKey(Schema.String.annotate({ "description": "Country code" })), "companyName": Schema.optionalKey(Schema.String.annotate({ "description": "Company name" })), "vatId": Schema.optionalKey(Schema.String.annotate({ "description": "VAT ID" })), "note": Schema.optionalKey(Schema.String.annotate({ "description": "Customer note" })), "display": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is displayed" })), "deleted": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is deleted" })), "points": Schema.optionalKey(Schema.String.annotate({ "description": "Customer points" })), "internalNote": Schema.optionalKey(Schema.String.annotate({ "description": "Internal note" })), "hexColor": Schema.optionalKey(Schema.String.annotate({ "description": "Hex color for customer" })), "headerPrint": Schema.optionalKey(Schema.String.annotate({ "description": "Header print text" })), "tags": Schema.optionalKey(Schema.Array(Schema.String).annotate({ "description": "Customer tags" })), "barcode": Schema.optionalKey(Schema.String.annotate({ "description": "Customer barcode" })), "companyId": Schema.optionalKey(Schema.String.annotate({ "description": "Company ID" })), "flags": Schema.optionalKey(Schema.Number.annotate({ "description": "Customer flags (bitwise flags)" }).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))) })
export type Table = { readonly "id"?: string, readonly "_branchId"?: string, readonly "_cloudId": string, readonly "_sellerId"?: string | null, readonly "_tableGroupId"?: string, readonly "name": string, readonly "seats"?: string, readonly "display"?: boolean, readonly "enabled"?: boolean, readonly "locationName"?: string, readonly "positionX"?: string, readonly "positionY"?: string, readonly "rotation"?: string, readonly "type"?: "SQUARE" | "SQUARE6" | "CIRCLE2" | "CIRCLE4" | "DELIVERY" | "CHAIR_SINGLE" | "ROUND" | "DOOR" | "GENERIC" | "CAR1" | "CAR2", readonly "tags"?: ReadonlyArray<string>, readonly "versionDate"?: string }
export const Table = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Table ID (long as string)" })), "_branchId": Schema.optionalKey(Schema.String.annotate({ "description": "Branch ID (long as string)" })), "_cloudId": Schema.String.annotate({ "description": "Cloud ID (long as string)" }), "_sellerId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Seller ID (long as string)" })), "_tableGroupId": Schema.optionalKey(Schema.String.annotate({ "description": "Table group ID (long as string)" })), "name": Schema.String.annotate({ "description": "Table name/number" }).check(Schema.isMaxLength(180)), "seats": Schema.optionalKey(Schema.String.annotate({ "description": "Number of seats (string representation)" })), "display": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is displayed" })), "enabled": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is enabled" })), "locationName": Schema.optionalKey(Schema.String.annotate({ "description": "Location name" })), "positionX": Schema.optionalKey(Schema.String.annotate({ "description": "X position (string representation)" })), "positionY": Schema.optionalKey(Schema.String.annotate({ "description": "Y position (string representation)" })), "rotation": Schema.optionalKey(Schema.String.annotate({ "description": "Rotation angle (string representation)" })), "type": Schema.optionalKey(Schema.Literals(["SQUARE", "SQUARE6", "CIRCLE2", "CIRCLE4", "DELIVERY", "CHAIR_SINGLE", "ROUND", "DOOR", "GENERIC", "CAR1", "CAR2"]).annotate({ "description": "Table type" })), "tags": Schema.optionalKey(Schema.Array(Schema.String).annotate({ "description": "Table tags" })), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last modification timestamp (ISO 8601)" })) })
export type Product = { readonly "id"?: string, readonly "_categoryId": string, readonly "_cloudId"?: string, readonly "name": string, readonly "alternativeName"?: string | null, readonly "description"?: string | null, readonly "ean"?: ReadonlyArray<string> | string | null, readonly "externalId"?: string | null, readonly "flags"?: string, readonly "hexColor"?: string | null, readonly "imageUrl"?: string | null, readonly "minMargin"?: string | null, readonly "modifiedBy"?: string | null, readonly "packaging"?: string | null, readonly "packageSize"?: string | null, readonly "points"?: string | null, readonly "priceWithVat"?: string | null, readonly "priceWithoutVat": string, readonly "printTicket"?: boolean | null, readonly "stockDeduct"?: boolean | null, readonly "subtitle"?: string | null, readonly "tags"?: ReadonlyArray<string> | string | null, readonly "translatedDescription"?: { readonly [x: string]: string } | null, readonly "translatedName"?: { readonly [x: string]: string } | null, readonly "unit"?: string, readonly "vat": string, readonly "versionDate"?: string, readonly "deleted"?: boolean | null, readonly "display"?: boolean | null }
export const Product = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Product ID (long as string)" })), "_categoryId": Schema.String.annotate({ "description": "Category ID (long as string)" }), "_cloudId": Schema.optionalKey(Schema.String.annotate({ "description": "Cloud ID (long as string)" })), "name": Schema.String.annotate({ "description": "Product name" }).check(Schema.isMaxLength(255)), "alternativeName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Alternative product name" })), "description": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Product description" })), "ean": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Union([Schema.String, Schema.Null])], { mode: "oneOf" }).annotate({ "description": "EAN codes (can be array or string)" })), "externalId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "External ID" })), "flags": Schema.optionalKey(Schema.String.annotate({ "description": "Product flags (string representation)" })), "hexColor": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Hex color code" })), "imageUrl": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Product image URL" })), "minMargin": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Minimum margin (string representation)" })), "modifiedBy": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Modified by user ID" })), "packaging": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Packaging information" })), "packageSize": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Package size (string representation)" })), "points": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Points value (string representation)" })), "priceWithVat": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Price with VAT (string representation)" })), "priceWithoutVat": Schema.String.annotate({ "description": "Price without VAT (string representation)" }), "printTicket": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null]).annotate({ "description": "Print ticket flag" })), "stockDeduct": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null]).annotate({ "description": "Stock deduction flag" })), "subtitle": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Product subtitle" })), "tags": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Union([Schema.String, Schema.Null])], { mode: "oneOf" }).annotate({ "description": "Product tags (can be array or string)" })), "translatedDescription": Schema.optionalKey(Schema.Union([Schema.Record(Schema.String, Schema.String).annotate({ "description": "Map of locale codes to translated strings (e.g., {\"en\": \"English text\", \"cs\": \"Czech text\"})", "examples": [{"en":"English text","cs":"Český text","de":"Deutscher Text"}] }), Schema.Null])), "translatedName": Schema.optionalKey(Schema.Union([Schema.Record(Schema.String, Schema.String).annotate({ "description": "Map of locale codes to translated strings (e.g., {\"en\": \"English text\", \"cs\": \"Czech text\"})", "examples": [{"en":"English text","cs":"Český text","de":"Deutscher Text"}] }), Schema.Null])), "unit": Schema.optionalKey(Schema.String.annotate({ "description": "Unit of measurement (actual values vary from documented enum)" })), "vat": Schema.String.annotate({ "description": "VAT rate (string representation)" }), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last modification timestamp (ISO 8601)" })), "deleted": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null]).annotate({ "description": "Is deleted" })), "display": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null]).annotate({ "description": "Is displayed" })) })
export type Category = { readonly "id"?: string, readonly "_cloudId"?: string, readonly "name"?: string, readonly "hexColor"?: string | null, readonly "deleted"?: boolean, readonly "display"?: boolean, readonly "externalId"?: string | null, readonly "flags"?: string, readonly "fiscalName"?: string | null, readonly "ordering"?: string | null, readonly "translatedName"?: { readonly [x: string]: string } | null, readonly "versionDate"?: string, readonly "tags"?: ReadonlyArray<string> | null }
export const Category = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Category ID (long as string)" })), "_cloudId": Schema.optionalKey(Schema.String.annotate({ "description": "Cloud ID (long as string)" })), "name": Schema.optionalKey(Schema.String.annotate({ "description": "Category name" })), "hexColor": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Hex color for the category" })), "deleted": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is deleted" })), "display": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is displayed" })), "externalId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "External ID" })), "flags": Schema.optionalKey(Schema.String.annotate({ "description": "Category flags (string representation of long)" })), "fiscalName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Fiscal name for the category" })), "ordering": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Sort order (string representation)" })), "translatedName": Schema.optionalKey(Schema.Union([Schema.Record(Schema.String, Schema.String).annotate({ "description": "Map of locale codes to translated strings (e.g., {\"en\": \"English text\", \"cs\": \"Czech text\"})", "examples": [{"en":"English text","cs":"Český text","de":"Deutscher Text"}] }), Schema.Null])), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last modification timestamp (ISO 8601)" })), "tags": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Category tags" })) })
export type PatchProductRequest = { readonly [x: string]: Schema.Json }
export const PatchProductRequest = Schema.Record(Schema.String, Schema.Json).annotate({ "description": "Partial product object for PATCH requests" })
export type DeleteProductRequest = { readonly "productIsIngredient"?: "ERROR" | "PRESERVE" | "DELETE", readonly "productHasIngredients"?: "ERROR" | "PRESERVE" | "DELETE" }
export const DeleteProductRequest = Schema.Struct({ "productIsIngredient": Schema.optionalKey(Schema.Literals(["ERROR", "PRESERVE", "DELETE"]).annotate({ "description": "Strategy when the product is an ingredient" })), "productHasIngredients": Schema.optionalKey(Schema.Literals(["ERROR", "PRESERVE", "DELETE"]).annotate({ "description": "Strategy when the product has ingredients" })) })
export type PatchCategoryRequest = { readonly [x: string]: Schema.Json }
export const PatchCategoryRequest = Schema.Record(Schema.String, Schema.Json).annotate({ "description": "Partial category object for PATCH requests" })
export type ErrorResponse = { readonly "error"?: string, readonly "error_description"?: string, readonly "code"?: number }
export const ErrorResponse = Schema.Struct({ "error": Schema.optionalKey(Schema.String), "error_description": Schema.optionalKey(Schema.String), "code": Schema.optionalKey(Schema.Number.check(Schema.isInt())) })
export type PaginatedReservations = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Reservation> }
export const PaginatedReservations = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Reservation).annotate({ "description": "Array of reservations" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses" })
export type PaginatedCustomers = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Customer> }
export const PaginatedCustomers = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Customer).annotate({ "description": "Array of customers" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses" })
export type PaginatedTables = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Table> }
export const PaginatedTables = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Table).annotate({ "description": "Array of tables" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses" })
export type PaginatedProducts = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Product> }
export const PaginatedProducts = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Product).annotate({ "description": "Array of products" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses" })
export type PaginatedCategories = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Category> }
export const PaginatedCategories = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Category).annotate({ "description": "Array of categories" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses" })
// schemas
export type GetAccessTokenParams = { readonly "Authorization": string }
export const GetAccessTokenParams = Schema.Struct({ "Authorization": Schema.String.annotate({ "description": "User {refresh_token}" }) })
export type GetAccessTokenRequestJson = TokenRequest
export const GetAccessTokenRequestJson = TokenRequest
export type GetAccessToken201 = TokenResponse
export const GetAccessToken201 = TokenResponse
export type GetAccessToken400 = ErrorResponse
export const GetAccessToken400 = ErrorResponse
export type GetAccessToken401 = ErrorResponse
export const GetAccessToken401 = ErrorResponse
export type ListReservationsParams = { readonly "page"?: number, readonly "limit"?: number }
export const ListReservationsParams = Schema.Struct({ "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt())), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(100))) })
export type ListReservations200 = PaginatedReservations
export const ListReservations200 = PaginatedReservations
export type ListReservations401 = ErrorResponse
export const ListReservations401 = ErrorResponse
export type ListReservations404 = ErrorResponse
export const ListReservations404 = ErrorResponse
export type ReplaceReservationsParams = { readonly "If-Match"?: string }
export const ReplaceReservationsParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceReservationsRequestJson = ReadonlyArray<Reservation>
export const ReplaceReservationsRequestJson = Schema.Array(Reservation).check(Schema.isMaxLength(100))
export type ReplaceReservations200 = ReadonlyArray<Reservation>
export const ReplaceReservations200 = Schema.Array(Reservation)
export type ReplaceReservations400 = ErrorResponse
export const ReplaceReservations400 = ErrorResponse
export type ReplaceReservations401 = ErrorResponse
export const ReplaceReservations401 = ErrorResponse
export type CreateReservationRequestJson = ReadonlyArray<CreateReservationRequest>
export const CreateReservationRequestJson = Schema.Array(CreateReservationRequest).annotate({ "description": "Array of reservations to create (max 100)" }).check(Schema.isMaxLength(100))
export type CreateReservation200 = ReadonlyArray<Reservation>
export const CreateReservation200 = Schema.Array(Reservation)
export type CreateReservation400 = ErrorResponse
export const CreateReservation400 = ErrorResponse
export type CreateReservation401 = ErrorResponse
export const CreateReservation401 = ErrorResponse
export type GetReservation200 = Reservation
export const GetReservation200 = Reservation
export type GetReservation401 = ErrorResponse
export const GetReservation401 = ErrorResponse
export type GetReservation404 = ErrorResponse
export const GetReservation404 = ErrorResponse
export type UpdateReservationRequestJson = UpdateReservationRequest
export const UpdateReservationRequestJson = UpdateReservationRequest
export type UpdateReservation200 = Reservation
export const UpdateReservation200 = Reservation
export type UpdateReservation401 = ErrorResponse
export const UpdateReservation401 = ErrorResponse
export type UpdateReservation404 = ErrorResponse
export const UpdateReservation404 = ErrorResponse
export type CancelReservation401 = ErrorResponse
export const CancelReservation401 = ErrorResponse
export type CancelReservation404 = ErrorResponse
export const CancelReservation404 = ErrorResponse
export type PatchReservationParams = { readonly "If-Match": string }
export const PatchReservationParams = Schema.Struct({ "If-Match": Schema.String })
export type PatchReservationRequestJson = UpdateReservationRequest
export const PatchReservationRequestJson = UpdateReservationRequest
export type PatchReservation200 = Reservation
export const PatchReservation200 = Reservation
export type PatchReservation400 = ErrorResponse
export const PatchReservation400 = ErrorResponse
export type PatchReservation401 = ErrorResponse
export const PatchReservation401 = ErrorResponse
export type PatchReservation404 = ErrorResponse
export const PatchReservation404 = ErrorResponse
export type GetCustomersParams = { readonly "filter"?: string, readonly "page"?: number, readonly "limit"?: number }
export const GetCustomersParams = Schema.Struct({ "filter": Schema.optionalKey(Schema.String), "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt())), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(100))) })
export type GetCustomers200 = PaginatedCustomers
export const GetCustomers200 = PaginatedCustomers
export type GetCustomers401 = ErrorResponse
export const GetCustomers401 = ErrorResponse
export type ReplaceCustomersParams = { readonly "If-Match"?: string }
export const ReplaceCustomersParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceCustomersRequestJson = ReadonlyArray<Customer>
export const ReplaceCustomersRequestJson = Schema.Array(Customer)
export type ReplaceCustomers200 = ReadonlyArray<Customer>
export const ReplaceCustomers200 = Schema.Array(Customer)
export type ReplaceCustomers400 = ErrorResponse
export const ReplaceCustomers400 = ErrorResponse
export type ReplaceCustomers401 = ErrorResponse
export const ReplaceCustomers401 = ErrorResponse
export type CreateCustomersRequestJson = ReadonlyArray<CreateCustomerRequest>
export const CreateCustomersRequestJson = Schema.Array(CreateCustomerRequest)
export type CreateCustomers200 = ReadonlyArray<Customer>
export const CreateCustomers200 = Schema.Array(Customer)
export type CreateCustomers400 = ErrorResponse
export const CreateCustomers400 = ErrorResponse
export type CreateCustomers401 = ErrorResponse
export const CreateCustomers401 = ErrorResponse
export type GetTablesParams = { readonly "page"?: number, readonly "limit"?: number }
export const GetTablesParams = Schema.Struct({ "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt())), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(100))) })
export type GetTables200 = PaginatedTables
export const GetTables200 = PaginatedTables
export type GetTables401 = ErrorResponse
export const GetTables401 = ErrorResponse
export type GetTable200 = Table
export const GetTable200 = Table
export type GetTable401 = ErrorResponse
export const GetTable401 = ErrorResponse
export type GetTable404 = ErrorResponse
export const GetTable404 = ErrorResponse
export type GetProductsParams = { readonly "filter"?: string, readonly "sort"?: string, readonly "page"?: number, readonly "limit"?: number, readonly "include"?: string }
export const GetProductsParams = Schema.Struct({ "filter": Schema.optionalKey(Schema.String), "sort": Schema.optionalKey(Schema.String), "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt())), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(100))), "include": Schema.optionalKey(Schema.String) })
export type GetProducts200 = PaginatedProducts
export const GetProducts200 = PaginatedProducts
export type GetProducts401 = ErrorResponse
export const GetProducts401 = ErrorResponse
export type ReplaceProductsParams = { readonly "If-Match"?: string }
export const ReplaceProductsParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceProductsRequestJson = ReadonlyArray<Product>
export const ReplaceProductsRequestJson = Schema.Array(Product).check(Schema.isMaxLength(100))
export type ReplaceProducts200 = ReadonlyArray<Product>
export const ReplaceProducts200 = Schema.Array(Product)
export type ReplaceProducts400 = ErrorResponse
export const ReplaceProducts400 = ErrorResponse
export type ReplaceProducts401 = ErrorResponse
export const ReplaceProducts401 = ErrorResponse
export type CreateProductsRequestJson = ReadonlyArray<Product>
export const CreateProductsRequestJson = Schema.Array(Product).check(Schema.isMaxLength(100))
export type CreateProducts200 = ReadonlyArray<Product>
export const CreateProducts200 = Schema.Array(Product)
export type CreateProducts400 = ErrorResponse
export const CreateProducts400 = ErrorResponse
export type CreateProducts401 = ErrorResponse
export const CreateProducts401 = ErrorResponse
export type GetProductParams = { readonly "include"?: string }
export const GetProductParams = Schema.Struct({ "include": Schema.optionalKey(Schema.String) })
export type GetProduct200 = Product
export const GetProduct200 = Product
export type GetProduct401 = ErrorResponse
export const GetProduct401 = ErrorResponse
export type GetProduct404 = ErrorResponse
export const GetProduct404 = ErrorResponse
export type ReplaceProductParams = { readonly "If-Match"?: string }
export const ReplaceProductParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceProductRequestJson = Product
export const ReplaceProductRequestJson = Product
export type ReplaceProduct200 = Product
export const ReplaceProduct200 = Product
export type ReplaceProduct400 = ErrorResponse
export const ReplaceProduct400 = ErrorResponse
export type ReplaceProduct401 = ErrorResponse
export const ReplaceProduct401 = ErrorResponse
export type ReplaceProduct404 = ErrorResponse
export const ReplaceProduct404 = ErrorResponse
export type DeleteProductParams = { readonly "If-Match"?: string }
export const DeleteProductParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type DeleteProductRequestJson = DeleteProductRequest
export const DeleteProductRequestJson = DeleteProductRequest
export type DeleteProduct200 = {  }
export const DeleteProduct200 = Schema.Struct({  })
export type DeleteProduct401 = ErrorResponse
export const DeleteProduct401 = ErrorResponse
export type DeleteProduct404 = ErrorResponse
export const DeleteProduct404 = ErrorResponse
export type DeleteProduct409 = ErrorResponse
export const DeleteProduct409 = ErrorResponse
export type PatchProductParams = { readonly "If-Match": string }
export const PatchProductParams = Schema.Struct({ "If-Match": Schema.String })
export type PatchProductRequestJson = PatchProductRequest
export const PatchProductRequestJson = PatchProductRequest
export type PatchProduct200 = Product
export const PatchProduct200 = Product
export type PatchProduct400 = ErrorResponse
export const PatchProduct400 = ErrorResponse
export type PatchProduct401 = ErrorResponse
export const PatchProduct401 = ErrorResponse
export type PatchProduct404 = ErrorResponse
export const PatchProduct404 = ErrorResponse
export type GetCategoriesParams = { readonly "page"?: number, readonly "limit"?: number, readonly "filter"?: string, readonly "sort"?: string }
export const GetCategoriesParams = Schema.Struct({ "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt())), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo(100))), "filter": Schema.optionalKey(Schema.String), "sort": Schema.optionalKey(Schema.String) })
export type GetCategories200 = PaginatedCategories
export const GetCategories200 = PaginatedCategories
export type GetCategories401 = ErrorResponse
export const GetCategories401 = ErrorResponse
export type ReplaceCategoriesParams = { readonly "If-Match"?: string }
export const ReplaceCategoriesParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceCategoriesRequestJson = ReadonlyArray<Category>
export const ReplaceCategoriesRequestJson = Schema.Array(Category).check(Schema.isMaxLength(100))
export type ReplaceCategories200 = ReadonlyArray<Category>
export const ReplaceCategories200 = Schema.Array(Category)
export type ReplaceCategories400 = ErrorResponse
export const ReplaceCategories400 = ErrorResponse
export type ReplaceCategories401 = ErrorResponse
export const ReplaceCategories401 = ErrorResponse
export type CreateCategoriesRequestJson = ReadonlyArray<Category>
export const CreateCategoriesRequestJson = Schema.Array(Category).check(Schema.isMaxLength(100))
export type CreateCategories200 = ReadonlyArray<Category>
export const CreateCategories200 = Schema.Array(Category)
export type CreateCategories400 = ErrorResponse
export const CreateCategories400 = ErrorResponse
export type CreateCategories401 = ErrorResponse
export const CreateCategories401 = ErrorResponse
export type GetCategory200 = Category
export const GetCategory200 = Category
export type GetCategory401 = ErrorResponse
export const GetCategory401 = ErrorResponse
export type GetCategory404 = ErrorResponse
export const GetCategory404 = ErrorResponse
export type ReplaceCategoryParams = { readonly "If-Match"?: string }
export const ReplaceCategoryParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceCategoryRequestJson = Category
export const ReplaceCategoryRequestJson = Category
export type ReplaceCategory200 = Category
export const ReplaceCategory200 = Category
export type ReplaceCategory400 = ErrorResponse
export const ReplaceCategory400 = ErrorResponse
export type ReplaceCategory401 = ErrorResponse
export const ReplaceCategory401 = ErrorResponse
export type ReplaceCategory404 = ErrorResponse
export const ReplaceCategory404 = ErrorResponse
export type DeleteCategoryParams = { readonly "If-Match"?: string }
export const DeleteCategoryParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type DeleteCategory401 = ErrorResponse
export const DeleteCategory401 = ErrorResponse
export type DeleteCategory404 = ErrorResponse
export const DeleteCategory404 = ErrorResponse
export type DeleteCategory409 = ErrorResponse
export const DeleteCategory409 = ErrorResponse
export type PatchCategoryParams = { readonly "If-Match": string }
export const PatchCategoryParams = Schema.Struct({ "If-Match": Schema.String })
export type PatchCategoryRequestJson = PatchCategoryRequest
export const PatchCategoryRequestJson = PatchCategoryRequest
export type PatchCategory200 = Category
export const PatchCategory200 = Category
export type PatchCategory400 = ErrorResponse
export const PatchCategory400 = ErrorResponse
export type PatchCategory401 = ErrorResponse
export const PatchCategory401 = ErrorResponse
export type PatchCategory404 = ErrorResponse
export const PatchCategory404 = ErrorResponse
export type GetCustomer200 = Customer
export const GetCustomer200 = Customer
export type GetCustomer401 = ErrorResponse
export const GetCustomer401 = ErrorResponse
export type GetCustomer404 = ErrorResponse
export const GetCustomer404 = ErrorResponse
export type UpdateCustomerRequestJson = UpdateCustomerRequest
export const UpdateCustomerRequestJson = UpdateCustomerRequest
export type UpdateCustomer200 = Customer
export const UpdateCustomer200 = Customer
export type UpdateCustomer400 = ErrorResponse
export const UpdateCustomer400 = ErrorResponse
export type UpdateCustomer401 = ErrorResponse
export const UpdateCustomer401 = ErrorResponse
export type UpdateCustomer404 = ErrorResponse
export const UpdateCustomer404 = ErrorResponse
export type DeleteCustomerParams = { readonly "anonymize"?: boolean, readonly "If-Match"?: string }
export const DeleteCustomerParams = Schema.Struct({ "anonymize": Schema.optionalKey(Schema.Boolean), "If-Match": Schema.optionalKey(Schema.String) })
export type DeleteCustomer401 = ErrorResponse
export const DeleteCustomer401 = ErrorResponse
export type DeleteCustomer404 = ErrorResponse
export const DeleteCustomer404 = ErrorResponse
export type PatchCustomerParams = { readonly "If-Match": string }
export const PatchCustomerParams = Schema.Struct({ "If-Match": Schema.String })
export type PatchCustomerRequestJson = UpdateCustomerRequest
export const PatchCustomerRequestJson = UpdateCustomerRequest
export type PatchCustomer200 = Customer
export const PatchCustomer200 = Customer
export type PatchCustomer400 = ErrorResponse
export const PatchCustomer400 = ErrorResponse
export type PatchCustomer401 = ErrorResponse
export const PatchCustomer401 = ErrorResponse
export type PatchCustomer404 = ErrorResponse
export const PatchCustomer404 = ErrorResponse

export interface OperationConfig {
  /**
   * Whether or not the response should be included in the value returned from
   * an operation.
   *
   * If set to `true`, a tuple of `[A, HttpClientResponse]` will be returned,
   * where `A` is the success type of the operation.
   *
   * If set to `false`, only the success type of the operation will be returned.
   */
  readonly includeResponse?: boolean | undefined
}

/**
 * A utility type which optionally includes the response in the return result
 * of an operation based upon the value of the `includeResponse` configuration
 * option.
 */
export type WithOptionalResponse<A, Config extends OperationConfig> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse] : A

export const make = (
  httpClient: HttpClient.HttpClient,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient) => Effect.Effect<HttpClient.HttpClient>) | undefined
  } = {}
): DotyposClient => {
  const unexpectedStatus = (response: HttpClientResponse.HttpClientResponse) =>
    Effect.flatMap(
      Effect.orElseSucceed(response.json, () => "Unexpected status code"),
      (description) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: typeof description === "string" ? description : JSON.stringify(description),
            }),
          }),
        ),
    )
  const withResponse = <Config extends OperationConfig>(config: Config | undefined) => (
    f: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<any, any>,
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any> => {
    const withOptionalResponse = (
      config?.includeResponse
        ? (response: HttpClientResponse.HttpClientResponse) => Effect.map(f(response), (a) => [a, response])
        : (response: HttpClientResponse.HttpClientResponse) => f(response)
    ) as any
    return options?.transformClient
      ? (request) =>
          Effect.flatMap(
            Effect.flatMap(options.transformClient!(httpClient), (client) => client.execute(request)),
            withOptionalResponse
          )
      : (request) => Effect.flatMap(httpClient.execute(request), withOptionalResponse)
  }
  const decodeSuccess =
    <Schema extends Schema.Top>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, Schema extends Schema.Top>(tag: Tag, schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response),
        (cause) => Effect.fail(DotyposClientError(tag, cause, response)),
      )
  return {
    httpClient,
    "getAccessToken": (options) => HttpClientRequest.post(`/signin/token`).pipe(
    HttpClientRequest.setHeaders({ "Authorization": options.params["Authorization"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetAccessToken201),
      "400": decodeError("GetAccessToken400", GetAccessToken400),
      "401": decodeError("GetAccessToken401", GetAccessToken401),
      orElse: unexpectedStatus
    }))
  ),
    "listReservations": (cloudId, options) => HttpClientRequest.get(`/clouds/${cloudId}/reservations`).pipe(
    HttpClientRequest.setUrlParams({ "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ListReservations200),
      "401": decodeError("ListReservations401", ListReservations401),
      "404": decodeError("ListReservations404", ListReservations404),
      orElse: unexpectedStatus
    }))
  ),
    "replaceReservations": (cloudId, options) => HttpClientRequest.put(`/clouds/${cloudId}/reservations`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceReservations200),
      "400": decodeError("ReplaceReservations400", ReplaceReservations400),
      "401": decodeError("ReplaceReservations401", ReplaceReservations401),
      orElse: unexpectedStatus
    }))
  ),
    "createReservation": (cloudId, options) => HttpClientRequest.post(`/clouds/${cloudId}/reservations`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateReservation200),
      "400": decodeError("CreateReservation400", CreateReservation400),
      "401": decodeError("CreateReservation401", CreateReservation401),
      orElse: unexpectedStatus
    }))
  ),
    "getReservation": (cloudId, reservationId, options) => HttpClientRequest.get(`/clouds/${cloudId}/reservations/${reservationId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetReservation200),
      "401": decodeError("GetReservation401", GetReservation401),
      "404": decodeError("GetReservation404", GetReservation404),
      orElse: unexpectedStatus
    }))
  ),
    "updateReservation": (cloudId, reservationId, options) => HttpClientRequest.put(`/clouds/${cloudId}/reservations/${reservationId}`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(UpdateReservation200),
      "401": decodeError("UpdateReservation401", UpdateReservation401),
      "404": decodeError("UpdateReservation404", UpdateReservation404),
      orElse: unexpectedStatus
    }))
  ),
    "cancelReservation": (cloudId, reservationId, options) => HttpClientRequest.delete(`/clouds/${cloudId}/reservations/${reservationId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "401": decodeError("CancelReservation401", CancelReservation401),
      "404": decodeError("CancelReservation404", CancelReservation404),
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "patchReservation": (cloudId, reservationId, options) => HttpClientRequest.patch(`/clouds/${cloudId}/reservations/${reservationId}`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PatchReservation200),
      "400": decodeError("PatchReservation400", PatchReservation400),
      "401": decodeError("PatchReservation401", PatchReservation401),
      "404": decodeError("PatchReservation404", PatchReservation404),
      orElse: unexpectedStatus
    }))
  ),
    "getCustomers": (cloudId, options) => HttpClientRequest.get(`/clouds/${cloudId}/customers`).pipe(
    HttpClientRequest.setUrlParams({ "filter": options?.params?.["filter"] as any, "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCustomers200),
      "401": decodeError("GetCustomers401", GetCustomers401),
      orElse: unexpectedStatus
    }))
  ),
    "replaceCustomers": (cloudId, options) => HttpClientRequest.put(`/clouds/${cloudId}/customers`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceCustomers200),
      "400": decodeError("ReplaceCustomers400", ReplaceCustomers400),
      "401": decodeError("ReplaceCustomers401", ReplaceCustomers401),
      orElse: unexpectedStatus
    }))
  ),
    "createCustomers": (cloudId, options) => HttpClientRequest.post(`/clouds/${cloudId}/customers`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateCustomers200),
      "400": decodeError("CreateCustomers400", CreateCustomers400),
      "401": decodeError("CreateCustomers401", CreateCustomers401),
      orElse: unexpectedStatus
    }))
  ),
    "getTables": (cloudId, options) => HttpClientRequest.get(`/clouds/${cloudId}/tables`).pipe(
    HttpClientRequest.setUrlParams({ "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetTables200),
      "401": decodeError("GetTables401", GetTables401),
      orElse: unexpectedStatus
    }))
  ),
    "getTable": (cloudId, tableId, options) => HttpClientRequest.get(`/clouds/${cloudId}/tables/${tableId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetTable200),
      "401": decodeError("GetTable401", GetTable401),
      "404": decodeError("GetTable404", GetTable404),
      orElse: unexpectedStatus
    }))
  ),
    "getProducts": (cloudId, options) => HttpClientRequest.get(`/clouds/${cloudId}/products`).pipe(
    HttpClientRequest.setUrlParams({ "filter": options?.params?.["filter"] as any, "sort": options?.params?.["sort"] as any, "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any, "include": options?.params?.["include"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetProducts200),
      "401": decodeError("GetProducts401", GetProducts401),
      orElse: unexpectedStatus
    }))
  ),
    "replaceProducts": (cloudId, options) => HttpClientRequest.put(`/clouds/${cloudId}/products`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceProducts200),
      "400": decodeError("ReplaceProducts400", ReplaceProducts400),
      "401": decodeError("ReplaceProducts401", ReplaceProducts401),
      orElse: unexpectedStatus
    }))
  ),
    "createProducts": (cloudId, options) => HttpClientRequest.post(`/clouds/${cloudId}/products`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateProducts200),
      "400": decodeError("CreateProducts400", CreateProducts400),
      "401": decodeError("CreateProducts401", CreateProducts401),
      orElse: unexpectedStatus
    }))
  ),
    "getProduct": (cloudId, productId, options) => HttpClientRequest.get(`/clouds/${cloudId}/products/${productId}`).pipe(
    HttpClientRequest.setUrlParams({ "include": options?.params?.["include"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetProduct200),
      "401": decodeError("GetProduct401", GetProduct401),
      "404": decodeError("GetProduct404", GetProduct404),
      orElse: unexpectedStatus
    }))
  ),
    "replaceProduct": (cloudId, productId, options) => HttpClientRequest.put(`/clouds/${cloudId}/products/${productId}`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceProduct200),
      "400": decodeError("ReplaceProduct400", ReplaceProduct400),
      "401": decodeError("ReplaceProduct401", ReplaceProduct401),
      "404": decodeError("ReplaceProduct404", ReplaceProduct404),
      orElse: unexpectedStatus
    }))
  ),
    "deleteProduct": (cloudId, productId, options) => HttpClientRequest.delete(`/clouds/${cloudId}/products/${productId}`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(DeleteProduct200),
      "401": decodeError("DeleteProduct401", DeleteProduct401),
      "404": decodeError("DeleteProduct404", DeleteProduct404),
      "409": decodeError("DeleteProduct409", DeleteProduct409),
      orElse: unexpectedStatus
    }))
  ),
    "patchProduct": (cloudId, productId, options) => HttpClientRequest.patch(`/clouds/${cloudId}/products/${productId}`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PatchProduct200),
      "400": decodeError("PatchProduct400", PatchProduct400),
      "401": decodeError("PatchProduct401", PatchProduct401),
      "404": decodeError("PatchProduct404", PatchProduct404),
      orElse: unexpectedStatus
    }))
  ),
    "getCategories": (cloudId, options) => HttpClientRequest.get(`/clouds/${cloudId}/categories`).pipe(
    HttpClientRequest.setUrlParams({ "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any, "filter": options?.params?.["filter"] as any, "sort": options?.params?.["sort"] as any }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCategories200),
      "401": decodeError("GetCategories401", GetCategories401),
      orElse: unexpectedStatus
    }))
  ),
    "replaceCategories": (cloudId, options) => HttpClientRequest.put(`/clouds/${cloudId}/categories`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceCategories200),
      "400": decodeError("ReplaceCategories400", ReplaceCategories400),
      "401": decodeError("ReplaceCategories401", ReplaceCategories401),
      orElse: unexpectedStatus
    }))
  ),
    "createCategories": (cloudId, options) => HttpClientRequest.post(`/clouds/${cloudId}/categories`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateCategories200),
      "400": decodeError("CreateCategories400", CreateCategories400),
      "401": decodeError("CreateCategories401", CreateCategories401),
      orElse: unexpectedStatus
    }))
  ),
    "getCategory": (cloudId, categoryId, options) => HttpClientRequest.get(`/clouds/${cloudId}/categories/${categoryId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCategory200),
      "401": decodeError("GetCategory401", GetCategory401),
      "404": decodeError("GetCategory404", GetCategory404),
      orElse: unexpectedStatus
    }))
  ),
    "replaceCategory": (cloudId, categoryId, options) => HttpClientRequest.put(`/clouds/${cloudId}/categories/${categoryId}`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceCategory200),
      "400": decodeError("ReplaceCategory400", ReplaceCategory400),
      "401": decodeError("ReplaceCategory401", ReplaceCategory401),
      "404": decodeError("ReplaceCategory404", ReplaceCategory404),
      orElse: unexpectedStatus
    }))
  ),
    "deleteCategory": (cloudId, categoryId, options) => HttpClientRequest.delete(`/clouds/${cloudId}/categories/${categoryId}`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options?.params?.["If-Match"] ?? undefined }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "401": decodeError("DeleteCategory401", DeleteCategory401),
      "404": decodeError("DeleteCategory404", DeleteCategory404),
      "409": decodeError("DeleteCategory409", DeleteCategory409),
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "patchCategory": (cloudId, categoryId, options) => HttpClientRequest.patch(`/clouds/${cloudId}/categories/${categoryId}`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PatchCategory200),
      "400": decodeError("PatchCategory400", PatchCategory400),
      "401": decodeError("PatchCategory401", PatchCategory401),
      "404": decodeError("PatchCategory404", PatchCategory404),
      orElse: unexpectedStatus
    }))
  ),
    "getCustomer": (cloudId, customerId, options) => HttpClientRequest.get(`/clouds/${cloudId}/customers/${customerId}`).pipe(
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCustomer200),
      "401": decodeError("GetCustomer401", GetCustomer401),
      "404": decodeError("GetCustomer404", GetCustomer404),
      orElse: unexpectedStatus
    }))
  ),
    "updateCustomer": (cloudId, customerId, options) => HttpClientRequest.put(`/clouds/${cloudId}/customers/${customerId}`).pipe(
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(UpdateCustomer200),
      "400": decodeError("UpdateCustomer400", UpdateCustomer400),
      "401": decodeError("UpdateCustomer401", UpdateCustomer401),
      "404": decodeError("UpdateCustomer404", UpdateCustomer404),
      orElse: unexpectedStatus
    }))
  ),
    "deleteCustomer": (cloudId, customerId, options) => HttpClientRequest.delete(`/clouds/${cloudId}/customers/${customerId}`).pipe(
    HttpClientRequest.setUrlParams({ "anonymize": options?.params?.["anonymize"] as any }),
    HttpClientRequest.setHeaders({ "If-Match": options?.params?.["If-Match"] ?? undefined }),
    withResponse(options?.config)(HttpClientResponse.matchStatus({
      "401": decodeError("DeleteCustomer401", DeleteCustomer401),
      "404": decodeError("DeleteCustomer404", DeleteCustomer404),
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
  ),
    "patchCustomer": (cloudId, customerId, options) => HttpClientRequest.patch(`/clouds/${cloudId}/customers/${customerId}`).pipe(
    HttpClientRequest.setHeaders({ "If-Match": options.params["If-Match"] ?? undefined }),
    HttpClientRequest.bodyJsonUnsafe(options.payload),
    withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PatchCustomer200),
      "400": decodeError("PatchCustomer400", PatchCustomer400),
      "401": decodeError("PatchCustomer401", PatchCustomer401),
      "404": decodeError("PatchCustomer404", PatchCustomer404),
      orElse: unexpectedStatus
    }))
  )
  }
}

export interface DotyposClient {
  readonly httpClient: HttpClient.HttpClient
  /**
* Get access token from refresh token
*/
readonly "getAccessToken": <Config extends OperationConfig>(options: { readonly params: typeof GetAccessTokenParams.Encoded; readonly payload: typeof GetAccessTokenRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof GetAccessToken201.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetAccessToken400", typeof GetAccessToken400.Type> | DotyposClientError<"GetAccessToken401", typeof GetAccessToken401.Type>>
  /**
* List reservations
*/
readonly "listReservations": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof ListReservationsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof ListReservations200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ListReservations401", typeof ListReservations401.Type> | DotyposClientError<"ListReservations404", typeof ListReservations404.Type>>
  /**
* Replace or create reservations
*/
readonly "replaceReservations": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof ReplaceReservationsParams.Encoded | undefined; readonly payload: typeof ReplaceReservationsRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof ReplaceReservations200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceReservations400", typeof ReplaceReservations400.Type> | DotyposClientError<"ReplaceReservations401", typeof ReplaceReservations401.Type>>
  /**
* Create a new reservation
*/
readonly "createReservation": <Config extends OperationConfig>(cloudId: string, options: { readonly payload: typeof CreateReservationRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof CreateReservation200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateReservation400", typeof CreateReservation400.Type> | DotyposClientError<"CreateReservation401", typeof CreateReservation401.Type>>
  /**
* Get reservation by ID
*/
readonly "getReservation": <Config extends OperationConfig>(cloudId: string, reservationId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetReservation200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetReservation401", typeof GetReservation401.Type> | DotyposClientError<"GetReservation404", typeof GetReservation404.Type>>
  /**
* Update reservation
*/
readonly "updateReservation": <Config extends OperationConfig>(cloudId: string, reservationId: string, options: { readonly payload: typeof UpdateReservationRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof UpdateReservation200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"UpdateReservation401", typeof UpdateReservation401.Type> | DotyposClientError<"UpdateReservation404", typeof UpdateReservation404.Type>>
  /**
* Cancel reservation
*/
readonly "cancelReservation": <Config extends OperationConfig>(cloudId: string, reservationId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CancelReservation401", typeof CancelReservation401.Type> | DotyposClientError<"CancelReservation404", typeof CancelReservation404.Type>>
  /**
* Partially update reservation
*/
readonly "patchReservation": <Config extends OperationConfig>(cloudId: string, reservationId: string, options: { readonly params: typeof PatchReservationParams.Encoded; readonly payload: typeof PatchReservationRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PatchReservation200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchReservation400", typeof PatchReservation400.Type> | DotyposClientError<"PatchReservation401", typeof PatchReservation401.Type> | DotyposClientError<"PatchReservation404", typeof PatchReservation404.Type>>
  /**
* Get customers
*/
readonly "getCustomers": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof GetCustomersParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCustomers200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCustomers401", typeof GetCustomers401.Type>>
  /**
* Replace or create customers
*/
readonly "replaceCustomers": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof ReplaceCustomersParams.Encoded | undefined; readonly payload: typeof ReplaceCustomersRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof ReplaceCustomers200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCustomers400", typeof ReplaceCustomers400.Type> | DotyposClientError<"ReplaceCustomers401", typeof ReplaceCustomers401.Type>>
  /**
* Create customers
*/
readonly "createCustomers": <Config extends OperationConfig>(cloudId: string, options: { readonly payload: typeof CreateCustomersRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof CreateCustomers200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateCustomers400", typeof CreateCustomers400.Type> | DotyposClientError<"CreateCustomers401", typeof CreateCustomers401.Type>>
  /**
* Get tables
*/
readonly "getTables": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof GetTablesParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetTables200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetTables401", typeof GetTables401.Type>>
  /**
* Get table by ID
*/
readonly "getTable": <Config extends OperationConfig>(cloudId: string, tableId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetTable200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetTable401", typeof GetTable401.Type> | DotyposClientError<"GetTable404", typeof GetTable404.Type>>
  /**
* Get products
*/
readonly "getProducts": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof GetProductsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetProducts200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetProducts401", typeof GetProducts401.Type>>
  /**
* Replace or create products
*/
readonly "replaceProducts": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof ReplaceProductsParams.Encoded | undefined; readonly payload: typeof ReplaceProductsRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof ReplaceProducts200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceProducts400", typeof ReplaceProducts400.Type> | DotyposClientError<"ReplaceProducts401", typeof ReplaceProducts401.Type>>
  /**
* Create products
*/
readonly "createProducts": <Config extends OperationConfig>(cloudId: string, options: { readonly payload: typeof CreateProductsRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof CreateProducts200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateProducts400", typeof CreateProducts400.Type> | DotyposClientError<"CreateProducts401", typeof CreateProducts401.Type>>
  /**
* Get product by ID
*/
readonly "getProduct": <Config extends OperationConfig>(cloudId: string, productId: string, options: { readonly params?: typeof GetProductParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetProduct200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetProduct401", typeof GetProduct401.Type> | DotyposClientError<"GetProduct404", typeof GetProduct404.Type>>
  /**
* Replace or create product
*/
readonly "replaceProduct": <Config extends OperationConfig>(cloudId: string, productId: string, options: { readonly params?: typeof ReplaceProductParams.Encoded | undefined; readonly payload: typeof ReplaceProductRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof ReplaceProduct200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceProduct400", typeof ReplaceProduct400.Type> | DotyposClientError<"ReplaceProduct401", typeof ReplaceProduct401.Type> | DotyposClientError<"ReplaceProduct404", typeof ReplaceProduct404.Type>>
  /**
* Delete product
*/
readonly "deleteProduct": <Config extends OperationConfig>(cloudId: string, productId: string, options: { readonly params?: typeof DeleteProductParams.Encoded | undefined; readonly payload: typeof DeleteProductRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof DeleteProduct200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteProduct401", typeof DeleteProduct401.Type> | DotyposClientError<"DeleteProduct404", typeof DeleteProduct404.Type> | DotyposClientError<"DeleteProduct409", typeof DeleteProduct409.Type>>
  /**
* Partially update product
*/
readonly "patchProduct": <Config extends OperationConfig>(cloudId: string, productId: string, options: { readonly params: typeof PatchProductParams.Encoded; readonly payload: typeof PatchProductRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PatchProduct200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchProduct400", typeof PatchProduct400.Type> | DotyposClientError<"PatchProduct401", typeof PatchProduct401.Type> | DotyposClientError<"PatchProduct404", typeof PatchProduct404.Type>>
  /**
* Get product categories
*/
readonly "getCategories": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof GetCategoriesParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCategories200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCategories401", typeof GetCategories401.Type>>
  /**
* Replace or create product categories
*/
readonly "replaceCategories": <Config extends OperationConfig>(cloudId: string, options: { readonly params?: typeof ReplaceCategoriesParams.Encoded | undefined; readonly payload: typeof ReplaceCategoriesRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof ReplaceCategories200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCategories400", typeof ReplaceCategories400.Type> | DotyposClientError<"ReplaceCategories401", typeof ReplaceCategories401.Type>>
  /**
* Create product categories
*/
readonly "createCategories": <Config extends OperationConfig>(cloudId: string, options: { readonly payload: typeof CreateCategoriesRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof CreateCategories200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateCategories400", typeof CreateCategories400.Type> | DotyposClientError<"CreateCategories401", typeof CreateCategories401.Type>>
  /**
* Get product category by ID
*/
readonly "getCategory": <Config extends OperationConfig>(cloudId: string, categoryId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCategory200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCategory401", typeof GetCategory401.Type> | DotyposClientError<"GetCategory404", typeof GetCategory404.Type>>
  /**
* Replace or create product category
*/
readonly "replaceCategory": <Config extends OperationConfig>(cloudId: string, categoryId: string, options: { readonly params?: typeof ReplaceCategoryParams.Encoded | undefined; readonly payload: typeof ReplaceCategoryRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof ReplaceCategory200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCategory400", typeof ReplaceCategory400.Type> | DotyposClientError<"ReplaceCategory401", typeof ReplaceCategory401.Type> | DotyposClientError<"ReplaceCategory404", typeof ReplaceCategory404.Type>>
  /**
* Delete product category
*/
readonly "deleteCategory": <Config extends OperationConfig>(cloudId: string, categoryId: string, options: { readonly params?: typeof DeleteCategoryParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteCategory401", typeof DeleteCategory401.Type> | DotyposClientError<"DeleteCategory404", typeof DeleteCategory404.Type> | DotyposClientError<"DeleteCategory409", typeof DeleteCategory409.Type>>
  /**
* Partially update product category
*/
readonly "patchCategory": <Config extends OperationConfig>(cloudId: string, categoryId: string, options: { readonly params: typeof PatchCategoryParams.Encoded; readonly payload: typeof PatchCategoryRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PatchCategory200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchCategory400", typeof PatchCategory400.Type> | DotyposClientError<"PatchCategory401", typeof PatchCategory401.Type> | DotyposClientError<"PatchCategory404", typeof PatchCategory404.Type>>
  /**
* Get customer by ID
*/
readonly "getCustomer": <Config extends OperationConfig>(cloudId: string, customerId: string, options: { readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<typeof GetCustomer200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCustomer401", typeof GetCustomer401.Type> | DotyposClientError<"GetCustomer404", typeof GetCustomer404.Type>>
  /**
* Update customer
*/
readonly "updateCustomer": <Config extends OperationConfig>(cloudId: string, customerId: string, options: { readonly payload: typeof UpdateCustomerRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof UpdateCustomer200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"UpdateCustomer400", typeof UpdateCustomer400.Type> | DotyposClientError<"UpdateCustomer401", typeof UpdateCustomer401.Type> | DotyposClientError<"UpdateCustomer404", typeof UpdateCustomer404.Type>>
  /**
* Delete customer
*/
readonly "deleteCustomer": <Config extends OperationConfig>(cloudId: string, customerId: string, options: { readonly params?: typeof DeleteCustomerParams.Encoded | undefined; readonly config?: Config | undefined } | undefined) => Effect.Effect<WithOptionalResponse<void, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteCustomer401", typeof DeleteCustomer401.Type> | DotyposClientError<"DeleteCustomer404", typeof DeleteCustomer404.Type>>
  /**
* Partially update customer
*/
readonly "patchCustomer": <Config extends OperationConfig>(cloudId: string, customerId: string, options: { readonly params: typeof PatchCustomerParams.Encoded; readonly payload: typeof PatchCustomerRequestJson.Encoded; readonly config?: Config | undefined }) => Effect.Effect<WithOptionalResponse<typeof PatchCustomer200.Type, Config>, HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchCustomer400", typeof PatchCustomer400.Type> | DotyposClientError<"PatchCustomer401", typeof PatchCustomer401.Type> | DotyposClientError<"PatchCustomer404", typeof PatchCustomer404.Type>>
}

export interface DotyposClientError<Tag extends string, E> {
  readonly _tag: Tag
  readonly request: HttpClientRequest.HttpClientRequest
  readonly response: HttpClientResponse.HttpClientResponse
  readonly cause: E
}

class DotyposClientErrorImpl extends Data.Error<{
  _tag: string
  cause: any
  request: HttpClientRequest.HttpClientRequest
  response: HttpClientResponse.HttpClientResponse
}> {}

export const DotyposClientError = <Tag extends string, E>(
  tag: Tag,
  cause: E,
  response: HttpClientResponse.HttpClientResponse,
): DotyposClientError<Tag, E> =>
  new DotyposClientErrorImpl({
    _tag: tag,
    cause,
    response,
    request: response.request,
  }) as any
