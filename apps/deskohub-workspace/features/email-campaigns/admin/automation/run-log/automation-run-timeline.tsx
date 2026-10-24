import {
  type AutomationFlow,
  type AutomationRunEventDetail,
  AutomationRunEventKind,
  type AutomationRunTimelineEntry,
  automationRunEventDetails,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { cn } from "@/shared/utils";
import {
  type ConditionWording,
  describeFailedConditions,
} from "./automation-condition-failures";
import {
  automationRunFailureReasonLabel,
  automationRunSkipReasonLabel,
} from "./automation-run-status";
import { automationStepLabelOrId } from "./automation-step-label";

type KnownEntry = {
  readonly [K in AutomationRunEventKind]: {
    readonly kind: K;
    readonly detail: AutomationRunEventDetail<K>;
  };
}[AutomationRunEventKind];

/**
 * Whether the entry is of a kind this page words and carries that kind's
 * detail. A known kind with a detail the client can't read decodes as a
 * generic entry, so the kind alone doesn't make it readable.
 */
const isKnownEntry = (
  entry: AutomationRunTimelineEntry
): entry is AutomationRunTimelineEntry & KnownEntry =>
  Schema.is(AutomationRunEventKind)(entry.kind) &&
  Schema.is(automationRunEventDetails[entry.kind])(entry.detail);

interface EntryCopy {
  readonly title: string;
  readonly details: readonly string[];
  readonly tone: "positive" | "warning" | "neutral";
}

const entryCopy = (
  entry: AutomationRunTimelineEntry,
  context: TimelineContext
): EntryCopy => {
  const { locale } = context;
  const options = { locale };
  const plain = (title: string, tone: EntryCopy["tone"] = "neutral") => ({
    title,
    details: [],
    tone,
  });
  if (!isKnownEntry(entry)) {
    return plain(
      m.emailAutomationRunsEventUnknown({ kind: entry.kind }, options)
    );
  }
  switch (entry.kind) {
    case "started":
      return plain(m.emailAutomationRunsEventStarted({}, options));
    case "condition-passed":
      return plain(
        m.emailAutomationRunsEventConditionPassed({}, options),
        "positive"
      );
    case "condition-failed":
      return {
        title: m.emailAutomationRunsEventConditionFailed({}, options),
        details: describeFailedConditions({
          failedConditions: entry.detail.failedConditions,
          flow: context.flow,
          locale,
          stepId: entry.stepId,
          wording: context.conditionWording,
        }).map((clause) =>
          m.emailAutomationRunsEventConditionFailedClause({ clause }, options)
        ),
        tone: "neutral",
      };
    case "waiting":
      return plain(
        m.emailAutomationRunsEventWaiting(
          { date: formatAdministrationDateTime(entry.detail.dueAt, locale) },
          options
        )
      );
    case "woke":
      return plain(m.emailAutomationRunsEventWoke({}, options));
    case "deferred":
      return plain(
        m.emailAutomationRunsEventDeferred(
          {
            date: formatAdministrationDateTime(entry.detail.recheckAt, locale),
          },
          options
        )
      );
    case "send-queued":
      return plain(m.emailAutomationRunsEventSendQueued({}, options));
    case "sent":
      return plain(m.emailAutomationRunsEventSent({}, options), "positive");
    case "unconfirmed":
      return {
        title: m.emailAutomationRunsEventUnconfirmed({}, options),
        details: [m.emailAutomationRunsEventUnconfirmedDetail({}, options)],
        tone: "warning",
      };
    case "skipped":
      return plain(
        m.emailAutomationRunsOutcomeSkippedBecause(
          { reason: automationRunSkipReasonLabel(entry.detail.reason, locale) },
          options
        )
      );
    case "failed":
      return plain(
        m.emailAutomationRunsOutcomeFailedBecause(
          {
            reason: automationRunFailureReasonLabel(
              entry.detail.reason,
              locale
            ),
          },
          options
        ),
        "warning"
      );
    case "withdrawn":
      return {
        title: m.emailAutomationRunsOutcomeWithdrawn({}, options),
        details: [m.emailAutomationRunsEventWithdrawnDetail({}, options)],
        tone: "neutral",
      };
    case "archived":
      return {
        title: m.emailAutomationRunsOutcomeArchived({}, options),
        details: [m.emailAutomationRunsEventArchivedDetail({}, options)],
        tone: "neutral",
      };
  }
};

interface TimelineContext {
  readonly flow: AutomationFlow | null;
  readonly conditionWording: ConditionWording;
  readonly locale: Locale;
}

/**
 * A run's steps in order: each entry with what happened, the step it
 * happened at, and when (Prague time).
 */
export function AutomationRunTimeline({
  conditionWording,
  entries,
  flow,
  locale,
}: TimelineContext & {
  readonly entries: readonly AutomationRunTimelineEntry[];
}) {
  return (
    <ol
      aria-label={m.emailAutomationRunsTimelineLabel({}, { locale })}
      className="relative"
    >
      {entries.map((entry, index) => {
        const { details, title, tone } = entryCopy(entry, {
          conditionWording,
          flow,
          locale,
        });
        return (
          <li
            className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-4 pb-7 last:pb-0"
            key={entry.sequence}
          >
            {index < entries.length - 1 && (
              <span className="absolute left-[0.59rem] top-5 h-[calc(100%-0.25rem)] w-px bg-navy-blue/12" />
            )}
            <span
              className={cn(
                "relative z-10 mt-1 size-5 rounded-full border-4 border-white",
                {
                  positive: "bg-aquamarine-ink",
                  warning: "bg-burned-orange",
                  neutral: "bg-navy-blue/35",
                }[tone]
              )}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-semibold">{title}</h3>
                <time
                  className="text-xs text-navy-blue/65 tabular-nums"
                  dateTime={entry.at}
                >
                  {formatAdministrationDateTime(entry.at, locale)}
                </time>
              </div>
              {entry.stepId !== null && (
                <p className="mt-0.5 text-sm text-navy-blue/65">
                  {automationStepLabelOrId({
                    flow,
                    stepId: entry.stepId,
                    locale,
                  })}
                </p>
              )}
              {details.length > 0 && (
                <ul className="mt-2 grid gap-1 text-sm leading-5 text-navy-blue/75">
                  {details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
