import { describe, expect, test } from "bun:test";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import type { ResolverOptions } from "react-hook-form";
import type { CustomerProfile } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import {
  completionFormSchema,
  firstInvalidProfileFormSection,
  type ProfileFormField,
  type ProfileFormValues,
  profileBillingFieldNames,
  profileFormDefaults,
  profileFormErrorMessage,
  profileFormFieldOfInputName,
  profileFormInputName,
  profileFormSchema,
  profileFormSectionOf,
  toProfileFormErrors,
} from "./profile-form-model";

type FormSchema =
  | ReturnType<typeof profileFormSchema>
  | ReturnType<typeof completionFormSchema>;

const resolve = (schema: FormSchema, formValues: ProfileFormValues) =>
  effectSchemaResolver(schema)(formValues, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  } as ResolverOptions<ProfileFormValues>);

const errorsOf = async (schema: FormSchema, formValues: ProfileFormValues) =>
  Object.fromEntries(
    Object.entries((await resolve(schema, formValues)).errors).map(
      ([field, error]) => [field, error?.message]
    )
  );

const businessProfile: CustomerProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420601111222",
  billing: {
    kind: "business",
    addressLine1: "Original Street 1",
    addressLine2: null,
    city: "Prague",
    zip: "11000",
    country: "CZ",
    companyName: "Original Company",
    companyId: "12345678",
    vatId: null,
  },
};

const values = (overrides: Partial<ProfileFormValues> = {}) => ({
  ...profileFormDefaults(businessProfile),
  ...overrides,
});

const allFields = [
  "firstName",
  "lastName",
  "phone",
  "referralCode",
  "billingKind",
  ...profileBillingFieldNames,
] as const satisfies readonly ProfileFormField[];

describe("profileFormDefaults", () => {
  test("fills every field from the profile, with blanks for missing values", () => {
    expect(profileFormDefaults(businessProfile, "FRIEND10")).toEqual({
      addressLine1: "Original Street 1",
      addressLine2: "",
      billingKind: "business",
      city: "Prague",
      companyName: "Original Company",
      companyId: "12345678",
      country: "CZ",
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+420601111222",
      referralCode: "FRIEND10",
      vatId: "",
      zip: "11000",
    });
  });

  test("starts a missing profile blank with billing hidden", () => {
    const defaults = profileFormDefaults();
    expect(defaults.billingKind).toBe("hidden");
    expect(
      Object.entries(defaults).filter(([field]) => field !== "billingKind")
    ).toEqual(
      Object.keys(defaults)
        .filter((field) => field !== "billingKind")
        .map((field) => [field, ""])
    );
  });
});

describe("profileFormSchema", () => {
  test("decodes business values to the trimmed contract payload", async () => {
    const result = await resolve(
      profileFormSchema("en-US"),
      values({
        firstName: "  Grace ",
        lastName: "   ",
        companyName: " Draft Company ",
        vatId: " CZ12345678 ",
        referralCode: "IGNORED",
      })
    );
    expect(result.errors).toEqual({});
    expect(result.values).toStrictEqual({
      firstName: "Grace",
      lastName: undefined,
      phone: "+420601111222",
      billing: {
        kind: "business",
        addressLine1: "Original Street 1",
        addressLine2: undefined,
        city: "Prague",
        zip: "11000",
        country: "CZ",
        companyName: "Draft Company",
        companyId: "12345678",
        vatId: "CZ12345678",
      },
    });
  });

  test("submits only address fields for personal billing", async () => {
    const result = await resolve(
      profileFormSchema("en-US"),
      values({ billingKind: "personal", companyName: "   " })
    );
    expect(result.errors).toEqual({});
    expect(result.values).toStrictEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+420601111222",
      billing: {
        kind: "personal",
        addressLine1: "Original Street 1",
        addressLine2: undefined,
        city: "Prague",
        zip: "11000",
        country: "CZ",
      },
    });
  });

  test("omits billing when it is hidden", async () => {
    const result = await resolve(
      profileFormSchema("en-US"),
      values({ billingKind: "hidden", companyName: "", country: "CZE" })
    );
    expect(result.errors).toEqual({});
    expect(result.values).toStrictEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+420601111222",
    });
  });

  test.each(["en-US", "cs-CZ"] as const satisfies readonly Locale[])(
    "links each rejected field to its own message in %s",
    async (locale) => {
      expect(
        await errorsOf(
          profileFormSchema(locale),
          values({
            firstName: "   ",
            lastName: "x".repeat(101),
            phone: "not a phone",
            companyName: "   ",
            country: "CZE",
          })
        )
      ).toEqual({
        firstName: m.accountProfileFirstNameRequired({}, { locale }),
        lastName: m.accountProfileValidationError({}, { locale }),
        phone: m.accountProfilePhoneInvalid({}, { locale }),
        companyName: m.accountProfileValidationError({}, { locale }),
        country: m.accountProfileValidationError({}, { locale }),
      });
    }
  );
});

describe("completionFormSchema", () => {
  test("adds an entered referral code and the prefill it came from", async () => {
    const result = await resolve(
      completionFormSchema("en-US", "FRIEND10"),
      values({ billingKind: "hidden", referralCode: " FRIEND10 " })
    );
    expect(result.values).toStrictEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+420601111222",
      referralCode: "FRIEND10",
      prefilledReferralCode: "FRIEND10",
    });
  });

  test("sends no referral fields when the code is blank", async () => {
    const result = await resolve(
      completionFormSchema("en-US", "FRIEND10"),
      values({ billingKind: "hidden", referralCode: "  " })
    );
    expect(result.values).toStrictEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+420601111222",
    });
  });

  test("sends a typed code without a prefill", async () => {
    const result = await resolve(
      completionFormSchema("en-US"),
      values({ billingKind: "hidden", referralCode: "TYPED" })
    );
    expect(result.values).toMatchObject({ referralCode: "TYPED" });
    expect(result.values).not.toHaveProperty("prefilledReferralCode");
  });

  test("leaves an over-long referral code to the server", async () => {
    const referralCode = "A".repeat(65);
    const result = await resolve(
      completionFormSchema("en-US", referralCode),
      values({ billingKind: "hidden", referralCode })
    );
    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({
      referralCode,
      prefilledReferralCode: referralCode,
    });
  });

  test("links profile errors to the form fields", async () => {
    expect(
      await errorsOf(
        completionFormSchema("en-US"),
        values({ firstName: "", companyName: "" })
      )
    ).toEqual({
      firstName: m.accountProfileFirstNameRequired({}, { locale: "en-US" }),
      companyName: m.accountProfileValidationError({}, { locale: "en-US" }),
    });
  });
});

describe("field index", () => {
  test.each(
    allFields.map((field) => [
      field,
      ["firstName", "lastName", "phone", "referralCode"].includes(field)
        ? "profile"
        : "billing",
    ])
  )("places %s in the %s section", (field, section) => {
    expect(profileFormSectionOf(field)).toBe(section);
  });

  test.each([
    [[], undefined],
    [["root"], undefined],
    [["companyName"], "billing"],
    [["billingKind"], "billing"],
    [["phone"], "profile"],
    [["companyName", "lastName"], "profile"],
    [["zip", "firstName", "billingKind"], "profile"],
  ] as const)("reveals the first invalid section of %p", (fields, section) => {
    expect(firstInvalidProfileFormSection(fields)).toBe(section);
  });

  test("maps every field to its input name and back", () => {
    for (const field of allFields) {
      expect(profileFormFieldOfInputName(profileFormInputName(field))).toBe(
        field
      );
    }
    for (const field of profileBillingFieldNames) {
      expect(profileFormInputName(field)).toBe(
        `billing${field.charAt(0).toUpperCase()}${field.slice(1)}`
      );
    }
    expect(profileFormFieldOfInputName("companyName")).toBeUndefined();
    expect(profileFormFieldOfInputName("")).toBeUndefined();
  });
});

describe("toProfileFormErrors", () => {
  const locale = "en-US";

  test("links each rejected billing field to its server error", () => {
    expect(
      toProfileFormErrors(
        {
          fieldErrors: {
            billing: profileBillingFieldNames.map((field, index) =>
              index % 2 === 0 ? `${field}: Server field error.` : field
            ),
          },
        },
        locale
      )
    ).toEqual({
      errors: Object.fromEntries(
        profileBillingFieldNames.map((field) => [
          field,
          m.accountProfileValidationError({}, { locale }),
        ])
      ),
      firstSection: "billing",
    });
  });

  test("puts a billing error that names no field on the billing kind", () => {
    expect(
      toProfileFormErrors({ fieldErrors: { billing: ["Invalid."] } }, locale)
    ).toEqual({
      errors: {
        billingKind: profileFormErrorMessage("billingKind", locale),
      },
      firstSection: "billing",
    });
  });

  test.each([
    ["firstName", false],
    ["lastName", false],
    ["lastName", true],
    ["phone", true],
  ] as const)(
    "reveals profile for a %s error (billing errors too: %p)",
    (field, withBillingErrors) => {
      const { errors, firstSection } = toProfileFormErrors(
        {
          fieldErrors: {
            [field]: ["Server field error."],
            ...(withBillingErrors && {
              billing: ["companyName: Company name is required."],
            }),
          },
        },
        locale
      );
      expect(firstSection).toBe("profile");
      expect(errors[field]).toBe(profileFormErrorMessage(field, locale));
      expect(errors.companyName).toBe(
        withBillingErrors
          ? m.accountProfileValidationError({}, { locale })
          : undefined
      );
    }
  );

  test("gives each profile field its own message", () => {
    expect(
      toProfileFormErrors(
        {
          fieldErrors: {
            firstName: ["Required."],
            lastName: ["Too long."],
            phone: ["Invalid phone number"],
            referralCode: ["Too long."],
          },
        },
        locale
      ).errors
    ).toEqual({
      firstName: m.accountProfileFirstNameRequired({}, { locale }),
      lastName: m.accountProfileValidationError({}, { locale }),
      phone: m.accountProfilePhoneInvalid({}, { locale }),
      referralCode: m.accountProfileReferralCodeUnavailable({}, { locale }),
    });
  });

  test("ignores empty and unknown field errors", () => {
    expect(
      toProfileFormErrors(
        {
          fieldErrors: {
            firstName: [],
            prefilledReferralCode: ["Too long."],
          },
        },
        locale
      )
    ).toEqual({ errors: {} });
  });
});
