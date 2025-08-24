import { isValidPhoneNumber, parsePhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import { m } from "@/i18n";

// Constants for workspace reservation validation
export const workspaceConstants = {
  validation: {
    name: {
      min: 2,
      max: 50,
    },
    email: {
      max: 100,
    },
    phone: {
      min: 9,
      max: 20,
    },
    duration: {
      min: 1, // 1 hour minimum
      max: 8, // 8 hours maximum
    },
    specialRequirements: {
      max: 500,
    },
  },
  defaultValues: {
    name: "",
    email: "",
    phone: "",
    date: undefined as Date | undefined,
    time: "",
    duration: 1,
    specialRequirements: "",
  },
};

// Individual schema definitions for better composability (Zod v4 pattern)

// User information schemas
const nameSchema = z
  .string({
    error: m["trainingReservation.validation.nameRequired"](),
  })
  .min(workspaceConstants.validation.name.min, {
    error: m["trainingReservation.validation.nameMin"]({
      min: workspaceConstants.validation.name.min.toString(),
    }),
  })
  .max(workspaceConstants.validation.name.max, {
    error: m["trainingReservation.validation.nameMax"]({
      max: workspaceConstants.validation.name.max.toString(),
    }),
  });

const emailSchema = z
  .email({ error: m["trainingReservation.validation.emailInvalid"]() })
  .max(workspaceConstants.validation.email.max, {
    error: m["trainingReservation.validation.emailMax"]({
      max: workspaceConstants.validation.email.max.toString(),
    }),
  });

const phoneSchema = z
  .string({
    error: m["trainingReservation.validation.phoneRequired"](),
  })
  .min(1, {
    error: m["trainingReservation.validation.phoneRequired"](),
  })
  .refine((phone) => isValidPhoneNumber(phone, "CZ"), {
    error: m["trainingReservation.validation.phoneInvalid"](),
  })
  .transform((phone) => {
    // Parse and format the phone number to E.164 format
    // This ensures consistent storage format regardless of input format
    const phoneNumber = parsePhoneNumber(phone, "CZ");
    return phoneNumber.format("E.164"); // Returns format like "+420123456789"
  });

// Reservation detail schemas
const dateSchema = z.date({
  error: m["trainingReservation.validation.dateRequired"](),
});

const timeSchema = z.string({
  error: m["trainingReservation.validation.timeRequired"](),
});

const durationSchema = z
  .number({
    error: m["trainingReservation.validation.durationMin"]({
      min: workspaceConstants.validation.duration.min.toString(),
    }),
  })
  .min(workspaceConstants.validation.duration.min, {
    error: m["trainingReservation.validation.durationMin"]({
      min: workspaceConstants.validation.duration.min.toString(),
    }),
  })
  .max(workspaceConstants.validation.duration.max, {
    error: m["trainingReservation.validation.durationMax"]({
      max: workspaceConstants.validation.duration.max.toString(),
    }),
  });

// Additional information schema
const specialRequirementsSchema = z
  .string()
  .max(workspaceConstants.validation.specialRequirements.max, {
    error: m["trainingReservation.validation.specialRequirementsMax"]({
      max: workspaceConstants.validation.specialRequirements.max.toString(),
    }),
  })
  .optional();

// Main reservation schema using Zod v4's composable pattern
export const reservationSchema = z.object({
  // User information
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,

  // Reservation details
  date: dateSchema,
  time: timeSchema,
  duration: durationSchema,

  // Additional information
  specialRequirements: specialRequirementsSchema,
});

export type ReservationFormData = z.infer<typeof reservationSchema>;
