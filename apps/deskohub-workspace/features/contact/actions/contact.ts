"use server";

import { EmailServiceLive } from "@deskohub/email/backend/service";
import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer } from "effect";
import {
  ContactService,
  ContactServiceLive,
} from "@/features/contact/backend/contact.service";
import { getContactSchema } from "@/features/contact/schemas/contact";
import { getLocale, m } from "@/features/i18n";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";

export type ContactFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "phone" | "message", string>>;
};

export async function submitContactForm(
  _previousState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const locale = getLocale();

  const parsedInput = getContactSchema().safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    message: formData.get("message"),
  });

  if (!parsedInput.success) {
    const flattened = parsedInput.error.flatten().fieldErrors;

    return {
      status: "error",
      message: m.contactValidationReviewMessage({}, { locale }),
      fieldErrors: {
        name: flattened.name?.[0],
        email: flattened.email?.[0],
        phone: flattened.phone?.[0],
        message: flattened.message?.[0],
      },
    };
  }

  const program = Effect.gen(function* () {
    const service = yield* ContactService;
    yield* service.submit(parsedInput.data, locale);

    return {
      status: "success" as const,
      message: m.contactSuccessMessage({}, { locale }),
    };
  }).pipe(
    Effect.provide(
      Layer.provideMerge(
        ContactServiceLive,
        Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer)
      )
    ),
    Effect.catchAll((error) =>
      Effect.succeed({
        status: "error" as const,
        message: error.message,
      })
    )
  );

  return await Effect.runPromise(program);
}
