import {
  type AdministrationCustomerDiscountCodeCreateInput,
  AdministrationCustomerSearchQuery,
  type AdministrationCustomerVoucherCreateInput,
  type AdministrationDiscountCodeCreateInput,
  type AdministrationDiscountCodeUpdateInput,
  type AdministrationDiscountDefinitionInput,
  AdministrationDiscountMutation,
  type AdministrationDiscountUpdateInput,
  type AdministrationExistingDiscountCodeCreateInput,
  type AdministrationVoucherCreateInput,
  type AdministrationVoucherUpdateInput,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";

export const discountAdminMutationStandardSchema = Schema.toStandardSchemaV1(
  AdministrationDiscountMutation,
  {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  }
);

export const discountAdminCustomerSearchStandardSchema =
  Schema.toStandardSchemaV1(AdministrationCustomerSearchQuery, {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  });

export type CreateDiscountAdminInput =
  typeof AdministrationDiscountDefinitionInput.Type;
export type UpdateDiscountAdminInput =
  typeof AdministrationDiscountUpdateInput.Type;
export type CreateDiscountCodeAdminInput =
  typeof AdministrationExistingDiscountCodeCreateInput.Type;
export type CreateManagedDiscountCodeAdminInput =
  typeof AdministrationDiscountCodeCreateInput.Type;
export type CreateCustomerDiscountCodeAdminInput =
  typeof AdministrationCustomerDiscountCodeCreateInput.Type;
export type UpdateDiscountCodeAdminInput =
  typeof AdministrationDiscountCodeUpdateInput.Type;
export type CreateVoucherAdminInput =
  typeof AdministrationVoucherCreateInput.Type;
export type CreateCustomerVoucherAdminInput =
  typeof AdministrationCustomerVoucherCreateInput.Type;
export type UpdateVoucherAdminInput =
  typeof AdministrationVoucherUpdateInput.Type;
export type DiscountAdminMutation = typeof AdministrationDiscountMutation.Type;
export type DiscountAdminCustomerSearch =
  typeof AdministrationCustomerSearchQuery.Type;
