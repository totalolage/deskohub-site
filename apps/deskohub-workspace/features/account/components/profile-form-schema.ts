import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FieldErrors, Resolver } from "react-hook-form";
import type { CustomerProfileBilling } from "@/features/account/backend/customer-dotypos-adapter.service";
import {
  type CustomerProfileInput,
  updateCustomerProfileStandardSchema,
} from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";

/**
 * The contract's billing union has no "hidden" member and rejects excess
 * properties, so the form keeps a flat values shape with a billing-kind
 * discriminator and maps to `CustomerProfileInput` at submit time.
 */
export type ProfileBillingKind = "hidden" | "personal" | "business";

export type ProfileFormValues = {
  addressLine1: string;
  addressLine2: string;
  billingKind: ProfileBillingKind;
  city: string;
  companyName: string;
  companyId: string;
  country: string;
  firstName: string;
  lastName: string;
  phone: string;
  vatId: string;
  zip: string;
};

export const profileBillingFieldNames = [
  "companyName",
  "companyId",
  "vatId",
  "addressLine1",
  "addressLine2",
  "city",
  "zip",
  "country",
] as const satisfies readonly (keyof ProfileFormValues)[];

export type ProfileBillingFieldName = (typeof profileBillingFieldNames)[number];

/**
 * Billing inputs keep their legacy public DOM `name` attributes (prefixed
 * with `billing`) for native validation messages and the account-visual
 * harness, even though the RHF field paths drop the prefix. Non-billing
 * fields use their field path as the DOM name.
 */
const billingFieldPathByDomName = new Map<string, ProfileBillingFieldName>(
  profileBillingFieldNames.map((field) => [
    `billing${field.charAt(0).toUpperCase()}${field.slice(1)}`,
    field,
  ])
);

export const profileFieldPathFromDomName = (domName: string): string =>
  billingFieldPathByDomName.get(domName) ?? domName;

const trimmedToUndefined = (value: string) => {
  const text = value.trim();
  return text ? text : undefined;
};

export const getProfileFormDefaultValues = (
  profile?: {
    readonly firstName: string;
    readonly lastName: string | null;
    readonly phone: string | null;
    readonly billing: CustomerProfileBilling | null;
  } | null
): ProfileFormValues => ({
  addressLine1: profile?.billing?.addressLine1 ?? "",
  addressLine2: profile?.billing?.addressLine2 ?? "",
  billingKind: profile?.billing?.kind ?? "hidden",
  city: profile?.billing?.city ?? "",
  companyName: profile?.billing?.companyName ?? "",
  companyId: profile?.billing?.companyId ?? "",
  country: profile?.billing?.country ?? "",
  firstName: profile?.firstName ?? "",
  lastName: profile?.lastName ?? "",
  phone: profile?.phone ?? "",
  vatId: profile?.billing?.vatId ?? "",
  zip: profile?.billing?.zip ?? "",
});

export const toCustomerProfileInput = (
  values: ProfileFormValues
): CustomerProfileInput => {
  const base = {
    firstName: values.firstName.trim(),
    lastName: trimmedToUndefined(values.lastName),
    phone: trimmedToUndefined(values.phone),
  };
  if (values.billingKind === "business") {
    return {
      ...base,
      billing: {
        kind: "business",
        companyName: values.companyName.trim(),
        companyId: trimmedToUndefined(values.companyId),
        vatId: trimmedToUndefined(values.vatId),
        addressLine1: trimmedToUndefined(values.addressLine1),
        addressLine2: trimmedToUndefined(values.addressLine2),
        city: trimmedToUndefined(values.city),
        zip: trimmedToUndefined(values.zip),
        country: trimmedToUndefined(values.country),
      },
    };
  }
  if (values.billingKind === "personal") {
    return {
      ...base,
      billing: {
        kind: "personal",
        addressLine1: trimmedToUndefined(values.addressLine1),
        addressLine2: trimmedToUndefined(values.addressLine2),
        city: trimmedToUndefined(values.city),
        zip: trimmedToUndefined(values.zip),
        country: trimmedToUndefined(values.country),
      },
    };
  }
  return base;
};

const issuePathToFormField = (
  path: readonly unknown[] | undefined
): keyof ProfileFormValues | undefined => {
  // String() instead of template literals: path segments may be symbols.
  const segments = (path ?? []).map((segment) => String(segment));
  if (segments[0] === "billing" && segments[1] !== undefined) {
    return segments[1] as keyof ProfileFormValues;
  }
  return segments[0] as keyof ProfileFormValues | undefined;
};

const profileFieldCopy = (field: keyof ProfileFormValues, locale: Locale) => {
  if (field === "firstName") {
    return m.accountProfileFirstNameRequired({}, { locale });
  }
  if (field === "phone") {
    return m.accountProfilePhoneInvalid({}, { locale });
  }
  return m.accountProfileValidationError({}, { locale });
};

/**
 * Client validation runs the mapped payload through the same contract schema
 * the server action enforces, so trimming and length rules cannot drift
 * between client and server. The resolver keeps the form values shape; the
 * contract payload is produced by `toCustomerProfileInput` at submit time.
 */
export const createProfileFormResolver =
  (locale: Locale): Resolver<ProfileFormValues> =>
  async (values) => {
    const payload = toCustomerProfileInput(values);
    const outcome: StandardSchemaV1.Result<CustomerProfileInput> =
      await updateCustomerProfileStandardSchema["~standard"].validate(payload);
    if (outcome.issues) {
      const errors: FieldErrors<ProfileFormValues> = {};
      for (const issue of outcome.issues) {
        const field = issuePathToFormField(issue.path);
        if (field !== undefined && errors[field] === undefined) {
          errors[field] = {
            type: "validation",
            message: profileFieldCopy(field, locale),
          };
        }
      }
      return { values: {}, errors };
    }
    return { values, errors: {} };
  };
