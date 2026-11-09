"use client";

import { useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import { useEmailDraftForm } from "./email-draft-form";
import { EmailEditorProvider, useEmailEditor } from "./email-editor-context";
import {
  emailEditorLanguageName,
  emailEditorLanguageProblemCount,
  emailEnglishFallbackMissing,
} from "./email-editor-problems";
import { EmailEditorSettings } from "./email-editor-settings";
import { EmailLanguageFields } from "./email-language-fields";
import {
  EmailPreviewPanel,
  type EmailPreviewRenderer,
  type EmailPreviewValues,
} from "./email-preview-panel";
import { EmailProblemSummary } from "./email-problem-summary";
import { EmailRetiredTranslations } from "./email-retired-translations";
import { EmailStructureSection } from "./email-structure-section";
import {
  type EmailEditorDiscount,
  EmailValuesSection,
} from "./email-values-section";

export type EmailEditorProps = {
  /** The Workspace's current languages, one tab each. */
  readonly locales: readonly Locale[];
  /** Discounts a discount value can issue codes from. */
  readonly discounts: readonly EmailEditorDiscount[];
  /** The Cloudinary account editor uploads go to. */
  readonly imageCloudName?: string;
  /** Images the email's previous publication showed; they stay allowed. */
  readonly publishedImageSources?: readonly string[];
  /** Sample values for the preview; the renderer fills in the rest. */
  readonly values?: EmailPreviewValues;
  /** Renders the preview, such as the `previewEmailDraft` Server Action. */
  readonly renderPreview: EmailPreviewRenderer;
};

/**
 * Edits one multilingual email draft inside the host's draft form: shared
 * settings, values and structure once, and every language's texts in its
 * tab, with live publication problems and a preview.
 */
export function EmailEditor({
  discounts,
  imageCloudName,
  locales,
  publishedImageSources,
  renderPreview,
  values,
}: EmailEditorProps) {
  return (
    <EmailEditorProvider
      imageCloudName={imageCloudName}
      locales={locales}
      publishedImageSources={publishedImageSources}
    >
      <div className="@container">
        <div className="grid gap-5 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="min-w-0 space-y-5">
            <EmailEditorSettings />
            <EmailValuesSection discounts={discounts} />
            <EmailLanguageTabs />
          </div>
          <aside className="min-w-0 space-y-5">
            <EmailProblemSummary />
            <EmailPreviewPanel renderPreview={renderPreview} values={values} />
          </aside>
        </div>
      </div>
    </EmailEditorProvider>
  );
}

/** A note while German and Ukrainian recipients would fall back to Czech. */
function EmailEnglishFallbackNote() {
  const locale = useRouteLocale();
  const { control } = useEmailDraftForm();
  const translations = useWatch({ control, name: "translations" });
  return (
    emailEnglishFallbackMissing({ translations }) && (
      <p className="mb-4 rounded-md bg-sunset-yellow/15 px-3 py-2 text-navy-blue/80 text-sm">
        {m.emailsEditorEnglishFallbackMissing({}, { locale })}
      </p>
    )
  );
}

/** A tab per language with its problem count; the active one shows its texts. */
function EmailLanguageTabs() {
  const locale = useRouteLocale();
  const { locales, activeLocale, setActiveLocale, problems } = useEmailEditor();
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
      <EmailRetiredTranslations />
      <EmailEnglishFallbackNote />
      <Tabs
        onValueChange={(value) => setActiveLocale(value as Locale)}
        value={activeLocale}
      >
        <TabsList
          aria-label={m.emailsEditorLanguagesLabel({}, { locale })}
          className="mb-4"
        >
          {locales.map((language) => {
            const count = emailEditorLanguageProblemCount(problems, language);
            return (
              <TabsTrigger key={language} value={language}>
                {emailEditorLanguageName(language)}
                {count > 0 && (
                  <>
                    <span
                      aria-hidden
                      className="rounded-full bg-burned-orange px-1.5 text-[11px] text-white leading-4"
                    >
                      {count}
                    </span>
                    <span className="sr-only">
                      {m.emailsEditorLanguageProblemCount(
                        { count },
                        { locale }
                      )}
                    </span>
                  </>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {locales.map((language) => (
          <TabsContent className="space-y-6" key={language} value={language}>
            <h2 className="sr-only">
              {m.emailsEditorTranslationHeading(
                { language: emailEditorLanguageName(language) },
                { locale }
              )}
            </h2>
            <EmailLanguageFields contentLocale={language} />
            <EmailStructureSection contentLocale={language} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
