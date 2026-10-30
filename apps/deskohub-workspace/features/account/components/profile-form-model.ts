import {
  Array as Arr,
  Effect,
  Option,
  Predicate,
  Schema,
  type SchemaAST,
  SchemaIssue,
  SchemaTransformation,
} from "effect";
import {
  type CustomerProfile,
  type CustomerProfileCompletionInput,
  type CustomerProfileInput,
  completeCustomerProfileSchema,
  updateCustomerProfileSchema,
} from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";

export type ProfileFormSection = "profile" | "billing";

/**
 * The contract's billing union has no "hidden" member and rejects excess
 * properties, so the form keeps a flat values shape with a billing-kind
 * discriminator.
 */
const profileBillingKinds = ["hidden", "personal", "business"] as const;

export const profileBillingFieldNames = [
  "companyName",
  "companyId",
  "vatId",
  "addressLine1",
  "addressLine2",
  "city",
  "zip",
  "country",
] as const;

type ProfileBillingField = (typeof profileBillingFieldNames)[number];

const profileFormValuesSchema = Schema.Struct({
  firstName: Schema.String,
  lastName: Schema.String,
  phone: Schema.String,
  /** Initial completion only; never part of the profile contract. */
  referralCode: Schema.String,
  billingKind: Schema.Literals(profileBillingKinds),
  companyName: Schema.String,
  companyId: Schema.String,
  vatId: Schema.String,
  addressLine1: Schema.String,
  addressLine2: Schema.String,
  city: Schema.String,
  zip: Schema.String,
  country: Schema.String,
});

/** The flat values the form edits; also the saved baseline for dirty checks. */
export type ProfileFormValues = typeof profileFormValuesSchema.Type;

export type ProfileFormField = keyof ProfileFormValues;

type ProfileFormErrorMessage = (
  inputs: Record<string, never>,
  options: { readonly locale: Locale }
) => string;

/**
 * The form's field index: each field's section, its input `name`, and the
 * message for any error on it, whether client validation, the server action,
 * or native constraint validation rejected it. Billing inputs keep their
 * legacy public `name` attributes, prefixed with `billing`.
 */
const profileFormFields: {
  readonly [Field in ProfileFormField]: {
    readonly section: ProfileFormSection;
    readonly inputName: string;
    readonly errorMessage: ProfileFormErrorMessage;
  };
} = {
  firstName: {
    section: "profile",
    inputName: "firstName",
    errorMessage: m.accountProfileFirstNameRequired,
  },
  lastName: {
    section: "profile",
    inputName: "lastName",
    errorMessage: m.accountProfileValidationError,
  },
  phone: {
    section: "profile",
    inputName: "phone",
    errorMessage: m.accountProfilePhoneInvalid,
  },
  referralCode: {
    section: "profile",
    inputName: "referralCode",
    errorMessage: m.accountProfileReferralCodeUnavailable,
  },
  billingKind: {
    section: "billing",
    inputName: "billingKind",
    errorMessage: m.accountProfileValidationError,
  },
  companyName: {
    section: "billing",
    inputName: "billingCompanyName",
    errorMessage: m.accountProfileValidationError,
  },
  companyId: {
    section: "billing",
    inputName: "billingCompanyId",
    errorMessage: m.accountProfileValidationError,
  },
  vatId: {
    section: "billing",
    inputName: "billingVatId",
    errorMessage: m.accountProfileValidationError,
  },
  addressLine1: {
    section: "billing",
    inputName: "billingAddressLine1",
    errorMessage: m.accountProfileValidationError,
  },
  addressLine2: {
    section: "billing",
    inputName: "billingAddressLine2",
    errorMessage: m.accountProfileValidationError,
  },
  city: {
    section: "billing",
    inputName: "billingCity",
    errorMessage: m.accountProfileValidationError,
  },
  zip: {
    section: "billing",
    inputName: "billingZip",
    errorMessage: m.accountProfileValidationError,
  },
  country: {
    section: "billing",
    inputName: "billingCountry",
    errorMessage: m.accountProfileValidationError,
  },
};

const isProfileFormField = (name: string): name is ProfileFormField =>
  Object.hasOwn(profileFormFields, name);

const isProfileBillingField = (name: string): name is ProfileBillingField =>
  (profileBillingFieldNames as readonly string[]).includes(name);

export const profileFormSectionOf = (
  field: ProfileFormField
): ProfileFormSection => profileFormFields[field].section;

/**
 * The section to reveal for a set of invalid fields: profile before billing,
 * matching their order in the edit view.
 */
export const firstInvalidProfileFormSection = (
  fields: readonly string[]
): ProfileFormSection | undefined => {
  const sections = fields.filter(isProfileFormField).map(profileFormSectionOf);
  return (["profile", "billing"] as const).find((section) =>
    sections.includes(section)
  );
};

export const profileFormInputName = (field: ProfileFormField): string =>
  profileFormFields[field].inputName;

export const profileFormFieldOfInputName = (
  inputName: string
): ProfileFormField | undefined =>
  (Object.keys(profileFormFields) as ProfileFormField[]).find(
    (field) => profileFormFields[field].inputName === inputName
  );

export const profileFormErrorMessage = (
  field: ProfileFormField,
  locale: Locale
): string => profileFormFields[field].errorMessage({}, { locale });

/**
 * The form field a contract path belongs to. Billing errors that name no
 * billing field concern the billing kind.
 */
const profileFormFieldOf = (
  path: readonly PropertyKey[]
): ProfileFormField | undefined => {
  // String() instead of template literals: path segments may be symbols.
  const [head, nested] = path.map((segment) => String(segment));
  if (head === "billing") {
    return nested !== undefined && isProfileBillingField(nested)
      ? nested
      : "billingKind";
  }
  return head !== undefined && isProfileFormField(head) ? head : undefined;
};

type ProfileSource = {
  readonly firstName: string;
  readonly lastName?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly billing?:
    | ({ readonly kind: "personal" | "business" } & {
        readonly [Field in ProfileBillingField]?: string | null | undefined;
      })
    | null
    | undefined;
};

const toProfileFormValues = (
  profile: ProfileSource | null | undefined,
  referralCode = ""
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
  referralCode,
  vatId: profile?.billing?.vatId ?? "",
  zip: profile?.billing?.zip ?? "",
});

export const profileFormDefaults = (
  profile?: CustomerProfile | null,
  referralCode?: string
): ProfileFormValues => toProfileFormValues(profile, referralCode);

const trimmedToUndefined = (value: string) => {
  const text = value.trim();
  return text ? text : undefined;
};

const toCustomerProfileInput = (
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

/**
 * The completion payload: the profile plus a referral code when entered, and
 * the shared-link prefill it is compared against so a link code never blocks.
 */
const toCustomerProfileCompletionInput = (
  values: ProfileFormValues,
  prefilledReferralCode: string | undefined
): CustomerProfileCompletionInput => {
  const referralCode = trimmedToUndefined(values.referralCode);
  return {
    ...toCustomerProfileInput(values),
    ...(referralCode && { referralCode }),
    ...(referralCode && prefilledReferralCode && { prefilledReferralCode }),
  };
};

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * Moves a contract decoding failure onto the form fields it concerns, with
 * each field's error message, so it reaches the flat inputs rather than the
 * contract's nested paths. A path outside the field index keeps its own path
 * and message.
 */
const toProfileFormFieldIssue = (
  issue: SchemaIssue.Issue,
  contract: SchemaAST.AST,
  locale: Locale
): SchemaIssue.Issue => {
  const fieldIssues = new Map<string, SchemaIssue.Issue>();
  for (const { path = [], message } of formatIssue(issue).issues) {
    const segments = path.map((segment) =>
      Predicate.isObjectKeyword(segment) ? segment.key : segment
    );
    const field = profileFormFieldOf(segments);
    const key = field ?? segments.map((segment) => String(segment)).join(".");
    if (!fieldIssues.has(key)) {
      fieldIssues.set(
        key,
        new SchemaIssue.Pointer(
          field === undefined ? segments : [field],
          new SchemaIssue.InvalidValue(Option.none(), {
            message:
              field === undefined
                ? message
                : profileFormErrorMessage(field, locale),
          })
        )
      );
    }
  }
  const fieldIssueList = [...fieldIssues.values()];
  if (!Arr.isArrayNonEmpty(fieldIssueList)) return issue;
  return fieldIssueList.length === 1
    ? fieldIssueList[0]
    : new SchemaIssue.Composite(contract, Option.none(), fieldIssueList);
};

const reportedOnProfileFormFields =
  (locale: Locale) =>
  <S extends Schema.Top>(contract: S) =>
    contract.pipe(
      Schema.middlewareDecoding((decoding) =>
        Effect.mapError(decoding, (issue) =>
          toProfileFormFieldIssue(issue, contract.ast, locale)
        )
      )
    );

/**
 * Decodes the flat form values to the profile update contract, so client and
 * server share trimming and length rules. Failures land on the form fields
 * with messages in `locale`.
 */
export const profileFormSchema = (locale: Locale) =>
  profileFormValuesSchema.pipe(
    Schema.decodeTo(
      updateCustomerProfileSchema.pipe(reportedOnProfileFormFields(locale)),
      SchemaTransformation.transform({
        decode: toCustomerProfileInput,
        encode: (input) => toProfileFormValues(input),
      })
    )
  );

/**
 * The completion contract as the client checks it: the referral fields are
 * left to the server action, so a code it rejects comes back as a server
 * validation error rather than stopping the submit.
 */
const completionFormContract = Schema.Struct({
  ...completeCustomerProfileSchema.fields,
  referralCode: Schema.optional(Schema.String),
  prefilledReferralCode: Schema.optional(Schema.String),
});

/**
 * Decodes the flat form values to the first-time completion contract, which
 * adds the referral code. `prefilledReferralCode` is the code the form was
 * prefilled with from a shared link.
 */
export const completionFormSchema = (
  locale: Locale,
  prefilledReferralCode?: string
) =>
  profileFormValuesSchema.pipe(
    Schema.decodeTo(
      completionFormContract.pipe(reportedOnProfileFormFields(locale)),
      SchemaTransformation.transform({
        decode: (values) =>
          toCustomerProfileCompletionInput(values, prefilledReferralCode),
        encode: (input) => toProfileFormValues(input, input.referralCode),
      })
    )
  );

/**
 * The profile actions' flattened validation errors. A nested contract error
 * arrives under its first path segment as a `"field: message"` string, as
 * billing errors do.
 */
type ProfileActionValidationErrors = {
  readonly fieldErrors?: {
    readonly [key: string]: readonly string[] | undefined;
  };
};

/**
 * Translates the profile actions' validation errors into messages on the form
 * fields, and the section to reveal for them.
 */
export const toProfileFormErrors = (
  validationErrors: ProfileActionValidationErrors,
  locale: Locale
): {
  readonly errors: Partial<Record<ProfileFormField, string>>;
  readonly firstSection?: ProfileFormSection;
} => {
  const errors: Partial<Record<ProfileFormField, string>> = {};
  for (const [key, messages] of Object.entries(
    validationErrors.fieldErrors ?? {}
  )) {
    for (const message of messages ?? []) {
      const field = profileFormFieldOf(
        key === "billing" ? [key, message.split(":", 1)[0] ?? ""] : [key]
      );
      if (field !== undefined) {
        errors[field] = profileFormErrorMessage(field, locale);
      }
    }
  }
  const firstSection = firstInvalidProfileFormSection(Object.keys(errors));
  return { errors, ...(firstSection && { firstSection }) };
};
