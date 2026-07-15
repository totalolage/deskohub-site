"use server";

import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer } from "effect";
import { z } from "zod/v4";
import {
  ContactService,
  ContactServiceLive,
} from "@/features/contact/backend/contact.service";
import { getContactSchema } from "@/features/contact/schemas/contact";
import { getLocale, type Locale, m } from "@/features/i18n";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { runWorkspaceServerAction } from "@/shared/backend/logging/server-action";

export type ContactFormValues = {
  name: string;
  email: string;
  phone: string;
  message: string;
};

export type ContactFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "phone" | "message", string>>;
  values?: ContactFormValues;
};

function getSubmittedContactValues(formData: FormData): ContactFormValues {
  return {
    name: getSubmittedString(formData, "name"),
    email: getSubmittedString(formData, "email"),
    phone: getSubmittedString(formData, "phone"),
    message: getSubmittedString(formData, "message"),
  };
}

function getSubmittedString(formData: FormData, name: keyof ContactFormValues) {
  const value = formData.get(name);

  if (typeof value !== "string") {
    return "";
  }

  return value;
}

interface SubmitContactFormInput {
  readonly locale: Locale;
  readonly submittedValues: ContactFormValues;
}

export const submitContactFormProgram = Effect.fn("submitContactForm")(
  function* ({ locale, submittedValues }: SubmitContactFormInput) {
    const botProtection = yield* BotProtectionService;
    yield* botProtection.verifyHuman({ verificationFailurePolicy: "deny" });

    yield* Effect.annotateLogsScoped({ submittedValues, locale });
    yield* Effect.logInfo("Workspace contact form action received");

    const parsedInput = getContactSchema().safeParse(submittedValues);
    yield* Effect.annotateLogsScoped({ parsedInput });

    if (!parsedInput.success) {
      const flattened = z.flattenError(parsedInput.error).fieldErrors;
      yield* Effect.logWarning("Workspace contact form validation failed", {
        flattened,
      });

      return {
        status: "error" as const,
        message: m.contactValidationReviewMessage({}, { locale }),
        values: submittedValues,
        fieldErrors: {
          name: flattened.name?.[0],
          email: flattened.email?.[0],
          phone: flattened.phone?.[0],
          message: flattened.message?.[0],
        },
      };
    }

    yield* Effect.logInfo("Workspace contact form validation passed");

    const service = yield* ContactService;
    yield* service.submit(parsedInput.data, locale);
    yield* Effect.logInfo("Workspace contact form submit completed");

    return {
      status: "success" as const,
      message: m.contactSuccessMessage({}, { locale }),
    };
  },
  (effect, { locale, submittedValues }) =>
    effect.pipe(
      Effect.scoped,
      Effect.catchTag("BotDetectedError", (error) =>
        Effect.logWarning("Workspace contact form bot rejected", {
          error,
        }).pipe(
          Effect.as({
            status: "error" as const,
            message: m.contactRateLimitMessage({}, { locale }),
            values: submittedValues,
          })
        )
      ),
      Effect.catch((error) =>
        Effect.logError("Workspace contact form submission failed", {
          error,
          submittedValues,
        }).pipe(
          Effect.as({
            status: "error" as const,
            message: m.contactEmailSendError({}, { locale }),
            values: submittedValues,
          })
        )
      )
    )
);

export async function submitContactForm(
  _previousState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const locale = getLocale();
  const submittedValues = getSubmittedContactValues(formData);

  const program = submitContactFormProgram({ locale, submittedValues }).pipe(
    Effect.provide(
      Layer.merge(
        Layer.provideMerge(
          ContactServiceLive,
          Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer)
        ),
        BotProtectionService.Live
      )
    )
  );

  return await runWorkspaceServerAction(program);
}
