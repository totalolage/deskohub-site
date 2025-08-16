import { Schema } from "@effect/schema";
import { m } from "@/i18n";

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

// Create custom email schema with proper validation
const Email = Schema.String.pipe(
  Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: () => m["booking.validation.email.invalid"](),
  }),
  Schema.minLength(1, {
    message: () => m["booking.validation.email.required"](),
  }),
  Schema.maxLength(CONTACT_VALIDATION.email.max, {
    message: () =>
      m["booking.validation.email.maximum"]({
        max: CONTACT_VALIDATION.email.max,
      }),
  })
);

// Create phone schema
const Phone = Schema.String.pipe(
  Schema.minLength(CONTACT_VALIDATION.phone.min, {
    message: () =>
      m["booking.validation.phone.minimum"]({
        min: CONTACT_VALIDATION.phone.min,
      }),
  }),
  Schema.maxLength(CONTACT_VALIDATION.phone.max, {
    message: () =>
      m["booking.validation.phone.maximum"]({
        max: CONTACT_VALIDATION.phone.max,
      }),
  }),
  Schema.pattern(/^[+]?[0-9\s\-()]+$/, {
    message: () => m["booking.validation.phone.invalid"](),
  })
);

// Contact form schema using Effect Schema
export const ContactFormSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(CONTACT_VALIDATION.name.min, {
      message: () =>
        m["booking.validation.name.minimum"]({
          min: CONTACT_VALIDATION.name.min,
        }),
    }),
    Schema.maxLength(CONTACT_VALIDATION.name.max, {
      message: () =>
        m["booking.validation.name.maximum"]({
          max: CONTACT_VALIDATION.name.max,
        }),
    })
  ),
  email: Email,
  phone: Schema.optional(Phone),
  message: Schema.String.pipe(
    Schema.minLength(CONTACT_VALIDATION.message.min, {
      message: () =>
        m["booking.validation.specialRequests.maximum"]({
          max: CONTACT_VALIDATION.message.min,
        }),
    }),
    Schema.maxLength(CONTACT_VALIDATION.message.max, {
      message: () =>
        m["booking.validation.specialRequests.maximum"]({
          max: CONTACT_VALIDATION.message.max,
        }),
    })
  ),
});

export type ContactFormData = Schema.Schema.Type<typeof ContactFormSchema>;
