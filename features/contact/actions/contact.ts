"use server";

import { Effect, pipe } from "effect";
import {
  ContactService,
  ContactServiceLive,
} from "@/features/contact/backend/contact.service";
import { ContactFormSchema } from "@/features/contact/schemas/contact-effect";
import { createEffectAction } from "@/shared/backend/utils/effect-action";
import { effectActionClient } from "@/shared/backend/utils/effect-safe-action";

// Create the Effect-based contact action
const _submitContactEffect = createEffectAction(
  ContactFormSchema,
  (validatedInput) =>
    pipe(
      ContactService,
      Effect.flatMap((service) => service.submit(validatedInput)),
      Effect.map((submission) => ({
        success: true as const,
        data: {
          message: "Contact form submitted successfully",
          submissionId: submission.submittedAt,
        },
      })),
      Effect.provide(ContactServiceLive)
    )
);

// Server action
export const submitContactForm = async (input: unknown) => {
  return _submitContactEffect(input);
};

// Create the safe action wrapper for Next.js compatibility
export const submitContactFormWithEffect = effectActionClient({
  handler: submitContactForm,
});
