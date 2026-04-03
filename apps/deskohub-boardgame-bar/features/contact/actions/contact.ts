"use server";

import { StandaloneEmailServiceLayer } from "@deskohub/email";
import { Effect, Layer } from "effect";
import {
  ContactService,
  ContactServiceLive,
} from "@/features/contact/backend/contact.service";
import { getContactSchema } from "@/features/contact/schemas/contact";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

// Single server action that handles contact form submission
const _submitContactForm = createEffectSafeAction(
  getContactSchema(),
  (input, { locale }) =>
    Effect.gen(function* () {
      const service = yield* ContactService;
      const submission = yield* service.submit(input, locale);

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
  // Provide ContactServiceLive with its email service dependency
  ContactServiceLive.pipe(
    Layer.provide(
      StandaloneEmailServiceLayer.pipe(Layer.provide(EmailConfigLayer))
    ),
    Layer.orDie
  )
);

// Export an explicitly async wrapper that Next.js will recognize
export const submitContactForm = async (
  ...args: Parameters<typeof _submitContactForm>
) => {
  "use server";
  return await _submitContactForm(...args);
};
