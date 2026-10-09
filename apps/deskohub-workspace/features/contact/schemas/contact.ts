import { Schema } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
import isEmail from "validator/lib/isEmail.js";
import { type Locale, m } from "@/features/i18n";

const CONTACT_VALIDATION = {
  name: {
    min: 2,
    max: 100,
  },
  email: {
    max: 255,
  },
  phone: {
    max: 20,
  },
  message: {
    min: 10,
    max: 1000,
  },
} as const;

const createContactSchema = (locale: Locale) =>
  Schema.Struct({
    name: Schema.Trim.check(
      Schema.isMinLength(CONTACT_VALIDATION.name.min, {
        message: m.contactValidationNameMinimum(
          { min: CONTACT_VALIDATION.name.min },
          { locale }
        ),
      }),
      Schema.isMaxLength(CONTACT_VALIDATION.name.max, {
        message: m.contactValidationNameMaximum(
          { max: CONTACT_VALIDATION.name.max },
          { locale }
        ),
      })
    ),
    email: Schema.Trim.check(
      Schema.isNonEmpty({
        message: m.contactValidationEmailRequired({}, { locale }),
      }),
      Schema.isMaxLength(CONTACT_VALIDATION.email.max, {
        message: m.contactValidationEmailMaximum(
          { max: CONTACT_VALIDATION.email.max },
          { locale }
        ),
      }),
      Schema.makeFilter((email) => isEmail(email), {
        message: m.contactValidationEmailInvalid({}, { locale }),
      })
    ),
    phone: Schema.Trim.check(
      Schema.isMaxLength(CONTACT_VALIDATION.phone.max, {
        message: m.contactValidationPhoneMaximum(
          { max: CONTACT_VALIDATION.phone.max },
          { locale }
        ),
      }),
      Schema.makeFilter(
        (phone) => phone === "" || isValidPhoneNumber(phone, "CZ"),
        {
          message: m.contactValidationPhoneInvalid({}, { locale }),
        }
      )
    ),
    message: Schema.Trim.check(
      Schema.isMinLength(CONTACT_VALIDATION.message.min, {
        message: m.contactValidationMessageMinimum(
          { min: CONTACT_VALIDATION.message.min },
          { locale }
        ),
      }),
      Schema.isMaxLength(CONTACT_VALIDATION.message.max, {
        message: m.contactValidationMessageMaximum(
          { max: CONTACT_VALIDATION.message.max },
          { locale }
        ),
      })
    ),
  });

type ContactSchema = ReturnType<typeof createContactSchema>;

export const getContactSchema = createContactSchema;

export type ContactFormValues = ContactSchema["Encoded"];
export type ContactData = ContactSchema["Type"];

export const contactDefaultValues: ContactFormValues = {
  name: "",
  email: "",
  phone: "",
  message: "",
};
