import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import { m } from "@/features/i18n";

// Constants for contact form validation
const CONTACT_VALIDATION = {
  name: {
    min: 2,
    max: 100,
  },
  email: {
    max: 255,
  },
  phone: {
    min: 9,
    max: 20,
  },
  message: {
    min: 10,
    max: 1000,
  },
} as const;

// Contact form schema using Zod v4
export const getContactSchema = () => {
  // Name schema with regex validation for valid names
  const nameSchema = z
    .string()
    .min(CONTACT_VALIDATION.name.min, {
      error: m["tableReservation.validation.name.minimum"]({
        min: CONTACT_VALIDATION.name.min,
      }),
    })
    .max(CONTACT_VALIDATION.name.max, {
      error: m["tableReservation.validation.name.maximum"]({
        max: CONTACT_VALIDATION.name.max,
      }),
    });
  // Email schema using Zod v4's improved email validation
  const emailSchema = z
    .email({ error: m["tableReservation.validation.email.invalid"]() })
    .min(1, { error: m["tableReservation.validation.email.required"]() })
    .max(CONTACT_VALIDATION.email.max, {
      error: m["tableReservation.validation.email.maximum"]({
        max: CONTACT_VALIDATION.email.max,
      }),
    });

  // Phone schema - optional but validated if provided
  const phoneSchema = z
    .string()
    .optional()
    .refine((phone) => !phone?.trim() || isValidPhoneNumber(phone, "CZ"), {
      error: m["tableReservation.validation.phone.invalid"](),
    });

  // Message schema
  const messageSchema = z
    .string()
    .min(CONTACT_VALIDATION.message.min, {
      error: m["contact.validation.message.minimum"]({
        min: CONTACT_VALIDATION.message.min,
      }),
    })
    .max(CONTACT_VALIDATION.message.max, {
      error: m["contact.validation.message.maximum"]({
        max: CONTACT_VALIDATION.message.max,
      }),
    });

  return z.object({
    name: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
    message: messageSchema,
  });
};

export type ContactFormData = z.input<ReturnType<typeof getContactSchema>>;
export type ContactData = z.output<ReturnType<typeof getContactSchema>>;

// Default values for the contact form
export const contactDefaultValues: ContactFormData = {
  name: "",
  email: "",
  phone: "",
  message: "",
};
