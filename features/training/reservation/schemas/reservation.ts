import { z } from "zod/v4";

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
  spaceTypes: [
    "standard",
    "premium",
    "meeting_small",
    "meeting_large",
    "private_office",
  ] as const,
  defaultValues: {
    name: "",
    email: "",
    phone: "",
    date: undefined as Date | undefined,
    time: "",
    duration: 1,
    spaceType: "standard" as const,
    specialRequirements: "",
  },
};

// Individual schema definitions for better composability (Zod v4 pattern)

// User information schemas
const nameSchema = z
  .string({
    error: `Name must be at least ${workspaceConstants.validation.name.min} characters`,
  })
  .min(workspaceConstants.validation.name.min, {
    error: `Name must be at least ${workspaceConstants.validation.name.min} characters`,
  })
  .max(workspaceConstants.validation.name.max, {
    error: `Name must be at most ${workspaceConstants.validation.name.max} characters`,
  });

const emailSchema = z
  .string({
    error: "Please enter a valid email address",
  })
  .email({ error: "Please enter a valid email address" })
  .max(workspaceConstants.validation.email.max, {
    error: `Email must be at most ${workspaceConstants.validation.email.max} characters`,
  });

const phoneSchema = z
  .string({
    error: "Please enter a valid phone number",
  })
  .regex(/^\+?[0-9]{9,15}$/, {
    error: "Please enter a valid phone number",
  });

// Reservation detail schemas
const dateSchema = z.date({
  error: "Please select a date",
});

const timeSchema = z.string({
  error: "Please select a time",
});

const durationSchema = z
  .number({
    error: `Duration must be at least ${workspaceConstants.validation.duration.min} hour`,
  })
  .min(workspaceConstants.validation.duration.min, {
    error: `Duration must be at least ${workspaceConstants.validation.duration.min} hour`,
  })
  .max(workspaceConstants.validation.duration.max, {
    error: `Duration must be at most ${workspaceConstants.validation.duration.max} hours`,
  });

const spaceTypeSchema = z.enum(workspaceConstants.spaceTypes, {
  error: "Please select a desk/space type",
});

// Additional information schema
const specialRequirementsSchema = z
  .string()
  .max(workspaceConstants.validation.specialRequirements.max, {
    error: `Special requirements must be at most ${workspaceConstants.validation.specialRequirements.max} characters`,
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
  spaceType: spaceTypeSchema,

  // Additional information
  specialRequirements: specialRequirementsSchema,
});

export type ReservationFormData = z.infer<typeof reservationSchema>;
