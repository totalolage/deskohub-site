import { isValidPhoneNumber, parsePhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import { m } from "@/features/i18n";

// Constants for workspace reservation validation
export const workspaceConstants = {
  validation: {
    name: {
      min: 2,
      max: 50,
    },
    company: {
      min: 2,
      max: 100,
    },
    role: {
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
    firstName: "",
    lastName: "",
    company: "",
    role: "",
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
const firstNameSchema = z
  .string()
  .min(0) // Allow empty
  .max(workspaceConstants.validation.name.max, {
    error: m["trainingReservation.validation.firstNameMax"]({
      max: workspaceConstants.validation.name.max.toString(),
    }),
  });

const lastNameSchema = z
  .string()
  .min(0) // Allow empty
  .max(workspaceConstants.validation.name.max, {
    error: m["trainingReservation.validation.lastNameMax"]({
      max: workspaceConstants.validation.name.max.toString(),
    }),
  });

const companySchema = z
  .string()
  .min(0) // Allow empty
  .max(workspaceConstants.validation.company.max, {
    error: m["trainingReservation.validation.companyMax"]({
      max: workspaceConstants.validation.company.max.toString(),
    }),
  });

const roleSchema = z
  .string()
  .min(0) // Allow empty
  .max(workspaceConstants.validation.role.max, {
    error: m["trainingReservation.validation.roleMax"]({
      max: workspaceConstants.validation.role.max.toString(),
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

const timeSchema = z
  .string({
    error: m["trainingReservation.validation.timeRequired"](),
  })
  .min(1, {
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

// Main reservation schema using Zod v4's composable pattern with complex validation
export const reservationSchema = z
  .object({
    // User information
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    company: companySchema,
    role: roleSchema,
    email: emailSchema,
    phone: phoneSchema,

    // Reservation details
    date: dateSchema,
    time: timeSchema,
    duration: durationSchema,

    // Additional information
    specialRequirements: specialRequirementsSchema,
  })
  .refine(
    (data) => {
      const hasCompany = data.company.trim().length > 0;
      const hasFirstName = data.firstName.trim().length > 0;
      const hasLastName = data.lastName.trim().length > 0;

      // If company is filled, we don't need to check name fields
      if (hasCompany) {
        return true;
      }

      // At least some identification is required
      if (!hasFirstName && !hasLastName && !hasCompany) {
        return false;
      }

      return true;
    },
    {
      message: m["trainingReservation.validation.companyOrNameRequired"](),
      path: ["root"],
    }
  )
  .refine(
    (data) => {
      const _hasCompany = data.company.trim().length > 0;
      const hasFirstName = data.firstName.trim().length > 0;
      const hasLastName = data.lastName.trim().length > 0;

      // If firstName is filled, lastName must also be filled
      // This applies regardless of whether company is filled
      if (hasFirstName && !hasLastName) {
        return false;
      }

      return true;
    },
    {
      message: m["trainingReservation.validation.lastNameRequired"](),
      path: ["lastName"],
    }
  )
  .refine(
    (data) => {
      const _hasCompany = data.company.trim().length > 0;
      const hasFirstName = data.firstName.trim().length > 0;
      const hasLastName = data.lastName.trim().length > 0;

      // If lastName is filled, firstName must also be filled
      // This applies regardless of whether company is filled
      if (hasLastName && !hasFirstName) {
        return false;
      }

      return true;
    },
    {
      message: m["trainingReservation.validation.firstNameRequired"](),
      path: ["firstName"],
    }
  )
  .refine(
    (data) => {
      // If BOTH company AND (firstName + lastName) are filled, then role is mandatory
      const hasCompany = data.company.trim().length > 0;
      const hasFullName =
        data.firstName.trim().length > 0 && data.lastName.trim().length > 0;
      const hasRole = data.role.trim().length > 0;

      // If both company and name are filled, role must be filled
      if (hasCompany && hasFullName) {
        return hasRole;
      }
      return true; // No validation error if condition is not met
    },
    {
      message: m["trainingReservation.validation.roleRequiredWhenBothFilled"](),
      path: ["role"], // Show error on role field
    }
  )
  .refine(
    (data) => {
      // Additional validation for firstName and lastName minimum length if they're provided
      if (data.firstName.trim().length > 0) {
        return (
          data.firstName.trim().length >= workspaceConstants.validation.name.min
        );
      }
      return true;
    },
    {
      message: m["trainingReservation.validation.firstNameMin"]({
        min: workspaceConstants.validation.name.min.toString(),
      }),
      path: ["firstName"],
    }
  )
  .refine(
    (data) => {
      // Additional validation for lastName minimum length if it's provided
      if (data.lastName.trim().length > 0) {
        return (
          data.lastName.trim().length >= workspaceConstants.validation.name.min
        );
      }
      return true;
    },
    {
      message: m["trainingReservation.validation.lastNameMin"]({
        min: workspaceConstants.validation.name.min.toString(),
      }),
      path: ["lastName"],
    }
  )
  .refine(
    (data) => {
      // Additional validation for company minimum length if it's provided
      if (data.company.trim().length > 0) {
        return (
          data.company.trim().length >=
          workspaceConstants.validation.company.min
        );
      }
      return true;
    },
    {
      message: m["trainingReservation.validation.companyMin"]({
        min: workspaceConstants.validation.company.min.toString(),
      }),
      path: ["company"],
    }
  )
  .refine(
    (data) => {
      // Additional validation for role minimum length if it's provided
      if (data.role.trim().length > 0) {
        return (
          data.role.trim().length >= workspaceConstants.validation.role.min
        );
      }
      return true;
    },
    {
      message: m["trainingReservation.validation.roleMin"]({
        min: workspaceConstants.validation.role.min.toString(),
      }),
      path: ["role"],
    }
  );

export type ReservationFormData = z.infer<typeof reservationSchema>;
