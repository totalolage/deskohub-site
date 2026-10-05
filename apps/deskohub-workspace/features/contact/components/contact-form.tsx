import { submitContactForm } from "@/features/contact/actions/submit-contact";
import type { Locale } from "@/features/i18n";
import {
  ContactFormClient,
  type ContactFormInitialValues,
} from "./contact-form-client";

export type { ContactFormInitialValues } from "./contact-form-client";

export function ContactForm({
  initialValues,
  locale,
}: {
  readonly initialValues?: ContactFormInitialValues;
  readonly locale: Locale;
}) {
  return (
    <ContactFormClient
      initialValues={initialValues}
      locale={locale}
      submitAction={submitContactForm}
    />
  );
}
