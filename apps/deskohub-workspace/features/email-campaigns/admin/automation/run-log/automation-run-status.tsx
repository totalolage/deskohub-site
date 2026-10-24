import {
  AdministrationCampaignRecipientSkipReason,
  AutomationRunFailureReason,
  type AutomationRunOutcome,
  type AutomationRunSummary,
} from "@deskohub/workspace-admin-api";
import { Option, Schema } from "effect";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  StatusBadge,
  type StatusTone,
} from "@/shared/components/ui/status-badge";

/** Why a recipient was skipped, as the end of "Skipped · …". */
export const automationRunSkipReasonLabel = (
  reason: AdministrationCampaignRecipientSkipReason,
  locale: Locale
) =>
  ({
    "outside-test-domain": m.emailAutomationRunsSkipOutsideTestDomain,
    "consent-withdrawn": m.emailAutomationRunsSkipConsentWithdrawn,
    "missing-email": m.emailAutomationRunsSkipMissingEmail,
    "invalid-email": m.emailAutomationRunsSkipInvalidEmail,
    "deleted-customer": m.emailAutomationRunsSkipDeletedCustomer,
    "missing-from-dotypos": m.emailAutomationRunsSkipMissingFromDotypos,
  })[reason]({}, { locale });

/** Why a run failed, as the end of "Failed · …". */
export const automationRunFailureReasonLabel = (
  reason: AutomationRunFailureReason,
  locale: Locale
) =>
  ({
    "delivery-refused": m.emailAutomationRunsFailureDeliveryRefused,
    "evaluation-unavailable": m.emailAutomationRunsFailureEvaluationUnavailable,
  })[reason]({}, { locale });

/** How an ended run's outcome reads on its own, without a reason. */
export const automationRunOutcomeLabel = (
  outcome: AutomationRunOutcome,
  locale: Locale
) =>
  ({
    sent: m.emailAutomationRunsOutcomeSent,
    unconfirmed: m.emailAutomationRunsOutcomeUnconfirmed,
    "condition-failed": m.emailAutomationRunsOutcomeConditionFailed,
    skipped: m.emailAutomationRunsOutcomeSkipped,
    failed: m.emailAutomationRunsOutcomeFailed,
    withdrawn: m.emailAutomationRunsOutcomeWithdrawn,
    archived: m.emailAutomationRunsOutcomeArchived,
  })[outcome]({}, { locale });

const outcomeTones = {
  sent: "positive",
  unconfirmed: "attention",
  "condition-failed": "neutral",
  skipped: "neutral",
  failed: "attention",
  withdrawn: "neutral",
  archived: "neutral",
} satisfies Record<AutomationRunOutcome, StatusTone>;

/** An ended run's outcome with its reason: "Skipped · non-test recipient". */
const endedLabel = (
  outcome: AutomationRunOutcome,
  reason: string | null,
  locale: Locale
) => {
  const skip = Schema.decodeUnknownOption(
    AdministrationCampaignRecipientSkipReason
  )(reason);
  const failure = Schema.decodeUnknownOption(AutomationRunFailureReason)(
    reason
  );
  if (outcome === "skipped" && Option.isSome(skip)) {
    return m.emailAutomationRunsOutcomeSkippedBecause(
      { reason: automationRunSkipReasonLabel(skip.value, locale) },
      { locale }
    );
  }
  if (outcome === "failed" && Option.isSome(failure)) {
    return m.emailAutomationRunsOutcomeFailedBecause(
      { reason: automationRunFailureReasonLabel(failure.value, locale) },
      { locale }
    );
  }
  return automationRunOutcomeLabel(outcome, locale);
};

/**
 * Where a run stands: waiting until a time, sending, or how it ended and
 * why.
 */
/** How a run still under way reads: sending, waiting until, or in progress. */
const activeLabel = (
  run: Pick<AutomationRunSummary, "dueAt" | "phase" | "state">,
  locale: Locale
) => {
  if (run.state === "sending") {
    return m.emailAutomationRunsStatusSending({}, { locale });
  }
  return run.dueAt !== null && run.phase === "waiting"
    ? m.emailAutomationRunsStatusWaitingUntil(
        { date: formatAdministrationDateTime(run.dueAt, locale) },
        { locale }
      )
    : m.emailAutomationRunsStatusInProgress({}, { locale });
};

export function AutomationRunStatus({
  locale,
  run,
}: {
  readonly locale: Locale;
  readonly run: Pick<
    AutomationRunSummary,
    "dueAt" | "outcome" | "outcomeReason" | "phase" | "state"
  >;
}) {
  if (run.outcome !== null) {
    return (
      <StatusBadge tone={outcomeTones[run.outcome]}>
        {endedLabel(run.outcome, run.outcomeReason, locale)}
      </StatusBadge>
    );
  }
  return <StatusBadge tone="progress">{activeLabel(run, locale)}</StatusBadge>;
}
