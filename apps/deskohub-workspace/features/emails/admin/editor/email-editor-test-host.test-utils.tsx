import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { EmailDraft } from "@deskohub/workspace-admin-api";
import type { ReactNode } from "react";
import { FormProvider, type UseFormReturn, useForm } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import type { EmailDraftFormValues } from "./email-draft-form";
import { EmailEditorProvider } from "./email-editor-context";

/** The host form a test renders editor parts in. */
export type EmailEditorTestForm = UseFormReturn<
  EmailDraftFormValues,
  unknown,
  EmailDraft
>;

/**
 * Renders editor parts as a host page would: inside a draft form validated
 * by `EmailDraft` and the editor provider. `onForm` receives the form.
 */
export function EmailEditorTestHost({
  children,
  defaultValues,
  locale = "en-US",
  locales = supportedLocales,
  onForm,
}: {
  readonly children: ReactNode;
  readonly defaultValues: EmailDraftFormValues;
  readonly locale?: Locale;
  readonly locales?: readonly Locale[];
  readonly onForm?: (form: EmailEditorTestForm) => void;
}) {
  const form = useForm<EmailDraftFormValues, unknown, EmailDraft>({
    resolver: effectSchemaResolver(EmailDraft),
    defaultValues,
  });
  onForm?.(form);
  return (
    <RouteLocaleProvider locale={locale}>
      <FormProvider {...form}>
        <EmailEditorProvider locales={locales}>{children}</EmailEditorProvider>
      </FormProvider>
    </RouteLocaleProvider>
  );
}
