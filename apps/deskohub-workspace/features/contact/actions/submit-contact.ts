"use server";

import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer, Schema, SchemaGetter, SchemaParser } from "effect";
import {
  type ContactFormValues,
  processContactSubmission,
} from "@/features/contact/actions/contact";
import { ContactServiceLive } from "@/features/contact/backend/contact.service";
import { locales } from "@/features/i18n";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { defineWorkspaceStateAction } from "@/shared/backend/workspace-action";

const getSubmittedString = (
  formData: FormData,
  name: keyof ContactFormValues | "locale"
) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const contactFormValuesSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  message: Schema.String,
});

const contactFormSubmissionSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  submittedValues: contactFormValuesSchema,
});
const decodeContactFormSubmission = SchemaParser.decodeUnknownEffect(
  contactFormSubmissionSchema
);

const contactFormDataSchema = Schema.FormData.pipe(
  Schema.decodeTo(contactFormSubmissionSchema, {
    decode: SchemaGetter.transformOrFail((formData, options) =>
      decodeContactFormSubmission(
        {
          locale: getSubmittedString(formData, "locale"),
          submittedValues: {
            name: getSubmittedString(formData, "name"),
            email: getSubmittedString(formData, "email"),
            phone: getSubmittedString(formData, "phone"),
            message: getSubmittedString(formData, "message"),
          },
        },
        options
      )
    ),
    encode: SchemaGetter.transform(({ locale, submittedValues }) => {
      const formData = new FormData();
      formData.set("locale", locale);
      formData.set("name", submittedValues.name);
      formData.set("email", submittedValues.email);
      formData.set("phone", submittedValues.phone);
      formData.set("message", submittedValues.message);
      return formData;
    }),
  })
);
const contactFormDataStandardSchema = Schema.toStandardSchemaV1(
  contactFormDataSchema
);

const ContactActionLive = ContactServiceLive.pipe(
  Layer.provide(
    StandaloneEmailServiceLayer.pipe(Layer.provideMerge(EmailConfigLayer))
  )
);

const submitContactAction = defineWorkspaceStateAction(
  {
    operation: "contact.submit",
    schema: contactFormDataStandardSchema,
  },
  (input) =>
    processContactSubmission({
      locale: input.locale,
      submittedValues: input.submittedValues,
    }).pipe(Effect.provide(ContactActionLive))
);

// Next must register an async function declared by this "use server" module.
export const submitContactForm: typeof submitContactAction = async (...args) =>
  await submitContactAction(...args);
