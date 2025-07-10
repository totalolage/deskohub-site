import { z } from "zod";

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

export const reservationSchema = z.object({
  // User information
  name: z
    .string()
    .min(workspaceConstants.validation.name.min, {
      message: `Name must be at least ${workspaceConstants.validation.name.min} characters`,
    })
    .max(workspaceConstants.validation.name.max, {
      message: `Name must be at most ${workspaceConstants.validation.name.max} characters`,
    }),

  email: z
    .string()
    .email({ message: "Please enter a valid email address" })
    .max(workspaceConstants.validation.email.max, {
      message: `Email must be at most ${workspaceConstants.validation.email.max} characters`,
    }),

  phone: z.string().regex(/^\+?[0-9]{9,15}$/, {
    message: "Please enter a valid phone number",
  }),

  // Reservation details
  date: z.date({
    required_error: "Please select a date",
  }),

  time: z.string({
    required_error: "Please select a time",
  }),

  duration: z
    .number()
    .min(workspaceConstants.validation.duration.min, {
      message: `Duration must be at least ${workspaceConstants.validation.duration.min} hour`,
    })
    .max(workspaceConstants.validation.duration.max, {
      message: `Duration must be at most ${workspaceConstants.validation.duration.max} hours`,
    }),

  spaceType: z.enum(workspaceConstants.spaceTypes, {
    required_error: "Please select a desk/space type",
  }),

  // Additional information
  specialRequirements: z
    .string()
    .max(workspaceConstants.validation.specialRequirements.max, {
      message: `Special requirements must be at most ${workspaceConstants.validation.specialRequirements.max} characters`,
    })
    .optional(),
});

export type ReservationFormData = z.infer<typeof reservationSchema>;
