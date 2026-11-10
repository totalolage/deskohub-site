"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Form } from "@/shared/components/ui/form";
import type { CampaignTemplateKey } from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import type { CampaignDelivery } from "../../campaign-states";
import { campaignFallbackLocale } from "../../recipient-locale";
import type { AudienceOption } from "../audiences/audience-page-data.server";
import {
  CampaignContentTabs,
  contentLocaleView,
} from "./campaign-composer-content";
import {
  type CampaignComposerFields,
  createCampaignComposerFields,
} from "./campaign-composer-fields";
import type { CampaignComposerForm } from "./campaign-composer-form";
import { CampaignSettingsFields } from "./campaign-composer-settings";
import {
  AutomatedEmailBar,
  ComposerPageHeader,
  ComposerSaveButton,
  ComposerSaveState,
} from "./campaign-composer-toolbar";
import { CampaignEmailPreview } from "./campaign-email-preview";
import { useCampaignComposerSave } from "./use-campaign-composer-save";

export type CampaignComposerTemplate = {
  readonly key: CampaignTemplateKey;
  readonly name: string;
  readonly description: string;
  /** The template rendered with sample content. */
  readonly previewHtml: string;
};

/**
 * The saved campaign the composer edits, absent while creating one: a one-off
 * Draft, or an automated campaign's email and audience.
 */
export type CampaignComposerCampaign = {
  readonly id: CampaignId;
  /** Locales the saved content covers, which a test send renders. */
  readonly contentLocales: readonly Locale[];
  readonly delivery: CampaignDelivery;
  /** An archived automated campaign can no longer change. */
  readonly readOnly: boolean;
};

export function CampaignComposer({
  adminInbox,
  audiences,
  campaign,
  initialFields,
  templates,
}: {
  readonly adminInbox: string | null;
  readonly audiences: readonly AudienceOption[];
  readonly campaign: CampaignComposerCampaign | undefined;
  readonly initialFields: CampaignComposerFields;
  readonly templates: readonly CampaignComposerTemplate[];
}) {
  const routeLocale = useRouteLocale();
  const form: CampaignComposerForm = useForm({
    resolver: effectSchemaResolver(createCampaignComposerFields(routeLocale)),
    defaultValues: initialFields,
  });
  const [title, purpose, templateKey, audienceId, localeFields] = useWatch({
    control: form.control,
    name: ["title", "purpose", "templateKey", "audienceId", "locales"],
  });
  const [selectedLocale, setSelectedLocale] = useState<Locale>(
    campaignFallbackLocale
  );
  /** Chosen while creating; a saved campaign's delivery never changes. */
  const [newDelivery, setNewDelivery] = useState<CampaignDelivery>("once");
  const delivery = campaign?.delivery ?? newDelivery;

  const audience = audiences.find((option) => option.id === audienceId);
  const template = templates.find((option) => option.key === templateKey);
  const localeView = contentLocaleView(audience, selectedLocale, localeFields);
  const { editable, shown: locale } = localeView;

  const { created, creating, save, saveError, saving } =
    useCampaignComposerSave({
      audience,
      campaign,
      delivery,
      editable,
      form,
      initialFields,
      routeLocale,
    });
  const unsavedChanges = form.formState.isDirty;

  const saveState = (
    <ComposerSaveState
      campaign={campaign}
      locale={routeLocale}
      unsavedChanges={unsavedChanges}
    />
  );
  const saveButton = (
    <ComposerSaveButton
      campaign={campaign}
      created={created}
      locale={routeLocale}
      saving={saving}
      unsavedChanges={unsavedChanges}
    />
  );

  return (
    <Form {...form}>
      {campaign?.delivery === "automated" ? (
        <AutomatedEmailBar locale={routeLocale} readOnly={campaign.readOnly}>
          {saveState}
          {saveButton}
        </AutomatedEmailBar>
      ) : (
        <ComposerPageHeader
          adminInbox={adminInbox}
          campaign={campaign}
          delivery={delivery}
          locale={routeLocale}
          saveButton={saveButton}
          saveState={saveState}
          title={title}
          unsavedChanges={unsavedChanges}
        />
      )}
      <p
        className="mb-5 rounded-lg border border-burned-orange/25 bg-burned-orange/5 px-4 py-3 text-burned-orange-ink text-sm empty:hidden"
        role="alert"
      >
        {saveError}
      </p>
      <div className="@container">
        <div className="grid items-start gap-6 @5xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <form
            className="min-w-0 space-y-6"
            id="campaign-composer"
            // Creating opens the new campaign's page, which would drop edits
            // made meanwhile, so the form waits for it.
            inert={campaign?.readOnly || creating || created}
            noValidate
            onSubmit={save}
          >
            <ComposerSection
              title={m.emailCampaignsComposerCampaignSection(
                {},
                { locale: routeLocale }
              )}
            >
              <CampaignSettingsFields
                audience={audience}
                audiences={audiences}
                control={form.control}
                delivery={delivery}
                isNew={!campaign}
                locale={routeLocale}
                onDeliveryChange={setNewDelivery}
                template={template}
                templates={templates}
              />
            </ComposerSection>
            <ComposerSection
              title={m.emailCampaignsComposerContentSection(
                {},
                { locale: routeLocale }
              )}
            >
              <CampaignContentTabs
                audience={audience}
                control={form.control}
                localeFields={localeFields}
                onLocaleChange={setSelectedLocale}
                purpose={purpose}
                routeLocale={routeLocale}
                view={localeView}
              />
            </ComposerSection>
          </form>
          {/* At the bottom of the page the grid pushes the sticky preview up;
              fitting it between its offset (8rem) and the page's bottom
              padding (2.25rem) keeps its header clear of the toolbar. */}
          <aside className="min-w-0 @5xl:sticky @5xl:top-32 @5xl:h-[calc(100dvh-10.25rem)]">
            <CampaignEmailPreview
              fields={localeFields[locale]}
              locale={locale}
              locales={editable}
              onLocaleChange={setSelectedLocale}
              purpose={purpose}
              templateKey={templateKey}
            />
          </aside>
        </div>
      </div>
    </Form>
  );
}

function ComposerSection({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title: string;
}) {
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
      <h2 className="mb-4 font-semibold text-navy-blue/65 text-xs uppercase tracking-[0.1em]">
        {title}
      </h2>
      {children}
    </section>
  );
}
