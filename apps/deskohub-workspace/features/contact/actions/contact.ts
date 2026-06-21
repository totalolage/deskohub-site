"use server";

import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer } from "effect";
import { z } from "zod/v4";
import {
  ContactService,
  ContactServiceLive,
} from "@/features/contact/backend/contact.service";
import { getContactSchema } from "@/features/contact/schemas/contact";
import { getLocale, m } from "@/features/i18n";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { runWorkspaceServerActionEffect } from "@/shared/backend/logging/server-action";

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

export async function submitContactForm(
  _previousState: ContactFormState,
  formData: FormData
): Promise<ContactFormState> {
  const locale = getLocale();
  const submittedValues = getSubmittedContactValues(formData);

  const program = Effect.gen(function* () {
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
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.provideMerge(
        ContactServiceLive,
        Layer.provideMerge(StandaloneEmailServiceLayer, EmailConfigLayer)
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
  );

  return await runWorkspaceServerActionEffect(program);
}
