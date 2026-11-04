"use client";

import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import {
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
import type { CampaignPurpose } from "../../body/campaign-content";
import type { CampaignDelivery } from "../../campaign-states";
import type { AudienceOption } from "../audiences/audience-page-data.server";
import type { CampaignComposerTemplate } from "./campaign-composer";
import type { CampaignComposerControl } from "./campaign-composer-form";
import { CampaignTemplatePreview } from "./campaign-template-preview";

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

const noAudience = "none";

/** A new campaign's delivery, chosen once while creating it. */
function DeliveryChoice({
  locale,
  onChange,
  value,
}: {
  readonly locale: Locale;
  readonly onChange: (delivery: CampaignDelivery) => void;
  readonly value: CampaignDelivery;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium text-sm leading-none">
        {m.emailAutomationsComposerDeliveryLabel({}, { locale })}
      </legend>
      <div className="grid items-stretch gap-2 sm:grid-cols-2">
        {deliveryOptions.map((option) => (
          <ChoiceCard key={option.value} tone="plain">
            <input
              checked={value === option.value}
              className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
              name="delivery"
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            <span className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">
                {option.label({}, { locale })}
              </span>
              <span className="text-navy-blue/60 text-xs leading-5">
                {option.description({}, { locale })}
              </span>
            </span>
          </ChoiceCard>
        ))}
      </div>
      <p className="text-navy-blue/55 text-xs">
        {m.emailAutomationsComposerDeliveryHint({}, { locale })}
      </p>
    </fieldset>
  );
}

function TitleField({
  control,
  locale,
}: {
  readonly control: CampaignComposerControl;
  readonly locale: Locale;
}) {
  return (
    <FormField
      control={control}
      name="title"
      render={({ field }) => (
        <FormItem>
          <FormLabel required>
            {m.emailCampaignsComposerTitleLabel({}, { locale })}
          </FormLabel>
          <FormControl>
            <Input
              placeholder={m.emailCampaignsComposerTitlePlaceholder(
                {},
                { locale }
              )}
              {...field}
            />
          </FormControl>
          <p className="text-navy-blue/55 text-xs">
            {m.emailCampaignsComposerTitleHint({}, { locale })}
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function PurposeField({
  control,
  locale,
}: {
  readonly control: CampaignComposerControl;
  readonly locale: Locale;
}) {
  return (
    <FormField
      control={control}
      name="purpose"
      render={({ field }) => (
        <fieldset className="space-y-2">
          <legend className="font-medium text-sm leading-none">
            {m.emailCampaignsComposerPurposeLabel({}, { locale })}
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
                    {option.label({}, { locale })}
                  </span>
                  <span className="text-navy-blue/60 text-xs leading-5">
                    {option.description({}, { locale })}
                  </span>
                </span>
              </ChoiceCard>
            ))}
          </div>
        </fieldset>
      )}
    />
  );
}

function TemplateField({
  control,
  locale,
  template,
  templates,
}: {
  readonly control: CampaignComposerControl;
  readonly locale: Locale;
  /** The chosen template, if it's still offered. */
  readonly template: CampaignComposerTemplate | undefined;
  readonly templates: readonly CampaignComposerTemplate[];
}) {
  return (
    <FormField
      control={control}
      name="templateKey"
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {m.emailCampaignsComposerTemplateLabel({}, { locale })}
          </FormLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Select onValueChange={field.onChange} value={field.value}>
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
            {template && <CampaignTemplatePreview template={template} />}
          </div>
          {template && (
            <p className="text-navy-blue/55 text-xs">{template.description}</p>
          )}
        </FormItem>
      )}
    />
  );
}

/**
 * The chosen audience's summary, a hint to choose one, or that there are no
 * audiences yet.
 */
function AudienceHint({
  audience,
  audiences,
  locale,
}: {
  readonly audience: AudienceOption | undefined;
  readonly audiences: readonly AudienceOption[];
  readonly locale: Locale;
}) {
  return (
    <p className="text-navy-blue/55 text-xs">
      {audience && `${audience.summary}.`}
      {!audience &&
        audiences.length > 0 &&
        m.emailCampaignsComposerAudienceHint({}, { locale })}
      {audiences.length === 0 &&
        m.emailCampaignsComposerAudiencesEmpty({}, { locale })}
    </p>
  );
}

function AudienceField({
  audience,
  audiences,
  control,
  delivery,
  locale,
}: {
  /** The chosen audience, if it still exists. */
  readonly audience: AudienceOption | undefined;
  readonly audiences: readonly AudienceOption[];
  readonly control: CampaignComposerControl;
  readonly delivery: CampaignDelivery;
  readonly locale: Locale;
}) {
  return (
    <FormField
      control={control}
      name="audienceId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {{
              once: m.emailCampaignsComposerAudienceLabel,
              automated: m.emailAutomationsComposerAudienceLabel,
            }[delivery]({}, { locale })}
          </FormLabel>
          <Select
            onValueChange={(value) =>
              field.onChange(value === noAudience ? "" : value)
            }
            // An automated campaign always needs an audience,
            // so only a one-off draft can be left without one.
            value={field.value || (delivery === "once" ? noAudience : "")}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue
                  placeholder={m.emailAutomationsComposerAudiencePlaceholder(
                    {},
                    { locale }
                  )}
                />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {delivery === "once" && (
                <SelectItem value={noAudience}>
                  {m.emailCampaignsComposerAudienceNone({}, { locale })}
                </SelectItem>
              )}
              {audiences.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AudienceHint
            audience={audience}
            audiences={audiences}
            locale={locale}
          />
        </FormItem>
      )}
    />
  );
}

/**
 * The campaign section's fields: a new campaign's delivery, then title,
 * purpose, template, and audience.
 */
export function CampaignSettingsFields({
  audience,
  audiences,
  control,
  delivery,
  isNew,
  locale,
  onDeliveryChange,
  template,
  templates,
}: {
  readonly audience: AudienceOption | undefined;
  readonly audiences: readonly AudienceOption[];
  readonly control: CampaignComposerControl;
  readonly delivery: CampaignDelivery;
  /** Whether the composer creates a new campaign, whose delivery it picks. */
  readonly isNew: boolean;
  readonly locale: Locale;
  readonly onDeliveryChange: (delivery: CampaignDelivery) => void;
  readonly template: CampaignComposerTemplate | undefined;
  readonly templates: readonly CampaignComposerTemplate[];
}) {
  return (
    <div className="space-y-5">
      {isNew && (
        <DeliveryChoice
          locale={locale}
          onChange={onDeliveryChange}
          value={delivery}
        />
      )}
      <TitleField control={control} locale={locale} />
      <PurposeField control={control} locale={locale} />
      <TemplateField
        control={control}
        locale={locale}
        template={template}
        templates={templates}
      />
      <AudienceField
        audience={audience}
        audiences={audiences}
        control={control}
        delivery={delivery}
        locale={locale}
      />
    </div>
  );
}
