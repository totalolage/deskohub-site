"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { AdministrationPageHeader } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { m as customerMessages, type Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import type {
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import type { CampaignDelivery } from "../../campaign-states";
import type { AudienceOption } from "../audiences/audience-page-data.server";
import type { CampaignOperationFailureCopy } from "../campaign-operation-failure";
import { CampaignBodyEditor } from "../editor/campaign-body-editor";
import { campaignLocaleName } from "../sending/campaign-locale-names";
import { CampaignSendControls } from "../sending/campaign-send-controls";
import { useCampaignOperation } from "../use-campaign-operation";
import {
  type CampaignComposerFields,
  type CampaignComposerLocaleFields,
  composerLocales,
  createCampaignComposerFields,
  hasLocaleContent,
  localeContentIssues,
  toAdministrationCampaignContent,
  toAdministrationCampaignContentChange,
} from "./campaign-composer-fields";
import { CampaignEmailPreview } from "./campaign-email-preview";
import { CampaignTemplatePreview } from "./campaign-template-preview";
import { DeleteCampaignDraftControl } from "./delete-campaign-draft-control";

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

type CampaignComposerSchema = ReturnType<typeof createCampaignComposerFields>;

const purposeOptions: ReadonlyArray<{
  readonly value: CampaignPurpose;
  readonly label: typeof m.emailCampaignsComposerPurposeMarketing;
  readonly description: typeof m.emailCampaignsComposerPurposeMarketingDescription;
}> = [
  {
    value: "marketing",
    label: m.emailCampaignsComposerPurposeMarketing,
    description: m.emailCampaignsComposerPurposeMarketingDescription,
  },
  {
    value: "operational",
    label: m.emailCampaignsComposerPurposeOperational,
    description: m.emailCampaignsComposerPurposeOperationalDescription,
  },
];

const deliveryOptions: ReadonlyArray<{
  readonly value: CampaignDelivery;
  readonly label: typeof m.emailAutomationsComposerDeliveryOnce;
  readonly description: typeof m.emailAutomationsComposerDeliveryOnceDescription;
}> = [
  {
    value: "once",
    label: m.emailAutomationsComposerDeliveryOnce,
    description: m.emailAutomationsComposerDeliveryOnceDescription,
  },
  {
    value: "automated",
    label: m.emailAutomationsComposerDeliveryAutomated,
    description: m.emailAutomationsComposerDeliveryAutomatedDescription,
  },
];

const singleLocaleAudienceMessages = {
  "cs-CZ": m.emailCampaignsComposerSingleLocaleAudienceCzech,
  "en-US": m.emailCampaignsComposerSingleLocaleAudienceEnglish,
} as const satisfies Record<Locale, (...args: never) => string>;

const hiddenContentMessages = {
  "cs-CZ": m.emailCampaignsComposerHiddenContentCzech,
  "en-US": m.emailCampaignsComposerHiddenContentEnglish,
} as const satisfies Record<Locale, (...args: never) => string>;

const noAudience = "none";

const campaignSaveFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) => m.emailCampaignsComposerSaveCheckFields({}, { locale }),
  codes: {
    "content-invalid": (locale) =>
      m.emailCampaignsComposerSaveContentInvalid({}, { locale }),
    "content-markdown-invalid": (locale) =>
      m.emailCampaignsComposerSaveContentInvalid({}, { locale }),
    "content-document-invalid": (locale) =>
      m.emailCampaignsComposerSaveContentInvalid({}, { locale }),
    "content-locale-missing": (locale) =>
      m.emailCampaignsComposerSaveContentInvalid({}, { locale }),
    "audience-filter-context": (locale) =>
      m.emailCampaignsComposerSaveAudienceFilterUnavailable({}, { locale }),
    "audience-not-found": (locale) =>
      m.emailCampaignsComposerSaveAudienceNotFound({}, { locale }),
    "campaign-read-only": (locale) =>
      m.emailCampaignsComposerSaveReadOnly({}, { locale }),
    "service-unavailable": (locale) =>
      m.emailCampaignsComposerSaveFailed({}, { locale }),
  },
};

/** An automated campaign's edits fail as read-only only once it's archived. */
const automatedEmailSaveFailureCopy: CampaignOperationFailureCopy = {
  ...campaignSaveFailureCopy,
  codes: {
    ...campaignSaveFailureCopy.codes,
    "campaign-read-only": (locale) =>
      m.emailAutomationsEmailSaveArchived({}, { locale }),
  },
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
  const router = useRouter();
  const routeLocale = useRouteLocale();
  const form = useForm<
    CampaignComposerSchema["Encoded"],
    unknown,
    CampaignComposerFields
  >({
    resolver: effectSchemaResolver(createCampaignComposerFields(routeLocale)),
    defaultValues: initialFields,
  });
  const [title, purpose, templateKey, audienceId, localeFields] = useWatch({
    control: form.control,
    name: ["title", "purpose", "templateKey", "audienceId", "locales"],
  });
  const [selectedLocale, setSelectedLocale] = useState<Locale>("cs-CZ");
  const [saveError, setSaveError] = useState<string>();
  /** Chosen while creating; a saved campaign's delivery never changes. */
  const [newDelivery, setNewDelivery] = useState<CampaignDelivery>("once");
  /** Set once a new campaign is created, while its page opens. */
  const [created, setCreated] = useState(false);
  /** The fields of the save in flight, which its success marks saved. */
  const [submittedFields, setSubmittedFields] =
    useState<CampaignComposerFields>(initialFields);
  const delivery = campaign?.delivery ?? newDelivery;
  const savedOnce = campaign?.delivery === "once" ? campaign : undefined;

  const audience = audiences.find((option) => option.id === audienceId);
  const template = templates.find((option) => option.key === templateKey);
  const { editable, required } = composerLocales(audience?.singleLocale);
  const locale = editable.includes(selectedLocale)
    ? selectedLocale
    : (editable[0] ?? "cs-CZ");
  const hiddenLocalesWithContent = (["cs-CZ", "en-US"] as const).filter(
    (option) =>
      !editable.includes(option) && hasLocaleContent(localeFields[option])
  );

  const create = useCampaignOperation("createCampaign", {
    failureCopy: campaignSaveFailureCopy,
    onSuccess: ({ id }) => {
      setCreated(true);
      form.reset(form.getValues());
      router.push(
        localizeAdministrationHref(`/admin/email-campaigns/${id}`, routeLocale)
      );
    },
    onFailure: setSaveError,
  });
  const update = useCampaignOperation("updateCampaign", {
    failureCopy:
      delivery === "automated"
        ? automatedEmailSaveFailureCopy
        : campaignSaveFailureCopy,
    onSuccess: () => {
      // Edits made while the save ran stay unsaved.
      form.reset(submittedFields, { keepValues: true });
      router.refresh();
    },
    onFailure: setSaveError,
  });
  const saving = create.isExecuting || update.isExecuting;
  const unsavedChanges = form.formState.isDirty;

  const save = form.handleSubmit((values) => {
    // A created campaign's page is opening; another submit would create a
    // second one.
    if (created) return;
    setSaveError(undefined);
    setSubmittedFields(values);
    const fields = {
      title: values.title.trim(),
      purpose: values.purpose,
      templateKey: values.templateKey,
      audienceId: audience?.id ?? null,
    };
    if (campaign) {
      update.execute({
        ...fields,
        campaignId: campaign.id,
        content: toAdministrationCampaignContentChange(values, editable),
      });
    } else {
      create.execute({
        requestId: crypto.randomUUID(),
        campaign: {
          ...fields,
          delivery,
          content: toAdministrationCampaignContent(values, editable),
        },
      });
    }
  });

  const saveState = (
    <span
      className="inline-flex items-center gap-1.5 text-navy-blue/60 text-sm"
      role="status"
    >
      {unsavedChanges ? (
        <>
          <span aria-hidden className="size-2 rounded-full bg-burned-orange" />
          {m.emailCampaignsComposerUnsavedChanges({}, { locale: routeLocale })}
        </>
      ) : (
        campaign &&
        !campaign.readOnly &&
        m.emailCampaignsComposerAllChangesSaved({}, { locale: routeLocale })
      )}
    </span>
  );
  const saveButton = !campaign?.readOnly && (
    <Button
      disabled={
        saving || created || (campaign !== undefined && !unsavedChanges)
      }
      form="campaign-composer"
      size="sm"
      type="submit"
    >
      {saving && m.emailCampaignsComposerSaving({}, { locale: routeLocale })}
      {!saving &&
        (campaign
          ? {
              once: m.emailCampaignsComposerSaveDraft,
              automated: m.emailAutomationsEmailSave,
            }[campaign.delivery]({}, { locale: routeLocale })
          : m.emailCampaignsComposerCreateDraft({}, { locale: routeLocale }))}
    </Button>
  );

  return (
    <Form {...form}>
      {campaign?.delivery === "automated" ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-navy-blue/10 bg-white px-5 py-4">
          <p className="max-w-2xl text-navy-blue/70 text-sm">
            {campaign.readOnly
              ? m.emailAutomationsEmailArchivedNote({}, { locale: routeLocale })
              : m.emailAutomationsEmailUnpublishedNote(
                  {},
                  { locale: routeLocale }
                )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {saveState}
            {saveButton}
          </div>
        </div>
      ) : (
        <AdministrationPageHeader
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {saveState}
              {savedOnce && (
                <CampaignSendControls
                  adminInbox={adminInbox}
                  campaignId={savedOnce.id}
                  contentLocales={savedOnce.contentLocales}
                  unsavedChanges={unsavedChanges}
                />
              )}
              {saveButton}
              {savedOnce && (
                <DeleteCampaignDraftControl campaignId={savedOnce.id} />
              )}
            </div>
          }
          description={
            savedOnce
              ? m.emailCampaignsComposerDraftDescription(
                  {},
                  { locale: routeLocale }
                )
              : {
                  once: m.emailCampaignsComposerNewDescription,
                  automated: m.emailAutomationsComposerNewDescription,
                }[delivery]({}, { locale: routeLocale })
          }
          eyebrow={m.emailCampaignsComposerEyebrow({}, { locale: routeLocale })}
          title={
            title.trim() ||
            (savedOnce
              ? m.emailCampaignsComposerUntitledTitle(
                  {},
                  { locale: routeLocale }
                )
              : m.emailCampaignsComposerNewTitle({}, { locale: routeLocale }))
          }
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
            inert={campaign?.readOnly || create.isExecuting || created}
            noValidate
            onSubmit={save}
          >
            <ComposerSection
              title={m.emailCampaignsComposerCampaignSection(
                {},
                { locale: routeLocale }
              )}
            >
              <div className="space-y-5">
                {!campaign && (
                  <fieldset className="space-y-2">
                    <legend className="font-medium text-sm leading-none">
                      {m.emailAutomationsComposerDeliveryLabel(
                        {},
                        { locale: routeLocale }
                      )}
                    </legend>
                    <div className="grid items-stretch gap-2 sm:grid-cols-2">
                      {deliveryOptions.map((option) => (
                        <ChoiceCard key={option.value} tone="plain">
                          <input
                            checked={newDelivery === option.value}
                            className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
                            name="delivery"
                            onChange={() => setNewDelivery(option.value)}
                            type="radio"
                            value={option.value}
                          />
                          <span className="flex flex-col gap-1 text-sm">
                            <span className="font-semibold">
                              {option.label({}, { locale: routeLocale })}
                            </span>
                            <span className="text-navy-blue/60 text-xs leading-5">
                              {option.description({}, { locale: routeLocale })}
                            </span>
                          </span>
                        </ChoiceCard>
                      ))}
                    </div>
                    <p className="text-navy-blue/55 text-xs">
                      {m.emailAutomationsComposerDeliveryHint(
                        {},
                        { locale: routeLocale }
                      )}
                    </p>
                  </fieldset>
                )}
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {m.emailCampaignsComposerTitleLabel(
                          {},
                          { locale: routeLocale }
                        )}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={m.emailCampaignsComposerTitlePlaceholder(
                            {},
                            { locale: routeLocale }
                          )}
                          {...field}
                        />
                      </FormControl>
                      <p className="text-navy-blue/55 text-xs">
                        {m.emailCampaignsComposerTitleHint(
                          {},
                          { locale: routeLocale }
                        )}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="purpose"
                  render={({ field }) => (
                    <fieldset className="space-y-2">
                      <legend className="font-medium text-sm leading-none">
                        {m.emailCampaignsComposerPurposeLabel(
                          {},
                          { locale: routeLocale }
                        )}
                      </legend>
                      <div className="grid items-stretch gap-2 sm:grid-cols-2">
                        {purposeOptions.map((option) => (
                          <ChoiceCard key={option.value} tone="plain">
                            <input
                              checked={field.value === option.value}
                              className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
                              name={field.name}
                              onBlur={field.onBlur}
                              onChange={() => field.onChange(option.value)}
                              type="radio"
                              value={option.value}
                            />
                            <span className="flex flex-col gap-1 text-sm">
                              <span className="font-semibold">
                                {option.label({}, { locale: routeLocale })}
                              </span>
                              <span className="text-navy-blue/60 text-xs leading-5">
                                {option.description(
                                  {},
                                  { locale: routeLocale }
                                )}
                              </span>
                            </span>
                          </ChoiceCard>
                        ))}
                      </div>
                    </fieldset>
                  )}
                />
                <FormField
                  control={form.control}
                  name="templateKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {m.emailCampaignsComposerTemplateLabel(
                          {},
                          { locale: routeLocale }
                        )}
                      </FormLabel>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="min-w-56 flex-1">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {templates.map((option) => (
                              <SelectItem key={option.key} value={option.key}>
                                {option.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {template && (
                          <CampaignTemplatePreview template={template} />
                        )}
                      </div>
                      {template && (
                        <p className="text-navy-blue/55 text-xs">
                          {template.description}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="audienceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {{
                          once: m.emailCampaignsComposerAudienceLabel,
                          automated: m.emailAutomationsComposerAudienceLabel,
                        }[delivery]({}, { locale: routeLocale })}
                      </FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(value === noAudience ? "" : value)
                        }
                        // An automated campaign always needs an audience,
                        // so only a one-off draft can be left without one.
                        value={
                          field.value || (delivery === "once" ? noAudience : "")
                        }
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={m.emailAutomationsComposerAudiencePlaceholder(
                                {},
                                { locale: routeLocale }
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {delivery === "once" && (
                            <SelectItem value={noAudience}>
                              {m.emailCampaignsComposerAudienceNone(
                                {},
                                { locale: routeLocale }
                              )}
                            </SelectItem>
                          )}
                          {audiences.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-navy-blue/55 text-xs">
                        {audience && `${audience.summary}.`}
                        {!audience &&
                          audiences.length > 0 &&
                          m.emailCampaignsComposerAudienceHint(
                            {},
                            { locale: routeLocale }
                          )}
                        {audiences.length === 0 &&
                          m.emailCampaignsComposerAudiencesEmpty(
                            {},
                            { locale: routeLocale }
                          )}
                      </p>
                    </FormItem>
                  )}
                />
              </div>
            </ComposerSection>
            <ComposerSection
              title={m.emailCampaignsComposerContentSection(
                {},
                { locale: routeLocale }
              )}
            >
              <Tabs
                onValueChange={(value) => setSelectedLocale(value as Locale)}
                value={locale}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <TabsList
                    aria-label={m.emailCampaignsComposerContentLanguageLabel(
                      {},
                      { locale: routeLocale }
                    )}
                    className="flex w-full sm:inline-flex sm:w-auto"
                  >
                    {editable.map((option) => (
                      <TabsTrigger
                        className="flex-1 px-2 sm:flex-none sm:px-3"
                        key={option}
                        value={option}
                      >
                        {campaignLocaleName(option, routeLocale)}
                        <LocaleStatus
                          fields={localeFields[option]}
                          locale={routeLocale}
                          required={option === required}
                        />
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <p className="text-navy-blue/55 text-xs">
                    {audience?.singleLocale
                      ? singleLocaleAudienceMessages[audience.singleLocale](
                          {},
                          { locale: routeLocale }
                        )
                      : m.emailCampaignsComposerFallbackLocaleHint(
                          {},
                          { locale: routeLocale }
                        )}
                  </p>
                </div>
                {hiddenLocalesWithContent.length > 0 && (
                  <p className="mb-4 rounded-md bg-sunset-yellow/15 px-3 py-2 text-navy-blue/80 text-sm">
                    {hiddenLocalesWithContent
                      .map((option) =>
                        hiddenContentMessages[option](
                          {},
                          { locale: routeLocale }
                        )
                      )
                      .join(" ")}
                  </p>
                )}
                {editable.map((option) => (
                  <TabsContent
                    className="data-[state=inactive]:hidden"
                    forceMount
                    key={option}
                    value={option}
                  >
                    <LocaleContentFields
                      control={form.control}
                      contentLocale={option}
                      fields={localeFields[option]}
                      locale={routeLocale}
                      purpose={purpose}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </ComposerSection>
          </form>
          <aside className="min-w-0 @5xl:sticky @5xl:top-20">
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

function LocaleStatus({
  fields,
  locale,
  required,
}: {
  readonly fields: CampaignComposerLocaleFields;
  readonly locale: Locale;
  readonly required: boolean;
}) {
  if (!hasLocaleContent(fields)) {
    return required ? (
      <Badge className="px-1.5 py-0 text-[11px]" variant="emphasis">
        {m.emailCampaignsComposerLocaleRequired({}, { locale })}
      </Badge>
    ) : (
      <Badge className="px-1.5 py-0 text-[11px]" variant="subtle">
        {m.emailCampaignsComposerLocaleOptional({}, { locale })}
      </Badge>
    );
  }
  const issueCount = localeContentIssues(fields, locale).length;
  return issueCount > 0 ? (
    <Badge className="px-1.5 py-0 text-[11px]" variant="default">
      {m.emailCampaignsComposerLocaleIssues({ count: issueCount }, { locale })}
    </Badge>
  ) : (
    <CheckCircle2
      aria-label={m.emailCampaignsComposerLocaleReady({}, { locale })}
      className="size-3.5 text-emerald-700"
    />
  );
}

function LocaleContentFields({
  contentLocale,
  control,
  fields,
  locale,
  purpose,
}: {
  /** The language of the campaign content these fields edit. */
  readonly contentLocale: Locale;
  readonly control: Control<
    CampaignComposerSchema["Encoded"],
    unknown,
    CampaignComposerFields
  >;
  readonly fields: CampaignComposerLocaleFields;
  /** The admin's language. */
  readonly locale: Locale;
  readonly purpose: CampaignPurpose;
}) {
  const issues = hasLocaleContent(fields)
    ? localeContentIssues(fields, locale)
    : [];
  const bodyId = `campaign-body-${contentLocale}`;

  return (
    <div className="space-y-5">
      <FormField
        control={control}
        name={`locales.${contentLocale}.subject`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {m.emailCampaignsComposerSubjectLabel({}, { locale })}
            </FormLabel>
            <FormControl>
              <Input lang={contentLocale} {...field} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={`locales.${contentLocale}.preheader`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {m.emailCampaignsComposerPreheaderLabel({}, { locale })}
            </FormLabel>
            <FormControl>
              <Input lang={contentLocale} {...field} />
            </FormControl>
            <p className="text-navy-blue/55 text-xs">
              {m.emailCampaignsComposerPreheaderHint({}, { locale })}
            </p>
          </FormItem>
        )}
      />
      {purpose === "operational" && (
        <FormField
          control={control}
          name={`locales.${contentLocale}.operationalReason`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {m.emailCampaignsComposerOperationalReasonLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  lang={contentLocale}
                  placeholder={customerMessages.emailCampaignOperationalFooter(
                    {},
                    { locale: contentLocale }
                  )}
                  {...field}
                />
              </FormControl>
              <p className="text-navy-blue/55 text-xs">
                {m.emailCampaignsComposerOperationalReasonHint({}, { locale })}
              </p>
            </FormItem>
          )}
        />
      )}
      <FormField
        control={control}
        name={`locales.${contentLocale}.body`}
        render={({ field }) => (
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor={bodyId}>
              {m.emailCampaignsComposerBodyLabel({}, { locale })}
            </label>
            <CampaignBodyEditor
              contentLocale={contentLocale}
              id={bodyId}
              invalid={issues.some(({ path }) => path[0] !== "subject")}
              label={m.emailCampaignsComposerBodyEditorLabel(
                { language: campaignLocaleName(contentLocale, locale) },
                { locale }
              )}
              onChange={field.onChange}
              value={field.value}
            />
          </div>
        )}
      />
      <div aria-live="polite">
        {issues.length > 0 && (
          <ul className="space-y-1 rounded-md border border-burned-orange/25 bg-burned-orange/5 px-4 py-3 text-burned-orange-ink text-sm">
            {issues.map(({ issue, path }) => (
              <li
                className="list-inside list-disc"
                key={`${path.join(".")}:${issue}`}
              >
                {issue}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
