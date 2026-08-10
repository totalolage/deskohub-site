import {
  AdministrationCustomerDiscountCodeCreateInput,
  AdministrationCustomerSearchQuery,
  AdministrationDiscountCodeCreateInput,
  AdministrationDiscountCodeUpdateInput,
  AdministrationDiscountDefinitionInput,
  AdministrationDiscountLabels,
  AdministrationDiscountMutation,
  AdministrationDiscountUpdateInput,
  AdministrationExistingDiscountCodeCreateInput,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";

export const discountAdminLabelsSchema = AdministrationDiscountLabels;
export const createDiscountAdminInputSchema =
  AdministrationDiscountDefinitionInput;
export const updateDiscountAdminInputSchema = AdministrationDiscountUpdateInput;
export const createDiscountCodeAdminInputSchema =
  AdministrationExistingDiscountCodeCreateInput;
export const createManagedDiscountCodeAdminInputSchema =
  AdministrationDiscountCodeCreateInput;
export const updateDiscountCodeAdminInputSchema =
  AdministrationDiscountCodeUpdateInput;
export const createCustomerDiscountCodeAdminInputSchema =
  AdministrationCustomerDiscountCodeCreateInput;
export const discountAdminMutationSchema = AdministrationDiscountMutation;

export const discountAdminMutationStandardSchema = Schema.toStandardSchemaV1(
  discountAdminMutationSchema,
  {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  }
);

export const discountAdminCustomerSearchSchema =
  AdministrationCustomerSearchQuery;

export const discountAdminCustomerSearchStandardSchema =
  Schema.toStandardSchemaV1(discountAdminCustomerSearchSchema, {
    parseOptions: {
      errors: "all",
      onExcessProperty: "error",
    },
  });

export type CreateDiscountAdminInput =
  typeof createDiscountAdminInputSchema.Type;
export type UpdateDiscountAdminInput =
  typeof updateDiscountAdminInputSchema.Type;
export type CreateDiscountCodeAdminInput =
  typeof createDiscountCodeAdminInputSchema.Type;
export type CreateManagedDiscountCodeAdminInput =
  typeof createManagedDiscountCodeAdminInputSchema.Type;
export type CreateCustomerDiscountCodeAdminInput =
  typeof createCustomerDiscountCodeAdminInputSchema.Type;
export type UpdateDiscountCodeAdminInput =
  typeof updateDiscountCodeAdminInputSchema.Type;
export type DiscountAdminMutation = typeof discountAdminMutationSchema.Type;
export type DiscountAdminCustomerSearch =
  typeof discountAdminCustomerSearchSchema.Type;
