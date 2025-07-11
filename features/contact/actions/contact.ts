"use server";

import { getContactSchema } from "@/features/contact/schemas/contact";
import { actionClient } from "@/shared/utils/safe-action-client";

export const submitContactForm = actionClient
  .inputSchema(getContactSchema())
  .action(async ({ parsedInput }) => {
    // Log the contact form submission for now
    // In production, this would send an email or save to a database
    console.log("Contact form submission:", {
      ...parsedInput,
      submittedAt: new Date().toISOString(),
    });

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Return success response
    return {
      success: true,
      message: "Contact form submitted successfully",
    };
  });
