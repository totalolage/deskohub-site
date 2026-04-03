import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import { m } from "@/features/i18n";

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

export const getContactSchema = () =>
  z.object({
    name: z
      .string()
      .trim()
      .min(CONTACT_VALIDATION.name.min, {
        error: m.contactValidationNameMinimum({
          min: CONTACT_VALIDATION.name.min,
        }),
      })
      .max(CONTACT_VALIDATION.name.max, {
        error: m.contactValidationNameMaximum({
          max: CONTACT_VALIDATION.name.max,
        }),
      }),
    email: z
      .email({ error: m.contactValidationEmailInvalid() })
      .min(1, { error: m.contactValidationEmailRequired() })
      .max(CONTACT_VALIDATION.email.max, {
        error: m.contactValidationEmailMaximum({
          max: CONTACT_VALIDATION.email.max,
        }),
      }),
    phone: z
      .string()
      .trim()
      .max(CONTACT_VALIDATION.phone.max, {
        error: m.contactValidationPhoneMaximum({
          max: CONTACT_VALIDATION.phone.max,
        }),
      })
      .optional()
      .or(z.literal(""))
      .refine((phone) => !phone || isValidPhoneNumber(phone, "CZ"), {
        error: m.contactValidationPhoneInvalid(),
      }),
    message: z
      .string()
      .trim()
      .min(CONTACT_VALIDATION.message.min, {
        error: m.contactValidationMessageMinimum({
          min: CONTACT_VALIDATION.message.min,
        }),
      })
      .max(CONTACT_VALIDATION.message.max, {
        error: m.contactValidationMessageMaximum({
          max: CONTACT_VALIDATION.message.max,
        }),
      }),
  });

export type ContactInput = z.input<ReturnType<typeof getContactSchema>>;
export type ContactData = z.output<ReturnType<typeof getContactSchema>>;

export const contactDefaultValues: ContactInput = {
  name: "",
  email: "",
  phone: "",
  message: "",
};
