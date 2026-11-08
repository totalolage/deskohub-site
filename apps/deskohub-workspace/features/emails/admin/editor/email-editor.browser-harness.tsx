import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { EmailDraft } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FormProvider, useForm } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  fixtureDiscount,
  fixtureDraft,
  fixtureImageCloudName,
} from "./email-editor.fixtures.test-utils";
// The harness composes the editor as a host page does: through its index.
import {
  type EmailDraftFormValues,
  EmailEditor,
  type EmailEditorDiscount,
  type EmailEditorProps,
  type EmailPreviewRenderer,
  type EmailPreviewValues,
} from "./index";

const mountPoint = document.getElementById("editor-root");
if (!mountPoint) throw new Error("The editor harness root is missing.");
const locale = mountPoint.dataset.locale as Locale;
const initialDraft: EmailDraftFormValues = mountPoint.dataset.draft
  ? Schema.decodeUnknownSync(EmailDraft)(JSON.parse(mountPoint.dataset.draft))
  : fixtureDraft;

/** Synthetic sample values the host supplies; the rest show by name. */
const sampleValues: EmailPreviewValues = {
  customer_name: { _tag: "Resolved", value: "Jana Nováková" },
};

const sampleText = (
  name: string | undefined,
  values: EmailPreviewValues = {}
) => {
  const sample = name ? values[name] : undefined;
  if (!sample) return `[${name ?? ""}]`;
  return sample._tag === "Resolved" ? String(sample.value) : sample.text;
};

const plainText = (
  parts: readonly { _tag: string; text?: string; name?: string }[] = [],
  values?: EmailPreviewValues
) =>
  parts
    .map((part) =>
      part._tag === "Text" ? (part.text ?? "") : sampleText(part.name, values)
    )
    .join("");

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!
  );

/**
 * A stand-in for the preview Server Action: shows the language's texts in
 * structure order, with the supplied sample values and other value names in
 * brackets.
 */
const renderPreview: EmailPreviewRenderer = async ({
  draft,
  locale: language,
  values,
}) => {
  const translation = draft.translations?.[language];
  const subject = plainText(translation?.subject, values);
  const body = (draft.structure ?? [])
    .flatMap((component) =>
      [component.textKey, component.labelKey, component.altKey].flatMap(
        (key) =>
          key
            ? [
                `<p>${escapeHtml(plainText(translation?.texts?.[key], values))}</p>`,
              ]
            : []
      )
    )
    .join("");
  return {
    data: {
      subject,
      html: `<!doctype html><html lang="${language}"><body style="font-family:sans-serif;padding:16px"><h1 style="font-size:18px">${escapeHtml(subject)}</h1>${body}</body></html>`,
    },
  };
};

const discounts: readonly EmailEditorDiscount[] = [fixtureDiscount];

const editorProps: EmailEditorProps = {
  discounts,
  imageCloudName: fixtureImageCloudName,
  // The Workspace's languages, as the host passes them.
  locales: supportedLocales,
  renderPreview,
  values: sampleValues,
};

function EmailEditorHarness() {
  const form = useForm<EmailDraftFormValues, unknown, EmailDraft>({
    resolver: effectSchemaResolver(EmailDraft),
    defaultValues: initialDraft,
  });
  const [saved, setSaved] = useState<string>("");
  return (
    <RouteLocaleProvider locale={locale}>
      <main className="mx-auto max-w-[1400px] p-4">
        <FormProvider {...form}>
          <form
            onSubmit={form.handleSubmit(
              (draft) => setSaved(JSON.stringify({ saved: draft })),
              () => setSaved(JSON.stringify({ invalid: true }))
            )}
          >
            <EmailEditor {...editorProps} />
            <div className="mt-4 flex gap-2">
              <button type="submit">Save draft</button>
              <button onClick={() => form.reset(initialDraft)} type="button">
                Reset draft
              </button>
            </div>
          </form>
        </FormProvider>
        <output className="hidden" data-testid="saved">
          {saved}
        </output>
      </main>
    </RouteLocaleProvider>
  );
}

createRoot(mountPoint).render(<EmailEditorHarness />);
