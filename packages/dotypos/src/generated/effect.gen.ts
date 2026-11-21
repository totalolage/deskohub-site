// @effect-diagnostics schemaNumber:off unnecessaryTypeofType:off
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
// non-recursive definitions
export type TokenRequest = { readonly "_cloudId"?: string }
export const TokenRequest = Schema.Struct({ "_cloudId": Schema.optionalKey(Schema.String.annotate({ "description": "Cloud ID for cloud-specific token (optional)" })) }).annotate({ "identifier": "TokenRequest" })
export type TokenResponse = { readonly "accessToken": string }
export const TokenResponse = Schema.Struct({ "accessToken": Schema.String.annotate({ "description": "JWT access token for API authentication" }) }).annotate({ "identifier": "TokenResponse" })
export type ErrorResponse = { readonly "error"?: string, readonly "error_description"?: string, readonly "code"?: number }
export const ErrorResponse = Schema.Struct({ "error": Schema.optionalKey(Schema.String), "error_description": Schema.optionalKey(Schema.String), "code": Schema.optionalKey(Schema.Int) }).annotate({ "identifier": "ErrorResponse" })
export type Reservation = { readonly "id": string, readonly "_branchId": string, readonly "_cloudId": string, readonly "_customerId"?: string, readonly "_employeeId"?: string, readonly "_tableId"?: string, readonly "created"?: string, readonly "flags"?: string, readonly "startDate": string, readonly "endDate": string, readonly "seats": string, readonly "status": "NEW" | "CONFIRMED" | "CANCELLED", readonly "note"?: string | null, readonly "versionDate"?: string }
export const Reservation = Schema.Struct({ "id": Schema.String.annotate({ "description": "Reservation ID (long as string)" }), "_branchId": Schema.String.annotate({ "description": "Branch ID (long as string)" }), "_cloudId": Schema.String.annotate({ "description": "Cloud ID (long as string)" }), "_customerId": Schema.optionalKey(Schema.String.annotate({ "description": "Customer ID (long)" })), "_employeeId": Schema.optionalKey(Schema.String.annotate({ "description": "Employee ID (long)" })), "_tableId": Schema.optionalKey(Schema.String.annotate({ "description": "Table ID (long)" })), "created": Schema.optionalKey(Schema.String.annotate({ "description": "Creation timestamp (ISO 8601 format)" })), "flags": Schema.optionalKey(Schema.String.annotate({ "description": "Reservation flags (string representation)" })), "startDate": Schema.String.annotate({ "description": "Start date/time returned by Dotypos as an ISO 8601 timestamp with a UTC or numeric offset" }).check(Schema.isPattern(new globalThis.RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$" })), "endDate": Schema.String.annotate({ "description": "End date/time returned by Dotypos as an ISO 8601 timestamp with a UTC or numeric offset" }).check(Schema.isPattern(new globalThis.RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$" })), "seats": Schema.String.annotate({ "description": "Number of seats (string representation)" }), "status": Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"]).annotate({ "description": "Reservation status" }), "note": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Additional notes" })), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last update timestamp (ISO 8601 format)" })) }).annotate({ "description": "A reservation Dotypos returns from a read; reads always carry its id.", "identifier": "Reservation" })
export type ReservationWriteRecord = { readonly "id"?: string, readonly "_branchId": string, readonly "_cloudId": string, readonly "_customerId"?: string, readonly "_employeeId"?: string, readonly "_tableId"?: string, readonly "created"?: string, readonly "flags"?: string, readonly "startDate": string, readonly "endDate": string, readonly "seats": string, readonly "status": "NEW" | "CONFIRMED" | "CANCELLED", readonly "note"?: string | null, readonly "versionDate"?: string }
export const ReservationWriteRecord = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Reservation ID (long as string)" })), "_branchId": Schema.String.annotate({ "description": "Branch ID (long as string)" }), "_cloudId": Schema.String.annotate({ "description": "Cloud ID (long as string)" }), "_customerId": Schema.optionalKey(Schema.String.annotate({ "description": "Customer ID (long)" })), "_employeeId": Schema.optionalKey(Schema.String.annotate({ "description": "Employee ID (long)" })), "_tableId": Schema.optionalKey(Schema.String.annotate({ "description": "Table ID (long)" })), "created": Schema.optionalKey(Schema.String.annotate({ "description": "Creation timestamp (ISO 8601 format)" })), "flags": Schema.optionalKey(Schema.String.annotate({ "description": "Reservation flags (string representation)" })), "startDate": Schema.String.annotate({ "description": "Start date/time returned by Dotypos as an ISO 8601 timestamp with a UTC or numeric offset" }).check(Schema.isPattern(new globalThis.RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$" })), "endDate": Schema.String.annotate({ "description": "End date/time returned by Dotypos as an ISO 8601 timestamp with a UTC or numeric offset" }).check(Schema.isPattern(new globalThis.RegExp("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$", "u")).annotate({ "expected": "a string matching the RegExp ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$" })), "seats": Schema.String.annotate({ "description": "Number of seats (string representation)" }), "status": Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"]).annotate({ "description": "Reservation status" }), "note": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Additional notes" })), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last update timestamp (ISO 8601 format)" })) }).annotate({ "description": "A reservation exchanged by a write; the id may be absent.", "identifier": "ReservationWriteRecord" })
export type CreateReservationRequest = { readonly "_branchId": string, readonly "_cloudId": string, readonly "_customerId": string, readonly "_employeeId"?: string, readonly "_tableId"?: string, readonly "flags"?: number, readonly "startDate": number, readonly "endDate": number, readonly "seats": number, readonly "status": "NEW" | "CONFIRMED" | "CANCELLED", readonly "note"?: string }
export const CreateReservationRequest = Schema.Struct({ "_branchId": Schema.String.annotate({ "description": "Branch ID (long as string)" }), "_cloudId": Schema.String.annotate({ "description": "Cloud ID (long as string)" }), "_customerId": Schema.String.annotate({ "description": "Customer ID (long as string)" }), "_employeeId": Schema.optionalKey(Schema.String.annotate({ "description": "Employee ID (long as string)" })), "_tableId": Schema.optionalKey(Schema.String.annotate({ "description": "Table ID (long as string)", "default": "0" })), "flags": Schema.optionalKey(Schema.Number.annotate({ "description": "Reservation flags (bitwise flags)", "default": 0 }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" }))), "startDate": Schema.Number.annotate({ "description": "Start date/time as Unix timestamp in milliseconds" }).check(Schema.isInt().annotate({ "expected": "an integer" })), "endDate": Schema.Number.annotate({ "description": "End date/time as Unix timestamp in milliseconds" }).check(Schema.isInt().annotate({ "expected": "an integer" })), "seats": Schema.Number.annotate({ "description": "Number of seats/guests" }).check(Schema.isInt().annotate({ "expected": "an integer" })), "status": Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"]), "note": Schema.optionalKey(Schema.String.annotate({ "description": "Additional notes (used for customer info)" })) }).annotate({ "identifier": "CreateReservationRequest" })
export type UpdateReservationRequest = { readonly "startDate"?: number, readonly "endDate"?: number, readonly "seats"?: number, readonly "status"?: "NEW" | "CONFIRMED" | "CANCELLED", readonly "note"?: string }
export const UpdateReservationRequest = Schema.Struct({ "startDate": Schema.optionalKey(Schema.Number.annotate({ "description": "Start date/time as Unix timestamp in milliseconds" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "endDate": Schema.optionalKey(Schema.Number.annotate({ "description": "End date/time as Unix timestamp in milliseconds" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "seats": Schema.optionalKey(Schema.Number.annotate({ "description": "Number of seats/guests" }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "status": Schema.optionalKey(Schema.Literals(["NEW", "CONFIRMED", "CANCELLED"])), "note": Schema.optionalKey(Schema.String.annotate({ "description": "Additional notes" })) }).annotate({ "identifier": "UpdateReservationRequest" })
export type Customer = { readonly "id": string, readonly "_cloudId": string, readonly "_discountGroupId"?: string | null, readonly "_sellerId"?: string | null, readonly "firstName"?: string | null, readonly "lastName"?: string | null, readonly "companyName"?: string | null, readonly "companyId"?: string | null, readonly "email"?: string | null, readonly "phone"?: string | null, readonly "addressLine1"?: string | null, readonly "addressLine2"?: string | null, readonly "city"?: string | null, readonly "zip"?: string | null, readonly "country"?: string | null, readonly "vatId"?: string | null, readonly "barcode"?: string | null, readonly "birthday"?: string | null, readonly "created"?: string | null, readonly "expireDate"?: string | null, readonly "externalId"?: string | null, readonly "headerPrint"?: string | null, readonly "hexColor"?: string | null, readonly "internalNote"?: string | null, readonly "modifiedBy"?: string | null, readonly "note"?: string | null, readonly "tags"?: ReadonlyArray<string> | null, readonly "points": string | null, readonly "flags": string, readonly "display": boolean, readonly "deleted": boolean, readonly "versionDate"?: string | null }
export const Customer = Schema.Struct({ "id": Schema.String.annotate({ "description": "Customer ID" }), "_cloudId": Schema.String.annotate({ "description": "Cloud ID" }), "_discountGroupId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Discount group ID" })), "_sellerId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Seller ID" })), "firstName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "First name (at least one of firstName, lastName, or companyName must be non-blank)" })), "lastName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Last name (at least one of firstName, lastName, or companyName must be non-blank)" })), "companyName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Company name (at least one of firstName, lastName, or companyName must be non-blank)" })), "companyId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Company ID" })), "email": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Email address" })), "phone": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Phone number" })), "addressLine1": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Address line 1" })), "addressLine2": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Address line 2" })), "city": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "City" })), "zip": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "ZIP code" })), "country": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Country code" })), "vatId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "VAT ID" })), "barcode": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer barcode" })), "birthday": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Birthday timestamp" })), "created": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Creation timestamp (ISO 8601)" })), "expireDate": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Expiration date timestamp" })), "externalId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "External ID" })), "headerPrint": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Header print text" })), "hexColor": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Hex color code" })), "internalNote": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Internal note" })), "modifiedBy": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Modified by user ID (string representation)" })), "note": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer note" })), "tags": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Customer tags" })), "points": Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer points (string representation of number)" }), "flags": Schema.String.annotate({ "description": "Customer flags (string representation of long)" }), "display": Schema.Boolean.annotate({ "description": "Is displayed" }), "deleted": Schema.Boolean.annotate({ "description": "Is deleted" }), "versionDate": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Last modification timestamp (ISO 8601, up to microsecond precision); null or absent when the customer is undated" })) }).annotate({ "description": "A customer Dotypos returns from a read; reads always carry its id.", "identifier": "Customer" })
export type CustomerWriteRecord = { readonly "id"?: string, readonly "_cloudId": string, readonly "_discountGroupId"?: string | null, readonly "_sellerId"?: string | null, readonly "firstName"?: string | null, readonly "lastName"?: string | null, readonly "companyName"?: string | null, readonly "companyId"?: string | null, readonly "email"?: string | null, readonly "phone"?: string | null, readonly "addressLine1"?: string | null, readonly "addressLine2"?: string | null, readonly "city"?: string | null, readonly "zip"?: string | null, readonly "country"?: string | null, readonly "vatId"?: string | null, readonly "barcode"?: string | null, readonly "birthday"?: string | null, readonly "created"?: string | null, readonly "expireDate"?: string | null, readonly "externalId"?: string | null, readonly "headerPrint"?: string | null, readonly "hexColor"?: string | null, readonly "internalNote"?: string | null, readonly "modifiedBy"?: string | null, readonly "note"?: string | null, readonly "tags"?: ReadonlyArray<string> | null, readonly "points": string | null, readonly "flags": string, readonly "display": boolean, readonly "deleted": boolean, readonly "versionDate"?: string | null }
export const CustomerWriteRecord = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Customer ID" })), "_cloudId": Schema.String.annotate({ "description": "Cloud ID" }), "_discountGroupId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Discount group ID" })), "_sellerId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Seller ID" })), "firstName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "First name (at least one of firstName, lastName, or companyName must be non-blank)" })), "lastName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Last name (at least one of firstName, lastName, or companyName must be non-blank)" })), "companyName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Company name (at least one of firstName, lastName, or companyName must be non-blank)" })), "companyId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Company ID" })), "email": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Email address" })), "phone": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Phone number" })), "addressLine1": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Address line 1" })), "addressLine2": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Address line 2" })), "city": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "City" })), "zip": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "ZIP code" })), "country": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Country code" })), "vatId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "VAT ID" })), "barcode": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer barcode" })), "birthday": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Birthday timestamp" })), "created": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Creation timestamp (ISO 8601)" })), "expireDate": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Expiration date timestamp" })), "externalId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "External ID" })), "headerPrint": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Header print text" })), "hexColor": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Hex color code" })), "internalNote": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Internal note" })), "modifiedBy": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Modified by user ID (string representation)" })), "note": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer note" })), "tags": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Customer tags" })), "points": Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer points (string representation of number)" }), "flags": Schema.String.annotate({ "description": "Customer flags (string representation of long)" }), "display": Schema.Boolean.annotate({ "description": "Is displayed" }), "deleted": Schema.Boolean.annotate({ "description": "Is deleted" }), "versionDate": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Last modification timestamp (ISO 8601, up to microsecond precision); null or absent when the customer is undated" })) }).annotate({ "description": "A customer exchanged by a write; the id may be absent.", "identifier": "CustomerWriteRecord" })
export type CreateCustomerRequest = { readonly "_cloudId": string, readonly "firstName": string, readonly "lastName": string, readonly "flags": string, readonly "email": string, readonly "phone": string, readonly "addressLine1": string, readonly "addressLine2"?: string | null, readonly "city"?: string | null, readonly "zip": string, readonly "country"?: string | null, readonly "companyName": string, readonly "vatId": string, readonly "note"?: string | null, readonly "display": boolean, readonly "deleted": boolean, readonly "points": string, readonly "internalNote": string, readonly "companyId": string, readonly "hexColor": string, readonly "headerPrint": string, readonly "tags": ReadonlyArray<string>, readonly "barcode": string, readonly "expireDate"?: number | string | null }
export const CreateCustomerRequest = Schema.Struct({ "_cloudId": Schema.String.annotate({ "description": "Cloud ID" }), "firstName": Schema.String.annotate({ "description": "First name" }), "lastName": Schema.String.annotate({ "description": "Last name", "default": "" }), "flags": Schema.String.annotate({ "description": "Customer flags (bitwise flags)", "default": "0" }), "email": Schema.String.annotate({ "description": "Email address" }), "phone": Schema.String.annotate({ "description": "Phone number" }), "addressLine1": Schema.String.annotate({ "description": "Address line 1", "default": "" }), "addressLine2": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Address line 2", "default": null })), "city": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "City", "default": null })), "zip": Schema.String.annotate({ "description": "ZIP code", "default": "" }), "country": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Country code", "default": null })), "companyName": Schema.String.annotate({ "description": "Company name", "default": "" }), "vatId": Schema.String.annotate({ "description": "VAT ID", "default": "" }), "note": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Customer note", "default": null })), "display": Schema.Boolean.annotate({ "description": "Is displayed", "default": true }), "deleted": Schema.Boolean.annotate({ "description": "Is deleted", "default": false }), "points": Schema.String.annotate({ "description": "Customer points", "default": "0" }), "internalNote": Schema.String.annotate({ "description": "Internal note", "default": "" }), "companyId": Schema.String.annotate({ "description": "Company ID", "default": "" }), "hexColor": Schema.String.annotate({ "description": "Hex color for customer", "default": "#000000" }), "headerPrint": Schema.String.annotate({ "description": "Header print text", "default": "" }), "tags": Schema.Array(Schema.String).annotate({ "description": "Customer tags", "default": [] }), "barcode": Schema.String.annotate({ "description": "Customer barcode", "default": "" }), "expireDate": Schema.optionalKey(Schema.Union([Schema.Union([Schema.Number.annotate({ "description": "Unix timestamp (seconds or milliseconds since epoch)", "examples": [1735689600] }).check(Schema.isInt().annotate({ "expected": "an integer" })), Schema.String.annotate({ "description": "ISO 8601 datetime string", "examples": ["2025-01-01T00:00:00Z"], "format": "date-time" })], { mode: "oneOf" }).annotate({ "description": "Expiration date as either a Unix timestamp (seconds or milliseconds) or an ISO 8601 datetime string." }), Schema.Null])) }).annotate({ "identifier": "CreateCustomerRequest" })
export type Table = { readonly "id": string, readonly "_branchId"?: string, readonly "_cloudId": string, readonly "_sellerId"?: string | null, readonly "_tableGroupId"?: string, readonly "name": string, readonly "seats"?: string, readonly "display"?: boolean, readonly "enabled"?: boolean, readonly "locationName"?: string, readonly "positionX"?: string, readonly "positionY"?: string, readonly "rotation"?: string, readonly "type"?: "SQUARE" | "SQUARE6" | "CIRCLE2" | "CIRCLE4" | "DELIVERY" | "CHAIR_SINGLE" | "ROUND" | "DOOR" | "GENERIC" | "CAR1" | "CAR2", readonly "tags"?: ReadonlyArray<string>, readonly "versionDate"?: string }
export const Table = Schema.Struct({ "id": Schema.String.annotate({ "description": "Table ID (long as string)" }), "_branchId": Schema.optionalKey(Schema.String.annotate({ "description": "Branch ID (long as string)" })), "_cloudId": Schema.String.annotate({ "description": "Cloud ID (long as string)" }), "_sellerId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Seller ID (long as string)" })), "_tableGroupId": Schema.optionalKey(Schema.String.annotate({ "description": "Table group ID (long as string)" })), "name": Schema.String.annotate({ "description": "Table name/number" }).check(Schema.isMaxCodePoints(180).annotate({ "expected": "a string with at most 180 code points" })), "seats": Schema.optionalKey(Schema.String.annotate({ "description": "Number of seats (string representation)" })), "display": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is displayed" })), "enabled": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is enabled" })), "locationName": Schema.optionalKey(Schema.String.annotate({ "description": "Location name" })), "positionX": Schema.optionalKey(Schema.String.annotate({ "description": "X position (string representation)" })), "positionY": Schema.optionalKey(Schema.String.annotate({ "description": "Y position (string representation)" })), "rotation": Schema.optionalKey(Schema.String.annotate({ "description": "Rotation angle (string representation)" })), "type": Schema.optionalKey(Schema.Literals(["SQUARE", "SQUARE6", "CIRCLE2", "CIRCLE4", "DELIVERY", "CHAIR_SINGLE", "ROUND", "DOOR", "GENERIC", "CAR1", "CAR2"]).annotate({ "description": "Table type" })), "tags": Schema.optionalKey(Schema.Array(Schema.String).annotate({ "description": "Table tags" })), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last modification timestamp (ISO 8601)" })) }).annotate({ "identifier": "Table" })
export type TranslatedStrings = { readonly [x: string]: string }
export const TranslatedStrings = Schema.Record(Schema.String, Schema.String).annotate({ "description": "Map of locale codes to translated strings (e.g., {\"en\": \"English text\", \"cs\": \"Czech text\"})", "examples": [{ "en": "English text", "cs": "Český text", "de": "Deutscher Text" }], "identifier": "TranslatedStrings" })
export type DeleteProductRequest = { readonly "productIsIngredient"?: "ERROR" | "PRESERVE" | "DELETE", readonly "productHasIngredients"?: "ERROR" | "PRESERVE" | "DELETE" }
export const DeleteProductRequest = Schema.Struct({ "productIsIngredient": Schema.optionalKey(Schema.Literals(["ERROR", "PRESERVE", "DELETE"]).annotate({ "description": "Strategy when the product is an ingredient" })), "productHasIngredients": Schema.optionalKey(Schema.Literals(["ERROR", "PRESERVE", "DELETE"]).annotate({ "description": "Strategy when the product has ingredients" })) }).annotate({ "identifier": "DeleteProductRequest" })
export type PatchProductRequest = { readonly [x: string]: Schema.Json }
export const PatchProductRequest = Schema.Record(Schema.String, Schema.Json.annotate({ "expected": "JSON value" })).annotate({ "description": "Partial product object for PATCH requests", "identifier": "PatchProductRequest" })
export type PatchCategoryRequest = { readonly [x: string]: Schema.Json }
export const PatchCategoryRequest = Schema.Record(Schema.String, Schema.Json.annotate({ "expected": "JSON value" })).annotate({ "description": "Partial category object for PATCH requests", "identifier": "PatchCategoryRequest" })
export type UpdateCustomerRequest = { readonly "_discountGroupId"?: string | null, readonly "firstName"?: string, readonly "lastName"?: string, readonly "email"?: string, readonly "phone"?: string, readonly "addressLine1"?: string, readonly "addressLine2"?: string, readonly "city"?: string, readonly "zip"?: string, readonly "country"?: string, readonly "companyName"?: string, readonly "vatId"?: string, readonly "note"?: string, readonly "display"?: boolean, readonly "deleted"?: boolean, readonly "points"?: string, readonly "internalNote"?: string, readonly "hexColor"?: string, readonly "headerPrint"?: string, readonly "tags"?: ReadonlyArray<string>, readonly "barcode"?: string, readonly "companyId"?: string, readonly "flags"?: number, readonly "expireDate"?: number | string | null }
export const UpdateCustomerRequest = Schema.Struct({ "_discountGroupId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Discount group ID" })), "firstName": Schema.optionalKey(Schema.String.annotate({ "description": "First name" })), "lastName": Schema.optionalKey(Schema.String.annotate({ "description": "Last name" })), "email": Schema.optionalKey(Schema.String.annotate({ "description": "Email address" })), "phone": Schema.optionalKey(Schema.String.annotate({ "description": "Phone number" })), "addressLine1": Schema.optionalKey(Schema.String.annotate({ "description": "Address line 1" })), "addressLine2": Schema.optionalKey(Schema.String.annotate({ "description": "Address line 2" })), "city": Schema.optionalKey(Schema.String.annotate({ "description": "City" })), "zip": Schema.optionalKey(Schema.String.annotate({ "description": "ZIP code" })), "country": Schema.optionalKey(Schema.String.annotate({ "description": "Country code" })), "companyName": Schema.optionalKey(Schema.String.annotate({ "description": "Company name" })), "vatId": Schema.optionalKey(Schema.String.annotate({ "description": "VAT ID" })), "note": Schema.optionalKey(Schema.String.annotate({ "description": "Customer note" })), "display": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is displayed" })), "deleted": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is deleted" })), "points": Schema.optionalKey(Schema.String.annotate({ "description": "Customer points" })), "internalNote": Schema.optionalKey(Schema.String.annotate({ "description": "Internal note" })), "hexColor": Schema.optionalKey(Schema.String.annotate({ "description": "Hex color for customer" })), "headerPrint": Schema.optionalKey(Schema.String.annotate({ "description": "Header print text" })), "tags": Schema.optionalKey(Schema.Array(Schema.String).annotate({ "description": "Customer tags" })), "barcode": Schema.optionalKey(Schema.String.annotate({ "description": "Customer barcode" })), "companyId": Schema.optionalKey(Schema.String.annotate({ "description": "Company ID" })), "flags": Schema.optionalKey(Schema.Number.annotate({ "description": "Customer flags (bitwise flags)" }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isGreaterThanOrEqualTo(0).annotate({ "expected": "a value greater than or equal to 0" }))), "expireDate": Schema.optionalKey(Schema.Union([Schema.Union([Schema.Number.annotate({ "description": "Unix timestamp (seconds or milliseconds since epoch)", "examples": [1735689600] }).check(Schema.isInt().annotate({ "expected": "an integer" })), Schema.String.annotate({ "description": "ISO 8601 datetime string", "examples": ["2025-01-01T00:00:00Z"], "format": "date-time" })], { mode: "oneOf" }).annotate({ "description": "Expiration date as either a Unix timestamp (seconds or milliseconds) or an ISO 8601 datetime string." }), Schema.Null])) }).annotate({ "identifier": "UpdateCustomerRequest" })
export type DiscountGroup = { readonly "id"?: string, readonly "_cloudId"?: string, readonly "discountPercent": string | null, readonly "deleted"?: boolean, readonly "display"?: boolean, readonly "externalId"?: string | null, readonly "name"?: string | null, readonly "versionDate"?: string }
export const DiscountGroup = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Discount group ID" })), "_cloudId": Schema.optionalKey(Schema.String.annotate({ "description": "Cloud ID" })), "discountPercent": Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Percentage discount represented as a decimal string" }), "deleted": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Whether the discount group is deleted" })), "display": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Whether the discount group is displayed" })), "externalId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "External ID" })), "name": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Discount group name" })), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last modification timestamp" })) }).annotate({ "identifier": "DiscountGroup" })
export type PaginatedReservations = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Reservation> }
export const PaginatedReservations = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Reservation).annotate({ "description": "Array of reservations" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses", "identifier": "PaginatedReservations" })
export type PaginatedCustomers = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Customer> }
export const PaginatedCustomers = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Customer).annotate({ "description": "Array of customers" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses", "identifier": "PaginatedCustomers" })
export type PaginatedTables = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Table> }
export const PaginatedTables = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Table).annotate({ "description": "Array of tables" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses", "identifier": "PaginatedTables" })
export type Product = { readonly "id"?: string, readonly "_categoryId": string, readonly "_cloudId"?: string, readonly "name": string, readonly "alternativeName"?: string | null, readonly "description"?: string | null, readonly "ean"?: ReadonlyArray<string> | string | null, readonly "externalId"?: string | null, readonly "flags"?: string, readonly "hexColor"?: string | null, readonly "imageUrl"?: string | null, readonly "minMargin"?: string | null, readonly "modifiedBy"?: string | null, readonly "packaging"?: string | null, readonly "packageSize"?: string | null, readonly "points"?: string | null, readonly "priceWithVat"?: string | null, readonly "priceWithoutVat": string, readonly "printTicket"?: boolean | null, readonly "stockDeduct"?: boolean | null, readonly "subtitle"?: string | null, readonly "tags"?: ReadonlyArray<string> | string | null, readonly "translatedDescription"?: TranslatedStrings | null, readonly "translatedName"?: TranslatedStrings | null, readonly "unit"?: string, readonly "vat": string, readonly "versionDate"?: string, readonly "deleted"?: boolean | null, readonly "display"?: boolean | null }
export const Product = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Product ID (long as string)" })), "_categoryId": Schema.String.annotate({ "description": "Category ID (long as string)" }), "_cloudId": Schema.optionalKey(Schema.String.annotate({ "description": "Cloud ID (long as string)" })), "name": Schema.String.annotate({ "description": "Product name" }).check(Schema.isMaxCodePoints(255).annotate({ "expected": "a string with at most 255 code points" })), "alternativeName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Alternative product name" })), "description": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Product description" })), "ean": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Union([Schema.String, Schema.Null])], { mode: "oneOf" }).annotate({ "description": "EAN codes (can be array or string)" })), "externalId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "External ID" })), "flags": Schema.optionalKey(Schema.String.annotate({ "description": "Product flags (string representation)" })), "hexColor": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Hex color code" })), "imageUrl": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Product image URL" })), "minMargin": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Minimum margin (string representation)" })), "modifiedBy": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Modified by user ID" })), "packaging": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Packaging information" })), "packageSize": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Package size (string representation)" })), "points": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Points value (string representation)" })), "priceWithVat": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Price with VAT (string representation)" })), "priceWithoutVat": Schema.String.annotate({ "description": "Price without VAT (string representation)" }), "printTicket": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null]).annotate({ "description": "Print ticket flag" })), "stockDeduct": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null]).annotate({ "description": "Stock deduction flag" })), "subtitle": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Product subtitle" })), "tags": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Union([Schema.String, Schema.Null])], { mode: "oneOf" }).annotate({ "description": "Product tags (can be array or string)" })), "translatedDescription": Schema.optionalKey(Schema.Union([TranslatedStrings, Schema.Null]).annotate({ "description": "Translated descriptions by locale" })), "translatedName": Schema.optionalKey(Schema.Union([TranslatedStrings, Schema.Null]).annotate({ "description": "Translated names by locale" })), "unit": Schema.optionalKey(Schema.String.annotate({ "description": "Unit of measurement (actual values vary from documented enum)" })), "vat": Schema.String.annotate({ "description": "VAT rate (string representation)" }), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last modification timestamp (ISO 8601)" })), "deleted": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null]).annotate({ "description": "Is deleted" })), "display": Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Null]).annotate({ "description": "Is displayed" })) }).annotate({ "identifier": "Product" })
export type Category = { readonly "id"?: string, readonly "_cloudId"?: string, readonly "name"?: string, readonly "hexColor"?: string | null, readonly "deleted"?: boolean, readonly "display"?: boolean, readonly "externalId"?: string | null, readonly "flags"?: string, readonly "fiscalName"?: string | null, readonly "ordering"?: string | null, readonly "translatedName"?: TranslatedStrings | null, readonly "versionDate"?: string, readonly "tags"?: ReadonlyArray<string> | null }
export const Category = Schema.Struct({ "id": Schema.optionalKey(Schema.String.annotate({ "description": "Category ID (long as string)" })), "_cloudId": Schema.optionalKey(Schema.String.annotate({ "description": "Cloud ID (long as string)" })), "name": Schema.optionalKey(Schema.String.annotate({ "description": "Category name" })), "hexColor": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Hex color for the category" })), "deleted": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is deleted" })), "display": Schema.optionalKey(Schema.Boolean.annotate({ "description": "Is displayed" })), "externalId": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "External ID" })), "flags": Schema.optionalKey(Schema.String.annotate({ "description": "Category flags (string representation of long)" })), "fiscalName": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Fiscal name for the category" })), "ordering": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Sort order (string representation)" })), "translatedName": Schema.optionalKey(Schema.Union([TranslatedStrings, Schema.Null]).annotate({ "description": "Translated names by locale" })), "versionDate": Schema.optionalKey(Schema.String.annotate({ "description": "Last modification timestamp (ISO 8601)" })), "tags": Schema.optionalKey(Schema.Union([Schema.Array(Schema.String), Schema.Null], { mode: "oneOf" }).annotate({ "description": "Category tags" })) }).annotate({ "identifier": "Category" })
export type PaginatedDiscountGroups = { readonly "data"?: ReadonlyArray<DiscountGroup>, readonly "nextPage"?: string | null }
export const PaginatedDiscountGroups = Schema.Struct({ "data": Schema.optionalKey(Schema.Array(DiscountGroup)), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null])) }).annotate({ "identifier": "PaginatedDiscountGroups" })
export type PaginatedProducts = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Product> }
export const PaginatedProducts = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Product).annotate({ "description": "Array of products" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses", "identifier": "PaginatedProducts" })
export type PaginatedCategories = { readonly "currentPage"?: string, readonly "perPage"?: string, readonly "totalItemsOnPage"?: string, readonly "totalItemsCount"?: string, readonly "firstPage"?: string, readonly "lastPage"?: string, readonly "nextPage"?: string | null, readonly "prevPage"?: string | null, readonly "data"?: ReadonlyArray<Category> }
export const PaginatedCategories = Schema.Struct({ "currentPage": Schema.optionalKey(Schema.String.annotate({ "description": "Current page number" })), "perPage": Schema.optionalKey(Schema.String.annotate({ "description": "Items per page" })), "totalItemsOnPage": Schema.optionalKey(Schema.String.annotate({ "description": "Number of items on current page" })), "totalItemsCount": Schema.optionalKey(Schema.String.annotate({ "description": "Total number of items" })), "firstPage": Schema.optionalKey(Schema.String.annotate({ "description": "First page number" })), "lastPage": Schema.optionalKey(Schema.String.annotate({ "description": "Last page number" })), "nextPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Next page number" })), "prevPage": Schema.optionalKey(Schema.Union([Schema.String, Schema.Null]).annotate({ "description": "Previous page number" })), "data": Schema.optionalKey(Schema.Array(Category).annotate({ "description": "Array of categories" })) }).annotate({ "description": "Base pagination properties shared by all paginated responses", "identifier": "PaginatedCategories" })
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
export type ListReservationsParams = { readonly "filter"?: string, readonly "sort"?: string, readonly "page"?: number, readonly "limit"?: number }
export const ListReservationsParams = Schema.Struct({ "filter": Schema.optionalKey(Schema.String), "sort": Schema.optionalKey(Schema.String), "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(100).annotate({ "expected": "a value less than or equal to 100" }))) })
export type ListReservations200 = PaginatedReservations
export const ListReservations200 = PaginatedReservations
export type ListReservations401 = ErrorResponse
export const ListReservations401 = ErrorResponse
export type ListReservations404 = ErrorResponse | null
export const ListReservations404 = Schema.Union([ErrorResponse, Schema.Null], { mode: "oneOf" })
export type ReplaceReservationsParams = { readonly "If-Match"?: string }
export const ReplaceReservationsParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceReservationsRequestJson = ReadonlyArray<ReservationWriteRecord>
export const ReplaceReservationsRequestJson = Schema.Array(ReservationWriteRecord).check(Schema.isMaxLength(100).annotate({ "expected": "a value with a length of at most 100" }))
export type ReplaceReservations200 = ReadonlyArray<ReservationWriteRecord>
export const ReplaceReservations200 = Schema.Array(ReservationWriteRecord)
export type ReplaceReservations400 = ErrorResponse
export const ReplaceReservations400 = ErrorResponse
export type ReplaceReservations401 = ErrorResponse
export const ReplaceReservations401 = ErrorResponse
export type CreateReservationRequestJson = ReadonlyArray<CreateReservationRequest>
export const CreateReservationRequestJson = Schema.Array(CreateReservationRequest).annotate({ "description": "Array of reservations to create (max 100)" }).check(Schema.isMaxLength(100).annotate({ "expected": "a value with a length of at most 100" }))
export type CreateReservation200 = ReadonlyArray<Schema.Json>
export const CreateReservation200 = Schema.Array(Schema.Json.annotate({ "expected": "JSON value" })).annotate({ "description": "Creation receipts are read before reservation records are validated so malformed fields cannot hide IDs in the same reply." })
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
export type UpdateReservation200 = ReservationWriteRecord
export const UpdateReservation200 = ReservationWriteRecord
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
export type PatchReservation200 = ReservationWriteRecord
export const PatchReservation200 = ReservationWriteRecord
export type PatchReservation400 = ErrorResponse
export const PatchReservation400 = ErrorResponse
export type PatchReservation401 = ErrorResponse
export const PatchReservation401 = ErrorResponse
export type PatchReservation404 = ErrorResponse
export const PatchReservation404 = ErrorResponse
export type GetCustomersParams = { readonly "filter"?: string, readonly "sort"?: string, readonly "page"?: number, readonly "limit"?: number }
export const GetCustomersParams = Schema.Struct({ "filter": Schema.optionalKey(Schema.String), "sort": Schema.optionalKey(Schema.String), "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(100).annotate({ "expected": "a value less than or equal to 100" }))) })
export type GetCustomers200 = PaginatedCustomers
export const GetCustomers200 = PaginatedCustomers
export type GetCustomers401 = ErrorResponse
export const GetCustomers401 = ErrorResponse
export type ReplaceCustomersParams = { readonly "If-Match"?: string }
export const ReplaceCustomersParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceCustomersRequestJson = ReadonlyArray<CustomerWriteRecord>
export const ReplaceCustomersRequestJson = Schema.Array(CustomerWriteRecord)
export type ReplaceCustomers200 = ReadonlyArray<CustomerWriteRecord>
export const ReplaceCustomers200 = Schema.Array(CustomerWriteRecord)
export type ReplaceCustomers400 = ErrorResponse
export const ReplaceCustomers400 = ErrorResponse
export type ReplaceCustomers401 = ErrorResponse
export const ReplaceCustomers401 = ErrorResponse
export type CreateCustomersRequestJson = ReadonlyArray<CreateCustomerRequest>
export const CreateCustomersRequestJson = Schema.Array(CreateCustomerRequest)
export type CreateCustomers200 = ReadonlyArray<CustomerWriteRecord>
export const CreateCustomers200 = Schema.Array(CustomerWriteRecord)
export type CreateCustomers400 = ErrorResponse
export const CreateCustomers400 = ErrorResponse
export type CreateCustomers401 = ErrorResponse
export const CreateCustomers401 = ErrorResponse
export type GetTablesParams = { readonly "page"?: number, readonly "limit"?: number }
export const GetTablesParams = Schema.Struct({ "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(100).annotate({ "expected": "a value less than or equal to 100" }))) })
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
export const GetProductsParams = Schema.Struct({ "filter": Schema.optionalKey(Schema.String), "sort": Schema.optionalKey(Schema.String), "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(100).annotate({ "expected": "a value less than or equal to 100" }))), "include": Schema.optionalKey(Schema.String) })
export type GetProducts200 = PaginatedProducts
export const GetProducts200 = PaginatedProducts
export type GetProducts401 = ErrorResponse
export const GetProducts401 = ErrorResponse
export type ReplaceProductsParams = { readonly "If-Match"?: string }
export const ReplaceProductsParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceProductsRequestJson = ReadonlyArray<Product>
export const ReplaceProductsRequestJson = Schema.Array(Product).check(Schema.isMaxLength(100).annotate({ "expected": "a value with a length of at most 100" }))
export type ReplaceProducts200 = ReadonlyArray<Product>
export const ReplaceProducts200 = Schema.Array(Product)
export type ReplaceProducts400 = ErrorResponse
export const ReplaceProducts400 = ErrorResponse
export type ReplaceProducts401 = ErrorResponse
export const ReplaceProducts401 = ErrorResponse
export type CreateProductsRequestJson = ReadonlyArray<Product>
export const CreateProductsRequestJson = Schema.Array(Product).check(Schema.isMaxLength(100).annotate({ "expected": "a value with a length of at most 100" }))
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
export type DeleteProduct200 = { readonly [x: string]: Schema.Json }
export const DeleteProduct200 = Schema.Record(Schema.String, Schema.Json.annotate({ "expected": "JSON value" }))
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
export const GetCategoriesParams = Schema.Struct({ "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(100).annotate({ "expected": "a value less than or equal to 100" }))), "filter": Schema.optionalKey(Schema.String), "sort": Schema.optionalKey(Schema.String) })
export type GetCategories200 = PaginatedCategories
export const GetCategories200 = PaginatedCategories
export type GetCategories401 = ErrorResponse
export const GetCategories401 = ErrorResponse
export type ReplaceCategoriesParams = { readonly "If-Match"?: string }
export const ReplaceCategoriesParams = Schema.Struct({ "If-Match": Schema.optionalKey(Schema.String) })
export type ReplaceCategoriesRequestJson = ReadonlyArray<Category>
export const ReplaceCategoriesRequestJson = Schema.Array(Category).check(Schema.isMaxLength(100).annotate({ "expected": "a value with a length of at most 100" }))
export type ReplaceCategories200 = ReadonlyArray<Category>
export const ReplaceCategories200 = Schema.Array(Category)
export type ReplaceCategories400 = ErrorResponse
export const ReplaceCategories400 = ErrorResponse
export type ReplaceCategories401 = ErrorResponse
export const ReplaceCategories401 = ErrorResponse
export type CreateCategoriesRequestJson = ReadonlyArray<Category>
export const CreateCategoriesRequestJson = Schema.Array(Category).check(Schema.isMaxLength(100).annotate({ "expected": "a value with a length of at most 100" }))
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
export type UpdateCustomer200 = CustomerWriteRecord
export const UpdateCustomer200 = CustomerWriteRecord
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
export type PatchCustomer200 = CustomerWriteRecord
export const PatchCustomer200 = CustomerWriteRecord
export type PatchCustomer400 = ErrorResponse
export const PatchCustomer400 = ErrorResponse
export type PatchCustomer401 = ErrorResponse
export const PatchCustomer401 = ErrorResponse
export type PatchCustomer404 = ErrorResponse
export const PatchCustomer404 = ErrorResponse
export type GetDiscountGroupsParams = { readonly "filter"?: string, readonly "page"?: number, readonly "limit"?: number }
export const GetDiscountGroupsParams = Schema.Struct({ "filter": Schema.optionalKey(Schema.String), "page": Schema.optionalKey(Schema.Number.annotate({ "default": 1 }).check(Schema.isInt().annotate({ "expected": "an integer" }))), "limit": Schema.optionalKey(Schema.Number.annotate({ "default": 100 }).check(Schema.isInt().annotate({ "expected": "an integer" })).check(Schema.isLessThanOrEqualTo(100).annotate({ "expected": "a value less than or equal to 100" }))) })
export type GetDiscountGroups200 = PaginatedDiscountGroups
export const GetDiscountGroups200 = PaginatedDiscountGroups
export type GetDiscountGroups401 = ErrorResponse
export const GetDiscountGroups401 = ErrorResponse
export type GetDiscountGroups404 = ErrorResponse
export const GetDiscountGroups404 = ErrorResponse
export type GetDiscountGroup200 = DiscountGroup
export const GetDiscountGroup200 = DiscountGroup
export type GetDiscountGroup401 = ErrorResponse
export const GetDiscountGroup401 = ErrorResponse
export type GetDiscountGroup404 = ErrorResponse
export const GetDiscountGroup404 = ErrorResponse

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
export type WithOptionalResponse<A, Config extends OperationConfig | undefined> = Config extends {
  readonly includeResponse: true
} ? [A, HttpClientResponse.HttpClientResponse]
  : Config extends { readonly includeResponse?: false | undefined } | undefined ? A
  : A | [A, HttpClientResponse.HttpClientResponse]

export const make = <E, R>(
  httpClient: HttpClient.HttpClient.With<E, R>,
  options: {
    readonly transformClient?: ((client: HttpClient.HttpClient.With<E, R>) => Effect.Effect<HttpClient.HttpClient.With<E, R>>) | undefined
  } = {}
): DotyposClient<E, R> => {
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
  ): (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<any, any, R> => {
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
  const __encodePathParam = encodeURIComponent
  const __makePathRequest = (
    method: (url: string) => HttpClientRequest.HttpClientRequest,
    parameters: ReadonlyArray<string>,
    getPath: () => string,
  ) => Effect.suspend(() => {
    const fail = (description: string, cause?: unknown) => Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.InvalidUrlError({
          request: method(""),
          cause,
          description,
        }),
      }),
    )
    if (parameters.some((value) => value === "" || /^(?:\.|%2e){1,2}$/i.test(value))) {
      return fail("Path parameters must be non-empty and cannot be dot segments")
    }
    let path: string
    try {
      path = getPath()
    } catch (cause) {
      return fail("Failed to encode path parameter", cause)
    }
    if (path.split("/").some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))) {
      return fail("Request paths cannot contain dot segments")
    }
    return Effect.succeed(method(path))
  })
  const decodeSuccess =
    <Schema extends Schema.Constraint>(schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      HttpClientResponse.schemaBodyJson(schema)(response)
  const decodeError =
    <const Tag extends string, Schema extends Schema.Constraint>(tag: Tag, schema: Schema) =>
    (response: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(schema)(response).pipe(
          Effect.mapError(
            () =>
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.StatusCodeError({
                  request: response.request,
                  response,
                  description: "Error response did not match the documented schema",
                }),
              }),
          ),
        ),
        (cause) => Effect.fail(DotyposClientError(tag, cause, response)),
      )
  return {
    httpClient,
    "getAccessToken": (options: Parameters<DotyposClient["getAccessToken"]>[0]) => HttpClientRequest.post("/signin/token").pipe(
      HttpClientRequest.setHeaders({ "Authorization": options.params["Authorization"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetAccessToken201),
      "400": decodeError("GetAccessToken400", GetAccessToken400),
      "401": decodeError("GetAccessToken401", GetAccessToken401),
      orElse: unexpectedStatus
    }))
    ),
    "listReservations": (cloudId, options: Parameters<DotyposClient["listReservations"]>[1]) => __makePathRequest(HttpClientRequest.get, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/reservations").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "filter": options?.params?.["filter"] as any, "sort": options?.params?.["sort"] as any, "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ListReservations200),
      "401": decodeError("ListReservations401", ListReservations401),
      "404": decodeError("ListReservations404", ListReservations404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "replaceReservations": (cloudId, options: Parameters<DotyposClient["replaceReservations"]>[1]) => __makePathRequest(HttpClientRequest.put, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/reservations").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceReservations200),
      "400": decodeError("ReplaceReservations400", ReplaceReservations400),
      "401": decodeError("ReplaceReservations401", ReplaceReservations401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "createReservation": (cloudId, options: Parameters<DotyposClient["createReservation"]>[1]) => __makePathRequest(HttpClientRequest.post, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/reservations").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateReservation200),
      "400": decodeError("CreateReservation400", CreateReservation400),
      "401": decodeError("CreateReservation401", CreateReservation401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getReservation": (cloudId, reservationId, options: Parameters<DotyposClient["getReservation"]>[2]) => __makePathRequest(HttpClientRequest.get, [cloudId, reservationId], () => "/clouds/" + __encodePathParam(cloudId) + "/reservations/" + __encodePathParam(reservationId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetReservation200),
      "401": decodeError("GetReservation401", GetReservation401),
      "404": decodeError("GetReservation404", GetReservation404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "updateReservation": (cloudId, reservationId, options: Parameters<DotyposClient["updateReservation"]>[2]) => __makePathRequest(HttpClientRequest.put, [cloudId, reservationId], () => "/clouds/" + __encodePathParam(cloudId) + "/reservations/" + __encodePathParam(reservationId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(UpdateReservation200),
      "401": decodeError("UpdateReservation401", UpdateReservation401),
      "404": decodeError("UpdateReservation404", UpdateReservation404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "cancelReservation": (cloudId, reservationId, options: Parameters<DotyposClient["cancelReservation"]>[2]) => __makePathRequest(HttpClientRequest.delete, [cloudId, reservationId], () => "/clouds/" + __encodePathParam(cloudId) + "/reservations/" + __encodePathParam(reservationId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "401": decodeError("CancelReservation401", CancelReservation401),
      "404": decodeError("CancelReservation404", CancelReservation404),
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
    ))
  ),
    "patchReservation": (cloudId, reservationId, options: Parameters<DotyposClient["patchReservation"]>[2]) => __makePathRequest(HttpClientRequest.patch, [cloudId, reservationId], () => "/clouds/" + __encodePathParam(cloudId) + "/reservations/" + __encodePathParam(reservationId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PatchReservation200),
      "400": decodeError("PatchReservation400", PatchReservation400),
      "401": decodeError("PatchReservation401", PatchReservation401),
      "404": decodeError("PatchReservation404", PatchReservation404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getCustomers": (cloudId, options: Parameters<DotyposClient["getCustomers"]>[1]) => __makePathRequest(HttpClientRequest.get, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/customers").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "filter": options?.params?.["filter"] as any, "sort": options?.params?.["sort"] as any, "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCustomers200),
      "401": decodeError("GetCustomers401", GetCustomers401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "replaceCustomers": (cloudId, options: Parameters<DotyposClient["replaceCustomers"]>[1]) => __makePathRequest(HttpClientRequest.put, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/customers").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceCustomers200),
      "400": decodeError("ReplaceCustomers400", ReplaceCustomers400),
      "401": decodeError("ReplaceCustomers401", ReplaceCustomers401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "createCustomers": (cloudId, options: Parameters<DotyposClient["createCustomers"]>[1]) => __makePathRequest(HttpClientRequest.post, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/customers").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateCustomers200),
      "400": decodeError("CreateCustomers400", CreateCustomers400),
      "401": decodeError("CreateCustomers401", CreateCustomers401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getTables": (cloudId, options: Parameters<DotyposClient["getTables"]>[1]) => __makePathRequest(HttpClientRequest.get, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/tables").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetTables200),
      "401": decodeError("GetTables401", GetTables401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getTable": (cloudId, tableId, options: Parameters<DotyposClient["getTable"]>[2]) => __makePathRequest(HttpClientRequest.get, [cloudId, tableId], () => "/clouds/" + __encodePathParam(cloudId) + "/tables/" + __encodePathParam(tableId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetTable200),
      "401": decodeError("GetTable401", GetTable401),
      "404": decodeError("GetTable404", GetTable404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getProducts": (cloudId, options: Parameters<DotyposClient["getProducts"]>[1]) => __makePathRequest(HttpClientRequest.get, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/products").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "filter": options?.params?.["filter"] as any, "sort": options?.params?.["sort"] as any, "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any, "include": options?.params?.["include"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetProducts200),
      "401": decodeError("GetProducts401", GetProducts401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "replaceProducts": (cloudId, options: Parameters<DotyposClient["replaceProducts"]>[1]) => __makePathRequest(HttpClientRequest.put, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/products").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceProducts200),
      "400": decodeError("ReplaceProducts400", ReplaceProducts400),
      "401": decodeError("ReplaceProducts401", ReplaceProducts401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "createProducts": (cloudId, options: Parameters<DotyposClient["createProducts"]>[1]) => __makePathRequest(HttpClientRequest.post, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/products").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateProducts200),
      "400": decodeError("CreateProducts400", CreateProducts400),
      "401": decodeError("CreateProducts401", CreateProducts401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getProduct": (cloudId, productId, options: Parameters<DotyposClient["getProduct"]>[2]) => __makePathRequest(HttpClientRequest.get, [cloudId, productId], () => "/clouds/" + __encodePathParam(cloudId) + "/products/" + __encodePathParam(productId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "include": options?.params?.["include"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetProduct200),
      "401": decodeError("GetProduct401", GetProduct401),
      "404": decodeError("GetProduct404", GetProduct404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "replaceProduct": (cloudId, productId, options: Parameters<DotyposClient["replaceProduct"]>[2]) => __makePathRequest(HttpClientRequest.put, [cloudId, productId], () => "/clouds/" + __encodePathParam(cloudId) + "/products/" + __encodePathParam(productId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceProduct200),
      "400": decodeError("ReplaceProduct400", ReplaceProduct400),
      "401": decodeError("ReplaceProduct401", ReplaceProduct401),
      "404": decodeError("ReplaceProduct404", ReplaceProduct404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "deleteProduct": (cloudId, productId, options: Parameters<DotyposClient["deleteProduct"]>[2]) => __makePathRequest(HttpClientRequest.delete, [cloudId, productId], () => "/clouds/" + __encodePathParam(cloudId) + "/products/" + __encodePathParam(productId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(DeleteProduct200),
      "401": decodeError("DeleteProduct401", DeleteProduct401),
      "404": decodeError("DeleteProduct404", DeleteProduct404),
      "409": decodeError("DeleteProduct409", DeleteProduct409),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "patchProduct": (cloudId, productId, options: Parameters<DotyposClient["patchProduct"]>[2]) => __makePathRequest(HttpClientRequest.patch, [cloudId, productId], () => "/clouds/" + __encodePathParam(cloudId) + "/products/" + __encodePathParam(productId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PatchProduct200),
      "400": decodeError("PatchProduct400", PatchProduct400),
      "401": decodeError("PatchProduct401", PatchProduct401),
      "404": decodeError("PatchProduct404", PatchProduct404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getCategories": (cloudId, options: Parameters<DotyposClient["getCategories"]>[1]) => __makePathRequest(HttpClientRequest.get, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/categories").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any, "filter": options?.params?.["filter"] as any, "sort": options?.params?.["sort"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCategories200),
      "401": decodeError("GetCategories401", GetCategories401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "replaceCategories": (cloudId, options: Parameters<DotyposClient["replaceCategories"]>[1]) => __makePathRequest(HttpClientRequest.put, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/categories").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceCategories200),
      "400": decodeError("ReplaceCategories400", ReplaceCategories400),
      "401": decodeError("ReplaceCategories401", ReplaceCategories401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "createCategories": (cloudId, options: Parameters<DotyposClient["createCategories"]>[1]) => __makePathRequest(HttpClientRequest.post, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/categories").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(CreateCategories200),
      "400": decodeError("CreateCategories400", CreateCategories400),
      "401": decodeError("CreateCategories401", CreateCategories401),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getCategory": (cloudId, categoryId, options: Parameters<DotyposClient["getCategory"]>[2]) => __makePathRequest(HttpClientRequest.get, [cloudId, categoryId], () => "/clouds/" + __encodePathParam(cloudId) + "/categories/" + __encodePathParam(categoryId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCategory200),
      "401": decodeError("GetCategory401", GetCategory401),
      "404": decodeError("GetCategory404", GetCategory404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "replaceCategory": (cloudId, categoryId, options: Parameters<DotyposClient["replaceCategory"]>[2]) => __makePathRequest(HttpClientRequest.put, [cloudId, categoryId], () => "/clouds/" + __encodePathParam(cloudId) + "/categories/" + __encodePathParam(categoryId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params?.["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(ReplaceCategory200),
      "400": decodeError("ReplaceCategory400", ReplaceCategory400),
      "401": decodeError("ReplaceCategory401", ReplaceCategory401),
      "404": decodeError("ReplaceCategory404", ReplaceCategory404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "deleteCategory": (cloudId, categoryId, options: Parameters<DotyposClient["deleteCategory"]>[2]) => __makePathRequest(HttpClientRequest.delete, [cloudId, categoryId], () => "/clouds/" + __encodePathParam(cloudId) + "/categories/" + __encodePathParam(categoryId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options?.params?.["If-Match"] ?? undefined }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "401": decodeError("DeleteCategory401", DeleteCategory401),
      "404": decodeError("DeleteCategory404", DeleteCategory404),
      "409": decodeError("DeleteCategory409", DeleteCategory409),
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
    ))
  ),
    "patchCategory": (cloudId, categoryId, options: Parameters<DotyposClient["patchCategory"]>[2]) => __makePathRequest(HttpClientRequest.patch, [cloudId, categoryId], () => "/clouds/" + __encodePathParam(cloudId) + "/categories/" + __encodePathParam(categoryId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PatchCategory200),
      "400": decodeError("PatchCategory400", PatchCategory400),
      "401": decodeError("PatchCategory401", PatchCategory401),
      "404": decodeError("PatchCategory404", PatchCategory404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getCustomer": (cloudId, customerId, options: Parameters<DotyposClient["getCustomer"]>[2]) => __makePathRequest(HttpClientRequest.get, [cloudId, customerId], () => "/clouds/" + __encodePathParam(cloudId) + "/customers/" + __encodePathParam(customerId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetCustomer200),
      "401": decodeError("GetCustomer401", GetCustomer401),
      "404": decodeError("GetCustomer404", GetCustomer404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "updateCustomer": (cloudId, customerId, options: Parameters<DotyposClient["updateCustomer"]>[2]) => __makePathRequest(HttpClientRequest.put, [cloudId, customerId], () => "/clouds/" + __encodePathParam(cloudId) + "/customers/" + __encodePathParam(customerId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(UpdateCustomer200),
      "400": decodeError("UpdateCustomer400", UpdateCustomer400),
      "401": decodeError("UpdateCustomer401", UpdateCustomer401),
      "404": decodeError("UpdateCustomer404", UpdateCustomer404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "deleteCustomer": (cloudId, customerId, options: Parameters<DotyposClient["deleteCustomer"]>[2]) => __makePathRequest(HttpClientRequest.delete, [cloudId, customerId], () => "/clouds/" + __encodePathParam(cloudId) + "/customers/" + __encodePathParam(customerId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "anonymize": options?.params?.["anonymize"] as any }),
      HttpClientRequest.setHeaders({ "If-Match": options?.params?.["If-Match"] ?? undefined }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "401": decodeError("DeleteCustomer401", DeleteCustomer401),
      "404": decodeError("DeleteCustomer404", DeleteCustomer404),
      "200": () => Effect.void,
      orElse: unexpectedStatus
    }))
    ))
  ),
    "patchCustomer": (cloudId, customerId, options: Parameters<DotyposClient["patchCustomer"]>[2]) => __makePathRequest(HttpClientRequest.patch, [cloudId, customerId], () => "/clouds/" + __encodePathParam(cloudId) + "/customers/" + __encodePathParam(customerId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setHeaders({ "If-Match": options.params["If-Match"] ?? undefined }),
      HttpClientRequest.bodyJsonUnsafe(options.payload),
      withResponse(options.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(PatchCustomer200),
      "400": decodeError("PatchCustomer400", PatchCustomer400),
      "401": decodeError("PatchCustomer401", PatchCustomer401),
      "404": decodeError("PatchCustomer404", PatchCustomer404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getDiscountGroups": (cloudId, options: Parameters<DotyposClient["getDiscountGroups"]>[1]) => __makePathRequest(HttpClientRequest.get, [cloudId], () => "/clouds/" + __encodePathParam(cloudId) + "/discount-groups").pipe(
    Effect.flatMap((request) => request.pipe(
      HttpClientRequest.setUrlParams({ "filter": options?.params?.["filter"] as any, "page": options?.params?.["page"] as any, "limit": options?.params?.["limit"] as any }),
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetDiscountGroups200),
      "401": decodeError("GetDiscountGroups401", GetDiscountGroups401),
      "404": decodeError("GetDiscountGroups404", GetDiscountGroups404),
      orElse: unexpectedStatus
    }))
    ))
  ),
    "getDiscountGroup": (cloudId, discountGroupId, options: Parameters<DotyposClient["getDiscountGroup"]>[2]) => __makePathRequest(HttpClientRequest.get, [cloudId, discountGroupId], () => "/clouds/" + __encodePathParam(cloudId) + "/discount-groups/" + __encodePathParam(discountGroupId) + "").pipe(
    Effect.flatMap((request) => request.pipe(
      withResponse(options?.config)(HttpClientResponse.matchStatus({
      "2xx": decodeSuccess(GetDiscountGroup200),
      "401": decodeError("GetDiscountGroup401", GetDiscountGroup401),
      "404": decodeError("GetDiscountGroup404", GetDiscountGroup404),
      orElse: unexpectedStatus
    }))
    ))
  )
  }
}

export interface DotyposClient<E = HttpClientError.HttpClientError, R = never> {
  readonly httpClient: HttpClient.HttpClient.With<E, R>
  /**
* Get access token from refresh token
*/
readonly "getAccessToken": {
    <Config extends OperationConfig | undefined = undefined>(options: { readonly params: typeof GetAccessTokenParams.Encoded; readonly payload: typeof GetAccessTokenRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<GetAccessToken201, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetAccessToken400", GetAccessToken400> | DotyposClientError<"GetAccessToken401", GetAccessToken401>, R>;
    <Config extends OperationConfig | undefined = undefined>(options: { readonly params: typeof GetAccessTokenParams.Encoded; readonly payload: typeof GetAccessTokenRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<GetAccessToken201, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetAccessToken400", GetAccessToken400> | DotyposClientError<"GetAccessToken401", GetAccessToken401>, R>;
  }
  /**
* List reservations
*/
readonly "listReservations": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ListReservationsParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<ListReservations200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ListReservations401", ListReservations401> | DotyposClientError<"ListReservations404", ListReservations404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ListReservationsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<ListReservations200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ListReservations401", ListReservations401> | DotyposClientError<"ListReservations404", ListReservations404>, R>;
  }
  /**
* Replace or create reservations
*/
readonly "replaceReservations": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ReplaceReservationsParams.Encoded | undefined; readonly payload: typeof ReplaceReservationsRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<ReplaceReservations200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceReservations400", ReplaceReservations400> | DotyposClientError<"ReplaceReservations401", ReplaceReservations401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ReplaceReservationsParams.Encoded | undefined; readonly payload: typeof ReplaceReservationsRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<ReplaceReservations200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceReservations400", ReplaceReservations400> | DotyposClientError<"ReplaceReservations401", ReplaceReservations401>, R>;
  }
  /**
* Create a new reservation
*/
readonly "createReservation": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly payload: typeof CreateReservationRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<CreateReservation200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateReservation400", CreateReservation400> | DotyposClientError<"CreateReservation401", CreateReservation401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly payload: typeof CreateReservationRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<CreateReservation200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateReservation400", CreateReservation400> | DotyposClientError<"CreateReservation401", CreateReservation401>, R>;
  }
  /**
* Get reservation by ID
*/
readonly "getReservation": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, reservationId: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<GetReservation200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetReservation401", GetReservation401> | DotyposClientError<"GetReservation404", GetReservation404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, reservationId: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetReservation200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetReservation401", GetReservation401> | DotyposClientError<"GetReservation404", GetReservation404>, R>;
  }
  /**
* Update reservation
*/
readonly "updateReservation": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, reservationId: string, options: { readonly payload: typeof UpdateReservationRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<UpdateReservation200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"UpdateReservation401", UpdateReservation401> | DotyposClientError<"UpdateReservation404", UpdateReservation404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, reservationId: string, options: { readonly payload: typeof UpdateReservationRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<UpdateReservation200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"UpdateReservation401", UpdateReservation401> | DotyposClientError<"UpdateReservation404", UpdateReservation404>, R>;
  }
  /**
* Cancel reservation
*/
readonly "cancelReservation": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, reservationId: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<void, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CancelReservation401", CancelReservation401> | DotyposClientError<"CancelReservation404", CancelReservation404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, reservationId: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<void, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CancelReservation401", CancelReservation401> | DotyposClientError<"CancelReservation404", CancelReservation404>, R>;
  }
  /**
* Partially update reservation
*/
readonly "patchReservation": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, reservationId: string, options: { readonly params: typeof PatchReservationParams.Encoded; readonly payload: typeof PatchReservationRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<PatchReservation200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchReservation400", PatchReservation400> | DotyposClientError<"PatchReservation401", PatchReservation401> | DotyposClientError<"PatchReservation404", PatchReservation404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, reservationId: string, options: { readonly params: typeof PatchReservationParams.Encoded; readonly payload: typeof PatchReservationRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<PatchReservation200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchReservation400", PatchReservation400> | DotyposClientError<"PatchReservation401", PatchReservation401> | DotyposClientError<"PatchReservation404", PatchReservation404>, R>;
  }
  /**
* Get customers
*/
readonly "getCustomers": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetCustomersParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<GetCustomers200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCustomers401", GetCustomers401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetCustomersParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetCustomers200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCustomers401", GetCustomers401>, R>;
  }
  /**
* Replace or create customers
*/
readonly "replaceCustomers": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ReplaceCustomersParams.Encoded | undefined; readonly payload: typeof ReplaceCustomersRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<ReplaceCustomers200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCustomers400", ReplaceCustomers400> | DotyposClientError<"ReplaceCustomers401", ReplaceCustomers401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ReplaceCustomersParams.Encoded | undefined; readonly payload: typeof ReplaceCustomersRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<ReplaceCustomers200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCustomers400", ReplaceCustomers400> | DotyposClientError<"ReplaceCustomers401", ReplaceCustomers401>, R>;
  }
  /**
* Create customers
*/
readonly "createCustomers": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly payload: typeof CreateCustomersRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<CreateCustomers200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateCustomers400", CreateCustomers400> | DotyposClientError<"CreateCustomers401", CreateCustomers401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly payload: typeof CreateCustomersRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<CreateCustomers200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateCustomers400", CreateCustomers400> | DotyposClientError<"CreateCustomers401", CreateCustomers401>, R>;
  }
  /**
* Get tables
*/
readonly "getTables": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetTablesParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<GetTables200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetTables401", GetTables401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetTablesParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetTables200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetTables401", GetTables401>, R>;
  }
  /**
* Get table by ID
*/
readonly "getTable": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, tableId: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<GetTable200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetTable401", GetTable401> | DotyposClientError<"GetTable404", GetTable404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, tableId: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetTable200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetTable401", GetTable401> | DotyposClientError<"GetTable404", GetTable404>, R>;
  }
  /**
* Get products
*/
readonly "getProducts": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetProductsParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<GetProducts200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetProducts401", GetProducts401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetProductsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetProducts200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetProducts401", GetProducts401>, R>;
  }
  /**
* Replace or create products
*/
readonly "replaceProducts": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ReplaceProductsParams.Encoded | undefined; readonly payload: typeof ReplaceProductsRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<ReplaceProducts200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceProducts400", ReplaceProducts400> | DotyposClientError<"ReplaceProducts401", ReplaceProducts401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ReplaceProductsParams.Encoded | undefined; readonly payload: typeof ReplaceProductsRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<ReplaceProducts200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceProducts400", ReplaceProducts400> | DotyposClientError<"ReplaceProducts401", ReplaceProducts401>, R>;
  }
  /**
* Create products
*/
readonly "createProducts": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly payload: typeof CreateProductsRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<CreateProducts200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateProducts400", CreateProducts400> | DotyposClientError<"CreateProducts401", CreateProducts401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly payload: typeof CreateProductsRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<CreateProducts200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateProducts400", CreateProducts400> | DotyposClientError<"CreateProducts401", CreateProducts401>, R>;
  }
  /**
* Get product by ID
*/
readonly "getProduct": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, productId: string, options: { readonly params?: typeof GetProductParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<GetProduct200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetProduct401", GetProduct401> | DotyposClientError<"GetProduct404", GetProduct404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, productId: string, options: { readonly params?: typeof GetProductParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetProduct200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetProduct401", GetProduct401> | DotyposClientError<"GetProduct404", GetProduct404>, R>;
  }
  /**
* Replace or create product
*/
readonly "replaceProduct": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, productId: string, options: { readonly params?: typeof ReplaceProductParams.Encoded | undefined; readonly payload: typeof ReplaceProductRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<ReplaceProduct200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceProduct400", ReplaceProduct400> | DotyposClientError<"ReplaceProduct401", ReplaceProduct401> | DotyposClientError<"ReplaceProduct404", ReplaceProduct404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, productId: string, options: { readonly params?: typeof ReplaceProductParams.Encoded | undefined; readonly payload: typeof ReplaceProductRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<ReplaceProduct200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceProduct400", ReplaceProduct400> | DotyposClientError<"ReplaceProduct401", ReplaceProduct401> | DotyposClientError<"ReplaceProduct404", ReplaceProduct404>, R>;
  }
  /**
* Delete product
*/
readonly "deleteProduct": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, productId: string, options: { readonly params?: typeof DeleteProductParams.Encoded | undefined; readonly payload: typeof DeleteProductRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<DeleteProduct200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteProduct401", DeleteProduct401> | DotyposClientError<"DeleteProduct404", DeleteProduct404> | DotyposClientError<"DeleteProduct409", DeleteProduct409>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, productId: string, options: { readonly params?: typeof DeleteProductParams.Encoded | undefined; readonly payload: typeof DeleteProductRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<DeleteProduct200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteProduct401", DeleteProduct401> | DotyposClientError<"DeleteProduct404", DeleteProduct404> | DotyposClientError<"DeleteProduct409", DeleteProduct409>, R>;
  }
  /**
* Partially update product
*/
readonly "patchProduct": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, productId: string, options: { readonly params: typeof PatchProductParams.Encoded; readonly payload: typeof PatchProductRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<PatchProduct200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchProduct400", PatchProduct400> | DotyposClientError<"PatchProduct401", PatchProduct401> | DotyposClientError<"PatchProduct404", PatchProduct404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, productId: string, options: { readonly params: typeof PatchProductParams.Encoded; readonly payload: typeof PatchProductRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<PatchProduct200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchProduct400", PatchProduct400> | DotyposClientError<"PatchProduct401", PatchProduct401> | DotyposClientError<"PatchProduct404", PatchProduct404>, R>;
  }
  /**
* Get product categories
*/
readonly "getCategories": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetCategoriesParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<GetCategories200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCategories401", GetCategories401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetCategoriesParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetCategories200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCategories401", GetCategories401>, R>;
  }
  /**
* Replace or create product categories
*/
readonly "replaceCategories": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ReplaceCategoriesParams.Encoded | undefined; readonly payload: typeof ReplaceCategoriesRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<ReplaceCategories200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCategories400", ReplaceCategories400> | DotyposClientError<"ReplaceCategories401", ReplaceCategories401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof ReplaceCategoriesParams.Encoded | undefined; readonly payload: typeof ReplaceCategoriesRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<ReplaceCategories200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCategories400", ReplaceCategories400> | DotyposClientError<"ReplaceCategories401", ReplaceCategories401>, R>;
  }
  /**
* Create product categories
*/
readonly "createCategories": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly payload: typeof CreateCategoriesRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<CreateCategories200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateCategories400", CreateCategories400> | DotyposClientError<"CreateCategories401", CreateCategories401>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly payload: typeof CreateCategoriesRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<CreateCategories200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"CreateCategories400", CreateCategories400> | DotyposClientError<"CreateCategories401", CreateCategories401>, R>;
  }
  /**
* Get product category by ID
*/
readonly "getCategory": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, categoryId: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<GetCategory200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCategory401", GetCategory401> | DotyposClientError<"GetCategory404", GetCategory404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, categoryId: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetCategory200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCategory401", GetCategory401> | DotyposClientError<"GetCategory404", GetCategory404>, R>;
  }
  /**
* Replace or create product category
*/
readonly "replaceCategory": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, categoryId: string, options: { readonly params?: typeof ReplaceCategoryParams.Encoded | undefined; readonly payload: typeof ReplaceCategoryRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<ReplaceCategory200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCategory400", ReplaceCategory400> | DotyposClientError<"ReplaceCategory401", ReplaceCategory401> | DotyposClientError<"ReplaceCategory404", ReplaceCategory404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, categoryId: string, options: { readonly params?: typeof ReplaceCategoryParams.Encoded | undefined; readonly payload: typeof ReplaceCategoryRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<ReplaceCategory200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"ReplaceCategory400", ReplaceCategory400> | DotyposClientError<"ReplaceCategory401", ReplaceCategory401> | DotyposClientError<"ReplaceCategory404", ReplaceCategory404>, R>;
  }
  /**
* Delete product category
*/
readonly "deleteCategory": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, categoryId: string, options: { readonly params?: typeof DeleteCategoryParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<void, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteCategory401", DeleteCategory401> | DotyposClientError<"DeleteCategory404", DeleteCategory404> | DotyposClientError<"DeleteCategory409", DeleteCategory409>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, categoryId: string, options: { readonly params?: typeof DeleteCategoryParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<void, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteCategory401", DeleteCategory401> | DotyposClientError<"DeleteCategory404", DeleteCategory404> | DotyposClientError<"DeleteCategory409", DeleteCategory409>, R>;
  }
  /**
* Partially update product category
*/
readonly "patchCategory": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, categoryId: string, options: { readonly params: typeof PatchCategoryParams.Encoded; readonly payload: typeof PatchCategoryRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<PatchCategory200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchCategory400", PatchCategory400> | DotyposClientError<"PatchCategory401", PatchCategory401> | DotyposClientError<"PatchCategory404", PatchCategory404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, categoryId: string, options: { readonly params: typeof PatchCategoryParams.Encoded; readonly payload: typeof PatchCategoryRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<PatchCategory200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchCategory400", PatchCategory400> | DotyposClientError<"PatchCategory401", PatchCategory401> | DotyposClientError<"PatchCategory404", PatchCategory404>, R>;
  }
  /**
* Get customer by ID
*/
readonly "getCustomer": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, customerId: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<GetCustomer200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCustomer401", GetCustomer401> | DotyposClientError<"GetCustomer404", GetCustomer404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, customerId: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetCustomer200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetCustomer401", GetCustomer401> | DotyposClientError<"GetCustomer404", GetCustomer404>, R>;
  }
  /**
* Update customer
*/
readonly "updateCustomer": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, customerId: string, options: { readonly payload: typeof UpdateCustomerRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<UpdateCustomer200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"UpdateCustomer400", UpdateCustomer400> | DotyposClientError<"UpdateCustomer401", UpdateCustomer401> | DotyposClientError<"UpdateCustomer404", UpdateCustomer404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, customerId: string, options: { readonly payload: typeof UpdateCustomerRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<UpdateCustomer200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"UpdateCustomer400", UpdateCustomer400> | DotyposClientError<"UpdateCustomer401", UpdateCustomer401> | DotyposClientError<"UpdateCustomer404", UpdateCustomer404>, R>;
  }
  /**
* Delete customer
*/
readonly "deleteCustomer": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, customerId: string, options: { readonly params?: typeof DeleteCustomerParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<void, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteCustomer401", DeleteCustomer401> | DotyposClientError<"DeleteCustomer404", DeleteCustomer404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, customerId: string, options: { readonly params?: typeof DeleteCustomerParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<void, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"DeleteCustomer401", DeleteCustomer401> | DotyposClientError<"DeleteCustomer404", DeleteCustomer404>, R>;
  }
  /**
* Partially update customer
*/
readonly "patchCustomer": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, customerId: string, options: { readonly params: typeof PatchCustomerParams.Encoded; readonly payload: typeof PatchCustomerRequestJson.Encoded; readonly config: Config }): Effect.Effect<WithOptionalResponse<PatchCustomer200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchCustomer400", PatchCustomer400> | DotyposClientError<"PatchCustomer401", PatchCustomer401> | DotyposClientError<"PatchCustomer404", PatchCustomer404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, customerId: string, options: { readonly params: typeof PatchCustomerParams.Encoded; readonly payload: typeof PatchCustomerRequestJson.Encoded; readonly config?: Config | undefined }): Effect.Effect<WithOptionalResponse<PatchCustomer200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"PatchCustomer400", PatchCustomer400> | DotyposClientError<"PatchCustomer401", PatchCustomer401> | DotyposClientError<"PatchCustomer404", PatchCustomer404>, R>;
  }
  /**
* Get discount groups
*/
readonly "getDiscountGroups": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetDiscountGroupsParams.Encoded | undefined; readonly config: Config }): Effect.Effect<WithOptionalResponse<GetDiscountGroups200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetDiscountGroups401", GetDiscountGroups401> | DotyposClientError<"GetDiscountGroups404", GetDiscountGroups404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, options: { readonly params?: typeof GetDiscountGroupsParams.Encoded | undefined; readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetDiscountGroups200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetDiscountGroups401", GetDiscountGroups401> | DotyposClientError<"GetDiscountGroups404", GetDiscountGroups404>, R>;
  }
  /**
* Get discount group by ID
*/
readonly "getDiscountGroup": {
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, discountGroupId: string, options: { readonly config: Config }): Effect.Effect<WithOptionalResponse<GetDiscountGroup200, Config>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetDiscountGroup401", GetDiscountGroup401> | DotyposClientError<"GetDiscountGroup404", GetDiscountGroup404>, R>;
    <Config extends OperationConfig | undefined = undefined>(cloudId: string, discountGroupId: string, options: { readonly config?: Config | undefined } | undefined): Effect.Effect<WithOptionalResponse<GetDiscountGroup200, Config | undefined>, E | HttpClientError.HttpClientError | SchemaError | DotyposClientError<"GetDiscountGroup401", GetDiscountGroup401> | DotyposClientError<"GetDiscountGroup404", GetDiscountGroup404>, R>;
  }
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
