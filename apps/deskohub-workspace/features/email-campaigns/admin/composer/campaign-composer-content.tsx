"use client";

import { Option } from "effect";
import { CheckCircle2 } from "lucide-react";
import { getClientEnv } from "@/client-env";
import { m } from "@/features/administration/i18n";
import { m as customerMessages, type Locale } from "@/features/i18n";
import { Badge } from "@/shared/components/ui/badge";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/components/ui/tabs";
import type { CampaignPurpose } from "../../body/campaign-content";
import {
  campaignFallbackLocale,
  campaignLocales,
} from "../../recipient-locale";
import type { AudienceOption } from "../audiences/audience-page-data.server";
import { CampaignBodyEditor } from "../editor/campaign-body-editor";
import { campaignLocaleName } from "../sending/campaign-locale-names";
import {
  type CampaignComposerFields,
  type CampaignComposerLocaleFields,
  composerLocales,
  englishFallbackMissing,
  hasLocaleContent,
  localeContentIssueMessage,
  localeContentIssues,
} from "./campaign-composer-fields";
import type { CampaignComposerControl } from "./campaign-composer-form";

const singleLocaleAudienceMessages = {
  "cs-CZ": m.emailCampaignsComposerSingleLocaleAudienceCzech,
  "en-US": m.emailCampaignsComposerSingleLocaleAudienceEnglish,
  "de-DE": m.emailCampaignsComposerSingleLocaleAudienceGerman,
  "uk-UA": m.emailCampaignsComposerSingleLocaleAudienceUkrainian,
  "sk-SK": m.emailCampaignsComposerSingleLocaleAudienceSlovak,
  "vi-VN": m.emailCampaignsComposerSingleLocaleAudienceVietnamese,
  "hi-IN": m.emailCampaignsComposerSingleLocaleAudienceHindi,
} as const satisfies Record<Locale, (...args: never) => string>;

const hiddenContentMessages = {
  "cs-CZ": m.emailCampaignsComposerHiddenContentCzech,
  "en-US": m.emailCampaignsComposerHiddenContentEnglish,
  "de-DE": m.emailCampaignsComposerHiddenContentGerman,
  "uk-UA": m.emailCampaignsComposerHiddenContentUkrainian,
  "sk-SK": m.emailCampaignsComposerHiddenContentSlovak,
  "vi-VN": m.emailCampaignsComposerHiddenContentVietnamese,
  "hi-IN": m.emailCampaignsComposerHiddenContentHindi,
} as const satisfies Record<Locale, (...args: never) => string>;

/**
 * The content locales the audience allows: which are editable, which one is
 * required, the one shown (the chosen one while editable, else the first),
 * the locales the audience hides that still hold content, and whether
 * missing English content sends some recipients Czech instead.
 */
export const contentLocaleView = (
  audience: AudienceOption | undefined,
  selectedLocale: Locale,
  localeFields: CampaignComposerFields["locales"]
) => {
  const { editable, required } = composerLocales(audience?.singleLocale);
  const shown = editable.includes(selectedLocale)
    ? selectedLocale
    : (editable[0] ?? campaignFallbackLocale);
  const hiddenWithContent = campaignLocales.filter(
    (option) =>
      !editable.includes(option) && hasLocaleContent(localeFields[option])
  );
  return {
    editable,
    required,
    shown,
    hiddenWithContent,
    englishMissing: englishFallbackMissing(
      audience?.singleLocale,
      localeFields
    ),
  };
};

/**
 * The content section: a tab per editable locale with its status, a note
 * on hidden locales that still hold content, and each locale's fields.
 */
export function CampaignContentTabs({
  audience,
  control,
  localeFields,
  onLocaleChange,
  purpose,
  routeLocale,
  view,
}: {
  readonly audience: AudienceOption | undefined;
  readonly control: CampaignComposerControl;
  readonly localeFields: CampaignComposerFields["locales"];
  readonly onLocaleChange: (locale: Locale) => void;
  readonly purpose: CampaignPurpose;
  readonly routeLocale: Locale;
  readonly view: ReturnType<typeof contentLocaleView>;
}) {
  const { editable, required, shown, hiddenWithContent, englishMissing } = view;
  return (
    <Tabs
      onValueChange={(value) => onLocaleChange(value as Locale)}
      value={shown}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TabsList
          aria-label={m.emailCampaignsComposerContentLanguageLabel(
            {},
            { locale: routeLocale }
          )}
          className="flex h-auto w-full sm:inline-flex sm:h-9 sm:w-auto"
        >
          {editable.map((option) => (
            <TabsTrigger
              className="h-auto min-h-7 flex-1 flex-wrap gap-y-0.5 self-stretch whitespace-normal px-2 py-1 sm:h-7 sm:flex-none sm:flex-nowrap sm:self-auto sm:whitespace-nowrap sm:px-3 sm:py-0"
              key={option}
              value={option}
            >
              {campaignLocaleName(option)}
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
      {englishMissing && (
        <p className="mb-4 rounded-md bg-sunset-yellow/15 px-3 py-2 text-navy-blue/80 text-sm">
          {m.emailCampaignsComposerEnglishFallbackMissing(
            {},
            { locale: routeLocale }
          )}
        </p>
      )}
      {hiddenWithContent.length > 0 && (
        <p className="mb-4 rounded-md bg-sunset-yellow/15 px-3 py-2 text-navy-blue/80 text-sm">
          {hiddenWithContent
            .map((option) =>
              hiddenContentMessages[option]({}, { locale: routeLocale })
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
            control={control}
            contentLocale={option}
            fields={localeFields[option]}
            locale={routeLocale}
            purpose={purpose}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** The Cloudinary account body images must come from. */
const imageCloudName = () =>
  Option.some(getClientEnv().NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME);

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
  const issueCount = localeContentIssues(fields, imageCloudName()).length;
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
  readonly control: CampaignComposerControl;
  readonly fields: CampaignComposerLocaleFields;
  /** The admin's language. */
  readonly locale: Locale;
  readonly purpose: CampaignPurpose;
}) {
  const issues = hasLocaleContent(fields)
    ? localeContentIssues(fields, imageCloudName())
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
              invalid={issues.some(({ _tag }) => _tag !== "SubjectMissing")}
              label={m.emailCampaignsComposerBodyEditorLabel(
                { language: campaignLocaleName(contentLocale) },
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
            {issues.map((issue) => (
              <li
                className="list-inside list-disc"
                key={`${issue.path.join(".")}:${issue._tag}`}
              >
                {localeContentIssueMessage(issue, locale)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
