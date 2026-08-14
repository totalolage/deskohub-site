"use server";

import { Effect, Layer } from "effect";
import { ContactService } from "@/features/contact/backend/contact.service";
import { getContactSchema } from "@/features/contact/schemas/contact";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

// Single server action that handles contact form submission
const _submitContactForm = createEffectSafeAction(
  getContactSchema(),
  (input, { locale }) =>
    Effect.gen(function* () {
      yield* Effect.annotateLogsScoped({ input, locale });
      yield* Effect.logInfo("Contact form action started");

      const service = yield* ContactService;
      const submission = yield* service.submit(input, locale).pipe(
        Effect.tapError((error) =>
          Effect.logError("Contact form action service submit failed", {
            error,
            input,
            locale,
          })
        )
      );
      yield* Effect.annotateLogsScoped({ submission });

      yield* Effect.logInfo(
        `Contact form submitted: ${submission.submittedAt} for locale: ${locale}`
      );

      const result = {
        message: "Contact form submitted successfully",
        submissionId: submission.submittedAt,
      };
      yield* Effect.annotateLogsScoped({ result });
      yield* Effect.logDebug("Contact form action completed");

      return result;
    }).pipe(
      Effect.scoped,
      Effect.tapError((error) =>
        Effect.logError("Contact form action failed", { error, input, locale })
      ),
      Effect.withSpan("submitContactForm", {
        attributes: {
          locale,
          input,
        },
      })
    ),
  ContactService.Live.pipe(Layer.orDie)
);

// Export an explicitly async wrapper that Next.js will recognize
export const submitContactForm = async (
  ...args: Parameters<typeof _submitContactForm>
) => {
  "use server";
  return await _submitContactForm(...args);
};
