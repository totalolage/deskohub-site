"use client";

import {
  type AdministrationCampaignDetail,
  type AudienceFilterGroupOf,
  type AutomationConditionLeaf,
  type AutomationDurationUnitType as AutomationDurationUnit,
  automationDurationUnits,
} from "@deskohub/workspace-admin-api";
import { ArrowRight, Hourglass, ListFilter, Send } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";
import { AdministrationLink } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { type Locale, locales } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Input } from "@/shared/components/ui/input";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/utils";
import type {
  AudienceValueLookups,
  AudienceValueOption,
} from "../../audience-filter-summary";
import {
  compactInputClassName,
  compactSelectClassName,
  FieldError,
  type FieldErrorLookup,
  fieldErrorAttributes,
  numberFromInput,
  numberInputValue,
} from "../../audiences/audience-control-primitives";
import { AudienceFilterBuilder } from "../../audiences/audience-filter-builder";
import { asRootGroup } from "../../audiences/audience-filter-editing";
import { campaignLocaleName } from "../../sending/campaign-locale-names";
import { defaultWaitCalendar } from "./automation-flow-editing";
import type { FlowStepValue } from "./automation-flow-form";
import { CalendarExpressionEditor } from "./calendar-expression-editor";
import type { CalendarPreviewView } from "./calendar-preview";
import { CalendarPreviewText } from "./calendar-preview-text";
import { FlowCard } from "./flow-step-frame";
import { useCalendarPreview } from "./use-calendar-preview";

type ConditionStep = Extract<FlowStepValue, { _tag: "Condition" }>;
type WaitStep = Extract<FlowStepValue, { _tag: "Wait" }>;
type ConditionGroup = AudienceFilterGroupOf<AutomationConditionLeaf>;

/** "Step 2 · Condition", the eyebrow and accessible name of a step. */
export const stepLabel = (
  step: FlowStepValue,
  number: number,
  locale: Locale
) =>
  m.emailAutomationFlowStepEyebrow(
    { number, kind: step._tag.toLowerCase() },
    { locale }
  );

/**
 * A gate (D9): the run goes on only for a customer who matches the filter
 * at that moment, and ends here for everyone else.
 */
export function ConditionStepCard({
  step,
  number,
  onChange,
  menu,
  path,
  errorAt,
  lookups,
  savedAudiences,
}: {
  readonly step: ConditionStep;
  readonly number: number;
  readonly onChange: (step: ConditionStep) => void;
  readonly menu: ReactNode;
  /** Form path of the step, for validation errors. */
  readonly path: string;
  readonly errorAt: (path: string) => string | undefined;
  readonly lookups: AudienceValueLookups;
  readonly savedAudiences: readonly AudienceValueOption[];
}) {
  const locale = useRouteLocale();
  return (
    <FlowCard
      icon={ListFilter}
      eyebrow={stepLabel(step, number, locale)}
      title={m.emailAutomationFlowConditionTitle({}, { locale })}
      menu={menu}
    >
      <p className="text-navy-blue/70 text-sm">
        {m.emailAutomationFlowConditionDescription({}, { locale })}
      </p>
      <AudienceFilterBuilder
        holder="automation-condition"
        // The form holds the encoded filter; the builder edits its decoded
        // shape, which differs only in branded ids.
        value={asRootGroup(step.filter as ConditionGroup)}
        onChange={(filter: ConditionGroup) => onChange({ ...step, filter })}
        path={`${path}.filter`}
        errorAt={errorAt}
        lookups={lookups}
        savedAudiences={savedAudiences}
      />
    </FlowCard>
  );
}

const durationUnitLabels = {
  minute: m.emailAutomationFlowWaitUnitMinute,
  hour: m.emailAutomationFlowWaitUnitHour,
  day: m.emailAutomationFlowWaitUnitDay,
  week: m.emailAutomationFlowWaitUnitWeek,
  month: m.emailAutomationFlowWaitUnitMonth,
} as const satisfies Record<
  AutomationDurationUnit,
  typeof m.emailAutomationFlowWaitUnitMinute
>;

const isDurationUnit = (value: string): value is AutomationDurationUnit =>
  automationDurationUnits.some((unit) => unit === value);

/**
 * A delay or a calendar wait (D11): the run pauses for a duration, or until
 * a Prague-time calendar holds, with the port's reading in grey below.
 */
export function WaitStepCard({
  step,
  number,
  onChange,
  menu,
  errorAt,
  initialPreview,
}: {
  readonly step: WaitStep;
  readonly number: number;
  readonly onChange: (step: WaitStep) => void;
  readonly menu: ReactNode;
  /** Errors at paths below the step's `wait`. */
  readonly errorAt: FieldErrorLookup;
  readonly initialPreview: CalendarPreviewView | undefined;
}) {
  const locale = useRouteLocale();
  const modeName = useId();
  const calendar = useCalendarPreview(initialPreview, "wait");
  const { wait } = step;
  const countError = errorAt("count");
  const countErrorId = useId();

  return (
    <FlowCard
      icon={Hourglass}
      eyebrow={stepLabel(step, number, locale)}
      title={m.emailAutomationFlowWaitTitle({}, { locale })}
      menu={menu}
    >
      <SegmentedControl
        label={m.emailAutomationFlowWaitModeLabel({}, { locale })}
        name={modeName}
        size="sm"
        value={wait._tag}
        onValueChange={(mode) => {
          if (mode === wait._tag) return;
          if (mode === "Calendar") {
            onChange({
              ...step,
              wait: { _tag: "Calendar", expression: defaultWaitCalendar },
            });
            calendar.refresh(defaultWaitCalendar);
          } else {
            onChange({
              ...step,
              wait: { _tag: "Duration", count: 1, unit: "day" },
            });
          }
        }}
        options={[
          {
            label: m.emailAutomationFlowWaitModeDuration({}, { locale }),
            value: "Duration",
          },
          {
            label: m.emailAutomationFlowWaitModeCalendar({}, { locale }),
            value: "Calendar",
          },
        ]}
      />
      {wait._tag === "Duration" ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              {m.emailAutomationFlowWaitFor({}, { locale })}
            </span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={9999}
              step={1}
              value={numberInputValue(wait.count)}
              onChange={(event) =>
                onChange({
                  ...step,
                  wait: { ...wait, count: numberFromInput(event.target.value) },
                })
              }
              aria-label={m.emailAutomationFlowWaitCountLabel({}, { locale })}
              {...fieldErrorAttributes(countErrorId, countError !== undefined)}
              variant={countError ? "error" : "default"}
              className={cn(compactInputClassName, "w-24")}
            />
            <Select
              value={wait.unit}
              onValueChange={(unit) => {
                if (isDurationUnit(unit)) {
                  onChange({ ...step, wait: { ...wait, unit } });
                }
              }}
            >
              <SelectTrigger
                aria-label={m.emailAutomationFlowWaitUnitLabel({}, { locale })}
                className={compactSelectClassName}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {automationDurationUnits.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {durationUnitLabels[unit](
                      { count: Number.isNaN(wait.count) ? 2 : wait.count },
                      { locale }
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FieldError
            id={countErrorId}
            messages={[
              countError && m.emailAutomationFlowWaitCountError({}, { locale }),
            ]}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <CalendarExpressionEditor
            value={wait.expression}
            onChange={(expression) => {
              onChange({ ...step, wait: { _tag: "Calendar", expression } });
              calendar.refresh(expression);
            }}
            usage="wait"
          />
          <CalendarPreviewText
            preview={calendar.preview}
            pending={calendar.pending}
          />
        </div>
      )}
    </FlowCard>
  );
}

/**
 * The fixed last step (D14): sends the campaign's email and ends the run.
 * Its content is edited on the Email tab.
 */
export function SendStepCard({
  campaign,
  number,
}: {
  readonly campaign: AdministrationCampaignDetail;
  readonly number: number;
}) {
  const locale = useRouteLocale();
  return (
    <FlowCard
      icon={Send}
      eyebrow={m.emailAutomationFlowStepEyebrow(
        { number, kind: "send" },
        { locale }
      )}
      title={m.emailAutomationFlowSendTitle({}, { locale })}
    >
      <p className="text-navy-blue/70 text-sm">
        {m.emailAutomationFlowSendDescription({}, { locale })}
      </p>
      <dl className="space-y-2">
        {locales.map((contentLocale) => {
          const subject = campaign.content[contentLocale]?.subject;
          return (
            <div
              key={contentLocale}
              className="rounded-lg bg-navy-blue/[0.035] px-3 py-2"
            >
              <dt className="font-semibold text-[0.7rem] text-navy-blue/55 uppercase tracking-[0.12em]">
                {m.emailAutomationFlowSendSubjectLabel(
                  { language: campaignLocaleName(contentLocale, locale) },
                  { locale }
                )}
              </dt>
              <dd
                className={cn(
                  "mt-0.5 text-sm",
                  subject ? "font-medium" : "text-navy-blue/55 italic"
                )}
              >
                {subject ||
                  m.emailAutomationFlowSendSubjectMissing({}, { locale })}
              </dd>
            </div>
          );
        })}
      </dl>
      <AdministrationLink
        href={administrationHref(
          "/[locale]/admin/email-campaigns/[campaignId]/email",
          { campaignId: campaign.id }
        )}
        className="inline-flex items-center gap-1.5 font-semibold text-burned-orange text-sm hover:underline"
      >
        {m.emailAutomationFlowSendEditEmail({}, { locale })}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </AdministrationLink>
    </FlowCard>
  );
}
