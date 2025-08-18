"use server";

import { Effect } from "effect";
import {
  ContactService,
  ContactServiceLive,
} from "@/features/contact/backend/contact.service";
import { getContactSchema } from "@/features/contact/schemas/contact";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

// Single server action that handles contact form submission
const _submitContactForm = createEffectSafeAction(
  getContactSchema(),
  (input, { locale }) =>
    Effect.gen(function* () {
      const service = yield* ContactService;
      const submission = yield* service.submit(input);

      yield* Effect.logInfo(
        `Contact form submitted: ${submission.submittedAt} for locale: ${locale}`
      );

      return {
        message: "Contact form submitted successfully",
        submissionId: submission.submittedAt,
      };
    }).pipe(
      Effect.withSpan("submitContactForm", {
        attributes: {
          locale,
          input,
        },
      })
    ),
  ContactServiceLive
);

// Export an explicitly async wrapper that Next.js will recognize
export const submitContactForm = async (
  ...args: Parameters<typeof _submitContactForm>
) => {
  "use server";
  return await _submitContactForm(...args);
};
