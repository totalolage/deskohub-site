import { z } from "zod";

// Create a custom error map for better user-friendly messages
// This will be improved in the next subtask to use actual Paraglide messages
const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.expected === "string" && issue.received === "undefined") {
        return { message: "This field is required" };
      }
      return { message: "This field is required" };
    case z.ZodIssueCode.too_small:
      if (issue.type === "string") {
        return { message: "This field is required" };
      }
      if (issue.type === "number") {
        return { message: "This field is required" };
      }
      return { message: "This field is required" };
    case z.ZodIssueCode.too_big:
      return { message: "This field is too long" };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") {
        return { message: "Please enter a valid email address" };
      }
      return { message: "Please enter a valid value" };
    default:
      return { message: ctx.defaultError };
  }
};

// Set the custom error map
z.setErrorMap(customErrorMap);

// Export configured zod instance
export { z };
