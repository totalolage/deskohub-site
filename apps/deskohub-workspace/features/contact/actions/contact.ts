"use server";

import { Effect } from "effect";
import { z } from "zod/v4";
import {
  ContactActionLive,
  type ContactFormState,
  type ContactFormValues,
  processContactSubmission,
} from "@/features/contact/actions/contact-workflow";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";

const contactFormDataSchema = z.instanceof(FormData).transform(
  (formData): ContactFormValues => ({
    name: getSubmittedString(formData, "name"),
    email: getSubmittedString(formData, "email"),
    phone: getSubmittedString(formData, "phone"),
    message: getSubmittedString(formData, "message"),
  })
);

const getSubmittedString = (
  formData: FormData,
  name: keyof ContactFormValues
) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

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

export const submitContactForm: typeof submitContactAction = async (
  ...args
) => {
  return await submitContactAction(...args);
};
