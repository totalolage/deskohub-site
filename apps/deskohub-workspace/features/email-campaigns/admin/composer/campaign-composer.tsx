"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { AdministrationPageHeader } from "@/features/administration/components";
import { type Locale, m } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/use-route-locale";
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
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import type {
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import type { AudienceOption } from "../audiences/audience-page-data.server";
import { CampaignBodyEditor } from "../editor/campaign-body-editor";
import { CampaignSendControls } from "../sending/campaign-send-controls";
import { createCampaign, updateCampaign } from "./actions";
import {
  CampaignComposerFields,
  type CampaignComposerLocaleFields,
  composerLocales,
  hasLocaleContent,
  localeContentIssues,
  toCampaignLocalizedContent,
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

/** The saved draft the composer edits; absent while creating one. */
export type CampaignComposerDraft = {
  readonly id: CampaignId;
  /** Locales the saved content covers, which a test send renders. */
  readonly contentLocales: readonly Locale[];
};

const localeLabels: Readonly<Record<Locale, string>> = {
  "cs-CZ": "Czech",
  "en-US": "English",
};

const purposeOptions: ReadonlyArray<{
  readonly value: CampaignPurpose;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "marketing",
    label: "Marketing",
    description:
      "Only customers with marketing consent. Every email links to unsubscribe.",
  },
  {
    value: "operational",
    label: "Operational",
    description:
      "Service announcements for every matching customer. The footer says why they get it.",
  },
];

const noAudience = "none";

export function CampaignComposer({
  adminInbox,
  audiences,
  draft,
  initialFields,
  templates,
}: {
  readonly adminInbox: string | null;
  readonly audiences: readonly AudienceOption[];
  readonly draft: CampaignComposerDraft | undefined;
  readonly initialFields: CampaignComposerFields;
  readonly templates: readonly CampaignComposerTemplate[];
}) {
  const router = useRouter();
  const routeLocale = useRouteLocale();
  const form = useForm<
    typeof CampaignComposerFields.Encoded,
    unknown,
    CampaignComposerFields
  >({
    resolver: effectSchemaResolver(CampaignComposerFields),
    defaultValues: initialFields,
  });
  const [title, purpose, templateKey, audienceId, localeFields] = useWatch({
    control: form.control,
    name: ["title", "purpose", "templateKey", "audienceId", "locales"],
  });
  const [selectedLocale, setSelectedLocale] = useState<Locale>("cs-CZ");
  const [saveError, setSaveError] = useState<string>();

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

  const onSaveError = ({
    error,
  }: {
    readonly error: { readonly serverError?: string };
  }) =>
    setSaveError(
      error.serverError ?? "The campaign could not be saved. Check the fields."
    );
  const create = useWorkspaceAction(createCampaign, {
    actionName: "createCampaign",
    onSuccess: ({ data }) => {
      form.reset(form.getValues());
      router.push(
        localizeAdministrationHref(
          `/admin/email-campaigns/${data.campaignId}`,
          routeLocale
        )
      );
    },
    onError: onSaveError,
  });
  const update = useWorkspaceAction(updateCampaign, {
    actionName: "updateCampaign",
    onSuccess: () => {
      form.reset(form.getValues());
      router.refresh();
    },
    onError: onSaveError,
  });
  const saving = create.isExecuting || update.isExecuting;
  const unsavedChanges = form.formState.isDirty;

  const save = form.handleSubmit((values) => {
    setSaveError(undefined);
    const input = {
      title: values.title.trim(),
      purpose: values.purpose,
      templateKey: values.templateKey,
      audienceId: audience?.id ?? null,
      content: toCampaignLocalizedContent(values, editable),
    };
    if (draft) update.execute({ ...input, campaignId: draft.id });
    else create.execute(input);
  });

  return (
    <Form {...form}>
      <AdministrationPageHeader
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 text-navy-blue/60 text-sm"
              role="status"
            >
              {unsavedChanges ? (
                <>
                  <span
                    aria-hidden
                    className="size-2 rounded-full bg-burned-orange"
                  />
                  Unsaved changes
                </>
              ) : (
                draft && "All changes saved"
              )}
            </span>
            {draft && (
              <CampaignSendControls
                adminInbox={adminInbox}
                campaignId={draft.id}
                contentLocales={draft.contentLocales}
                unsavedChanges={unsavedChanges}
              />
            )}
            <Button
              disabled={saving || (draft !== undefined && !unsavedChanges)}
              form="campaign-composer"
              size="sm"
              type="submit"
            >
              {saving && "Saving…"}
              {!saving && (draft ? "Save draft" : "Create draft")}
            </Button>
            {draft && <DeleteCampaignDraftControl campaignId={draft.id} />}
          </div>
        }
        description={
          draft
            ? "Draft. Save your changes, then send a test to get the confirmation code for the real send."
            : "Write the campaign, then create the draft to test-send it."
        }
        eyebrow="Email campaign"
        title={title.trim() || (draft ? "Untitled campaign" : "New campaign")}
      />
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
            noValidate
            onSubmit={save}
          >
            <ComposerSection title="Campaign">
              <div className="space-y-5">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Spring opening hours" {...field} />
                      </FormControl>
                      <p className="text-navy-blue/55 text-xs">
                        Only admins see the title.
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
                        Purpose
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
                                {option.label}
                              </span>
                              <span className="text-navy-blue/60 text-xs leading-5">
                                {option.description}
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
                      <FormLabel>Template</FormLabel>
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
                      <FormLabel>Audience</FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(value === noAudience ? "" : value)
                        }
                        value={field.value || noAudience}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={noAudience}>
                            No audience yet
                          </SelectItem>
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
                          "Choose who receives the campaign before sending it."}
                        {audiences.length === 0 &&
                          "No audiences yet. Create one under Audiences."}
                      </p>
                    </FormItem>
                  )}
                />
              </div>
            </ComposerSection>
            <ComposerSection title="Content">
              <Tabs
                onValueChange={(value) => setSelectedLocale(value as Locale)}
                value={locale}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <TabsList
                    aria-label="Content language"
                    className="flex w-full sm:inline-flex sm:w-auto"
                  >
                    {editable.map((option) => (
                      <TabsTrigger
                        className="flex-1 px-2 sm:flex-none sm:px-3"
                        key={option}
                        value={option}
                      >
                        {localeLabels[option]}
                        <LocaleStatus
                          fields={localeFields[option]}
                          required={option === required}
                        />
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <p className="text-navy-blue/55 text-xs">
                    {audience?.singleLocale
                      ? `The audience only includes ${localeLabels[audience.singleLocale]} speakers.`
                      : "Czech is required: recipients without content in their language get it."}
                  </p>
                </div>
                {hiddenLocalesWithContent.length > 0 && (
                  <p className="mb-4 rounded-md bg-sunset-yellow/15 px-3 py-2 text-navy-blue/80 text-sm">
                    {hiddenLocalesWithContent
                      .map((option) => localeLabels[option])
                      .join(" and ")}{" "}
                    content is hidden for this audience and won't be saved.
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
                      fields={localeFields[option]}
                      locale={option}
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
  required,
}: {
  readonly fields: CampaignComposerLocaleFields;
  readonly required: boolean;
}) {
  if (!hasLocaleContent(fields)) {
    return required ? (
      <Badge className="px-1.5 py-0 text-[11px]" variant="emphasis">
        Required
      </Badge>
    ) : (
      <Badge className="px-1.5 py-0 text-[11px]" variant="subtle">
        Optional
      </Badge>
    );
  }
  const issueCount = localeContentIssues(fields).length;
  return issueCount > 0 ? (
    <Badge className="px-1.5 py-0 text-[11px]" variant="default">
      {issueCount} to fix
    </Badge>
  ) : (
    <CheckCircle2 aria-label="Ready" className="size-3.5 text-emerald-700" />
  );
}

function LocaleContentFields({
  control,
  fields,
  locale,
  purpose,
}: {
  readonly control: Control<
    typeof CampaignComposerFields.Encoded,
    unknown,
    CampaignComposerFields
  >;
  readonly fields: CampaignComposerLocaleFields;
  readonly locale: Locale;
  readonly purpose: CampaignPurpose;
}) {
  const issues = hasLocaleContent(fields) ? localeContentIssues(fields) : [];
  const bodyId = `campaign-body-${locale}`;

  return (
    <div className="space-y-5" lang={locale}>
      <FormField
        control={control}
        name={`locales.${locale}.subject`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Subject</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={`locales.${locale}.preheader`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Preview text</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <p className="text-navy-blue/55 text-xs">
              Most inboxes show it after the subject.
            </p>
          </FormItem>
        )}
      />
      {purpose === "operational" && (
        <FormField
          control={control}
          name={`locales.${locale}.operationalReason`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Footer reason</FormLabel>
              <FormControl>
                <Input
                  placeholder={m.emailCampaignOperationalFooter({}, { locale })}
                  {...field}
                />
              </FormControl>
              <p className="text-navy-blue/55 text-xs">
                Why the customer gets this email. Leave it empty to use the
                standard line.
              </p>
            </FormItem>
          )}
        />
      )}
      <FormField
        control={control}
        name={`locales.${locale}.body`}
        render={({ field }) => (
          <div className="space-y-2">
            <label className="font-medium text-sm" htmlFor={bodyId}>
              Body
            </label>
            <CampaignBodyEditor
              id={bodyId}
              invalid={issues.some(({ path }) => path[0] !== "subject")}
              label={`Body, ${localeLabels[locale]}`}
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
