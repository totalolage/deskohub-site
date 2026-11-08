"use client";

import type { CalendarExpressionType as CalendarExpression } from "@deskohub/workspace-admin-api";
import {
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  DoorClosed,
  DoorOpen,
  type LucideIcon,
  UserPlus,
  Zap,
} from "lucide-react";
import { useId } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import { cn } from "@/shared/utils";
import {
  FieldError,
  type FieldErrorLookup,
  fieldErrorAttributes,
} from "../../audiences/audience-control-primitives";
import { ProductFilterControl } from "../../audiences/reservation-product-filter-control";
import { AutomationFrequencyBanner } from "../automation-frequency-banner";
import { automationTriggerLabel } from "../automation-trigger-labels";
import {
  defaultScheduleCalendar,
  type EventTrigger,
  type EventTriggerKind,
  eventTrigger,
  eventTriggerKindOf,
  eventTriggerKinds,
  takesProductFilter,
} from "./automation-flow-editing";
import type { FlowTriggerValue } from "./automation-flow-form";
import { CalendarExpressionEditor } from "./calendar-expression-editor";
import {
  type CalendarPreviewView,
  scheduleMinutesFailure,
} from "./calendar-preview";
import {
  CalendarNextStarts,
  CalendarPreviewText,
} from "./calendar-preview-text";
import { FlowCard } from "./flow-step-frame";
import { useCalendarPreview } from "./use-calendar-preview";

type TriggerFamily = "schedule" | "event";

const eventTriggerPresentation = {
  "reservation-booked": {
    icon: CalendarCheck,
    description: m.emailAutomationFlowEventBookedDescription,
  },
  "reservation-cancelled": {
    icon: CalendarX2,
    description: m.emailAutomationFlowEventCancelledDescription,
  },
  "reservation-started": {
    icon: DoorOpen,
    description: m.emailAutomationFlowEventStartedDescription,
  },
  "reservation-finished": {
    icon: DoorClosed,
    description: m.emailAutomationFlowEventFinishedDescription,
  },
  "account-created": {
    icon: UserPlus,
    description: m.emailAutomationFlowEventAccountCreatedDescription,
  },
} as const satisfies Record<
  EventTriggerKind,
  { readonly icon: LucideIcon; readonly description: unknown }
>;

const triggerFamilyOf = (
  trigger: FlowTriggerValue | null
): TriggerFamily | null =>
  trigger && (trigger._tag === "Schedule" ? "schedule" : "event");

/** The card's title: the trigger's name, or the call to choose one. */
const triggerTitle = (trigger: FlowTriggerValue | null, locale: Locale) =>
  trigger === null
    ? m.emailAutomationFlowTriggerChooseTitle({}, { locale })
    : automationTriggerLabel(
        trigger._tag === "Schedule" ? "schedule" : eventTriggerKindOf(trigger),
        locale
      );

/**
 * The flow's start (D26): a schedule with its calendar, sentence, next fires
 * and frequency warning, or one customer event, optionally for one
 * reservation product (D27).
 */
export function TriggerCard({
  trigger,
  onChange,
  initialPreview,
  errorAt,
  minutesError,
}: {
  readonly trigger: FlowTriggerValue | null;
  readonly onChange: (trigger: FlowTriggerValue) => void;
  readonly initialPreview: CalendarPreviewView | undefined;
  /** Errors at paths below `trigger`, and at `trigger` itself for "". */
  readonly errorAt: FieldErrorLookup;
  readonly minutesError: string | undefined;
}) {
  const locale = useRouteLocale();
  const familyName = useId();
  const familyErrorId = useId();
  const familyError = errorAt("");
  const calendar = useCalendarPreview(initialPreview, "trigger");
  const family = triggerFamilyOf(trigger);

  const chooseFamily = (next: TriggerFamily) => {
    if (next === family) return;
    if (next === "schedule") {
      onChange({ _tag: "Schedule", calendar: defaultScheduleCalendar });
      calendar.refresh(defaultScheduleCalendar);
    } else {
      onChange(eventTrigger("reservation-finished", trigger));
    }
  };
  const setCalendar = (next: CalendarExpression) => {
    onChange({ _tag: "Schedule", calendar: next });
    calendar.refresh(next);
  };

  return (
    <FlowCard
      accent
      icon={family === "event" ? Zap : CalendarClock}
      eyebrow={m.emailAutomationFlowTriggerEyebrow({}, { locale })}
      title={triggerTitle(trigger, locale)}
    >
      <TriggerFamilyPicker
        family={family}
        onChoose={chooseFamily}
        name={familyName}
        errorId={familyErrorId}
        error={familyError}
      />

      {trigger?._tag === "Schedule" && (
        <ScheduleTriggerFields
          calendar={trigger.calendar}
          onChange={setCalendar}
          minutesError={minutesError}
          preview={calendar.preview}
          pending={calendar.pending}
        />
      )}

      {trigger !== null && trigger._tag !== "Schedule" && (
        <EventTriggerFields
          trigger={trigger}
          onChange={onChange}
          errorAt={errorAt}
        />
      )}
    </FlowCard>
  );
}

/**
 * Schedule or event: two large choices while the flow has no trigger, a
 * segmented switch once it has one.
 */
function TriggerFamilyPicker({
  family,
  onChoose,
  name,
  errorId,
  error,
}: {
  readonly family: TriggerFamily | null;
  readonly onChoose: (family: TriggerFamily) => void;
  readonly name: string;
  readonly errorId: string;
  /** The missing trigger's error, shown under the first choice. */
  readonly error: string | undefined;
}) {
  const locale = useRouteLocale();
  return family === null ? (
    <div className="flex flex-col gap-3">
      <p className="text-navy-blue/70 text-sm">
        {m.emailAutomationFlowTriggerChooseDescription({}, { locale })}
      </p>
      <div
        role="radiogroup"
        aria-label={m.emailAutomationFlowTriggerFamilyLabel({}, { locale })}
        {...fieldErrorAttributes(errorId, error !== undefined)}
        className="grid gap-2 @lg:grid-cols-2"
      >
        {(
          [
            [
              "schedule",
              CalendarClock,
              m.emailAutomationFlowTriggerFamilySchedule,
              m.emailAutomationFlowTriggerFamilyScheduleDescription,
            ],
            [
              "event",
              Zap,
              m.emailAutomationFlowTriggerFamilyEvent,
              m.emailAutomationFlowTriggerFamilyEventDescription,
            ],
          ] as const
        ).map(([value, Icon, label, description]) => (
          <ChoiceCard key={value} tone="plain">
            <input
              type="radio"
              name={name}
              value={value}
              checked={false}
              onChange={() => onChoose(value)}
              className="sr-only"
            />
            <Icon
              className="mt-0.5 h-5 w-5 shrink-0 text-burned-orange"
              aria-hidden
            />
            <span>
              <span className="block font-semibold text-sm">
                {label({}, { locale })}
              </span>
              <span className="block text-navy-blue/60 text-sm leading-5">
                {description({}, { locale })}
              </span>
            </span>
          </ChoiceCard>
        ))}
      </div>
      <FieldError id={errorId} messages={[error]} />
    </div>
  ) : (
    <SegmentedControl
      label={m.emailAutomationFlowTriggerFamilyLabel({}, { locale })}
      name={name}
      onValueChange={onChoose}
      options={[
        {
          label: m.emailAutomationFlowTriggerFamilySchedule({}, { locale }),
          value: "schedule",
        },
        {
          label: m.emailAutomationFlowTriggerFamilyEvent({}, { locale }),
          value: "event",
        },
      ]}
      value={family}
    />
  );
}

/**
 * A schedule's calendar with the port's sentence, next starts and, when it
 * fires more than hourly, the frequency warning.
 */
function ScheduleTriggerFields({
  calendar,
  onChange,
  minutesError,
  preview,
  pending,
}: {
  readonly calendar: CalendarExpression;
  readonly onChange: (calendar: CalendarExpression) => void;
  readonly minutesError: string | undefined;
  readonly preview: CalendarPreviewView | undefined;
  readonly pending: boolean;
}) {
  const locale = useRouteLocale();
  const previewMinutesError = scheduleMinutesFailure(preview);
  return (
    <div className="space-y-3">
      <CalendarExpressionEditor
        value={calendar}
        onChange={onChange}
        usage="trigger"
        minutesError={minutesError ?? previewMinutesError}
      />
      <CalendarPreviewText
        preview={previewMinutesError ? undefined : preview}
        pending={pending}
      />
      <CalendarNextStarts preview={preview} locale={locale} />
      {preview?._tag === "Ready" && (
        <AutomationFrequencyBanner
          frequency={preview.frequency}
          locale={locale}
        />
      )}
    </div>
  );
}

function EventTriggerFields({
  trigger,
  onChange,
  errorAt,
}: {
  readonly trigger: EventTrigger;
  readonly onChange: (trigger: EventTrigger) => void;
  readonly errorAt: FieldErrorLookup;
}) {
  const locale = useRouteLocale();
  const kindName = useId();
  const kind = eventTriggerKindOf(trigger);
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 font-semibold text-sm">
          {m.emailAutomationFlowEventKindLabel({}, { locale })}
        </legend>
        <div className="grid gap-2 @lg:grid-cols-2">
          {eventTriggerKinds.map((option) => {
            const { icon: Icon, description } =
              eventTriggerPresentation[option];
            return (
              <ChoiceCard
                key={option}
                tone="plain"
                className={cn(option === "account-created" && "@lg:col-span-2")}
              >
                <input
                  type="radio"
                  name={kindName}
                  value={option}
                  checked={option === kind}
                  onChange={() => onChange(eventTrigger(option, trigger))}
                  className="mt-1"
                />
                <Icon
                  className="mt-0.5 h-5 w-5 shrink-0 text-navy-blue/70"
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-sm">
                    {automationTriggerLabel(option, locale)}
                  </span>
                  <span className="block text-navy-blue/60 text-xs leading-5">
                    {description({}, { locale })}
                  </span>
                </span>
              </ChoiceCard>
            );
          })}
        </div>
      </fieldset>
      {takesProductFilter(trigger) && (
        <div className="space-y-1.5 rounded-lg border border-navy-blue/12 bg-navy-blue/[0.02] p-3">
          <ProductFilterControl
            value={trigger.product}
            onChange={(product) =>
              onChange(
                product === undefined
                  ? { _tag: trigger._tag }
                  : { _tag: trigger._tag, product }
              )
            }
            errorAt={(field) =>
              errorAt(field === "" ? "product" : `product.${field}`)
            }
          />
          <p className="text-navy-blue/55 text-xs leading-5">
            {m.emailAutomationFlowEventProductHint({}, { locale })}
          </p>
        </div>
      )}
    </div>
  );
}
