"use server";

import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer } from "effect";
import {
  ContactService,
  ContactServiceLive,
} from "@/features/contact/backend/contact.service";
import { getContactSchema } from "@/features/contact/schemas/contact";
import { getLocale, m } from "@/features/i18n";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";

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

  const parsedInput = getContactSchema().safeParse(submittedValues);

  if (!parsedInput.success) {
    const flattened = parsedInput.error.flatten().fieldErrors;

    return {
      status: "error",
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
        values: submittedValues,
      })
    )
  );

  return await runWorkspaceEffect(program);
}
