"use server";

import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer } from "effect";
import { z } from "zod/v4";
import {
  type ContactFormState,
  type ContactFormValues,
  processContactSubmission,
} from "@/features/contact/actions/contact";
import { ContactServiceLive } from "@/features/contact/backend/contact.service";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";

const getSubmittedString = (
  formData: FormData,
  name: keyof ContactFormValues
) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const contactFormDataSchema = z.instanceof(FormData).transform(
  (formData): ContactFormValues => ({
    name: getSubmittedString(formData, "name"),
    email: getSubmittedString(formData, "email"),
    phone: getSubmittedString(formData, "phone"),
    message: getSubmittedString(formData, "message"),
  })
);

const ContactActionLive = ContactServiceLive.pipe(
  Layer.provide(
    StandaloneEmailServiceLayer.pipe(Layer.provideMerge(EmailConfigLayer))
  ),
  Layer.merge(BotProtectionService.Live)
);

const submitContactAction = WorkspaceEffect.action(
  {
    operation: "contact.submit",
    schema: contactFormDataSchema,
    stateful: true,
    layer: ContactActionLive,
  },
  ({ ctx, parsedInput }) =>
    processContactSubmission({
      locale: ctx.locale,
      submittedValues: parsedInput,
    }).pipe(Effect.map((state): ContactFormState => state))
);

export const submitContactForm: typeof submitContactAction = async (...args) =>
  await submitContactAction(...args);
