import type { ComponentProps, RefObject } from "react";
import type { TextInputInstance } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { ChoiceGroup } from "../../ui/choice-group";
import { TextField } from "../../ui/controls";
import type {
  BillingChoice,
  CompletionDraft,
  CompletionTextField,
  ProfileDraftInvalid,
  ProfileFieldProblem,
} from "./profile-draft";

type InputProps = Pick<
  ComponentProps<typeof TextField>,
  | "autoComplete"
  | "textContentType"
  | "keyboardType"
  | "autoCapitalize"
  | "maxLength"
>;

// Lengths are the contract's limits, so typing stops where saving would fail.
const fieldInput: Record<
  CompletionTextField,
  InputProps & { readonly label: (locale: AppLocale) => string }
> = {
  firstName: {
    label: (locale) => m.profile_first_name_label({}, { locale }),
    autoComplete: "given-name",
    textContentType: "givenName",
    autoCapitalize: "words",
    maxLength: 100,
  },
  lastName: {
    label: (locale) => m.profile_last_name_label({}, { locale }),
    autoComplete: "family-name",
    textContentType: "familyName",
    autoCapitalize: "words",
    maxLength: 100,
  },
  phone: {
    label: (locale) => m.profile_phone_label({}, { locale }),
    autoComplete: "tel",
    textContentType: "telephoneNumber",
    keyboardType: "phone-pad",
    maxLength: 32,
  },
  referralCode: {
    label: (locale) => m.profile_referral_code_label({}, { locale }),
    autoComplete: "off",
    autoCapitalize: "characters",
    maxLength: 64,
  },
  companyName: {
    label: (locale) => m.profile_company_name_label({}, { locale }),
    autoComplete: "organization",
    textContentType: "organizationName",
    autoCapitalize: "words",
    maxLength: 200,
  },
  companyId: {
    label: (locale) => m.profile_company_id_label({}, { locale }),
    autoComplete: "off",
    keyboardType: "number-pad",
    maxLength: 32,
  },
  vatId: {
    label: (locale) => m.profile_vat_id_label({}, { locale }),
    autoComplete: "off",
    autoCapitalize: "characters",
    maxLength: 32,
  },
  addressLine1: {
    label: (locale) => m.profile_address_line1_label({}, { locale }),
    autoComplete: "address-line1",
    textContentType: "streetAddressLine1",
    autoCapitalize: "words",
    maxLength: 200,
  },
  addressLine2: {
    label: (locale) => m.profile_address_line2_label({}, { locale }),
    autoComplete: "address-line2",
    textContentType: "streetAddressLine2",
    autoCapitalize: "words",
    maxLength: 200,
  },
  city: {
    label: (locale) => m.profile_city_label({}, { locale }),
    autoComplete: "postal-address-locality",
    textContentType: "addressCity",
    autoCapitalize: "words",
    maxLength: 100,
  },
  zip: {
    label: (locale) => m.profile_zip_label({}, { locale }),
    autoComplete: "postal-code",
    textContentType: "postalCode",
    maxLength: 20,
  },
  country: {
    label: (locale) => m.profile_country_label({}, { locale }),
    autoComplete: "country",
    textContentType: "countryName",
    autoCapitalize: "characters",
    maxLength: 2,
  },
};

const problemMessage = (
  field: CompletionTextField,
  problem: ProfileFieldProblem,
  locale: AppLocale
) =>
  ({
    required: () =>
      field === "companyName"
        ? m.profile_company_name_required({}, { locale })
        : m.profile_first_name_required({}, { locale }),
    "invalid-phone": () => m.profile_phone_invalid({}, { locale }),
    invalid: () =>
      field === "referralCode"
        ? m.profile_referral_code_unavailable({}, { locale })
        : m.profile_field_invalid({}, { locale }),
  })[problem]();

/** Inputs a form can focus by field, e.g. its first invalid one. */
export type ProfileFieldRefs = RefObject<
  Map<CompletionTextField, TextInputInstance | null>
>;

/**
 * The text inputs for `fields` of a profile draft, each with its field's
 * problem from the last submit attempt.
 */
export function ProfileTextFields<F extends CompletionTextField>({
  fields,
  draft,
  invalid,
  onChange,
  inputs,
  editable,
  locale,
}: {
  readonly fields: ReadonlyArray<F>;
  readonly draft: Pick<CompletionDraft, F>;
  readonly invalid: ProfileDraftInvalid<CompletionTextField> | undefined;
  readonly onChange: (field: F, value: string) => void;
  readonly inputs: ProfileFieldRefs;
  readonly editable: boolean;
  readonly locale: AppLocale;
}) {
  return fields.map((field) => {
    const { label, ...input } = fieldInput[field];
    const problem = invalid?.fields[field];
    return (
      <TextField
        key={field}
        ref={(node) => {
          inputs.current.set(field, node);
        }}
        label={label(locale)}
        value={draft[field]}
        onChangeText={(value) => onChange(field, value)}
        editable={editable}
        error={
          problem === undefined
            ? undefined
            : problemMessage(field, problem, locale)
        }
        {...input}
      />
    );
  });
}

const billingChoices: ReadonlyArray<BillingChoice> = [
  "none",
  "personal",
  "business",
];

const billingChoiceLabel = (choice: BillingChoice, locale: AppLocale) =>
  ({
    none: m.profile_billing_none,
    personal: m.profile_billing_personal,
    business: m.profile_billing_business,
  })[choice]({}, { locale });

/** Whether to keep billing details, and of which kind. */
export function BillingChoiceField({
  value,
  onChange,
  disabled,
  locale,
}: {
  readonly value: BillingChoice;
  readonly onChange: (choice: BillingChoice) => void;
  readonly disabled: boolean;
  readonly locale: AppLocale;
}) {
  return (
    <ChoiceGroup
      label={m.profile_billing_kind_label({}, { locale })}
      options={billingChoices.map((choice) => ({
        value: choice,
        label: billingChoiceLabel(choice, locale),
      }))}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
