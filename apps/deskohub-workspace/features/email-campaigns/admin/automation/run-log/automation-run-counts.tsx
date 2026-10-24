import {
  AdministrationCampaignRecipientSkipReason,
  type AutomationFlow,
  type AutomationRunStats,
} from "@deskohub/workspace-admin-api";
import type { ReactNode } from "react";
import { AdministrationLink } from "@/features/administration/admin-link";
import { m } from "@/features/administration/i18n";
import type { AdministrationListParams } from "@/features/administration/list-href";
import type { Locale } from "@/features/i18n";
import { formatCount } from "@/shared/utils/number";
import { upperCaseFirst } from "@/shared/utils/text-case";
import { automationRunSkipReasonLabel } from "./automation-run-status";
import { automationStepLabelOrId } from "./automation-step-label";

interface CountLine {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly params: AdministrationListParams;
}

function CountTile({
  breakdown = [],
  count,
  href,
  label,
  locale,
  tone = "neutral",
}: {
  readonly breakdown?: readonly CountLine[];
  readonly count: number;
  readonly href: (params: AdministrationListParams) => string;
  readonly label: string;
  readonly locale: Locale;
  readonly tone?: "neutral" | "positive" | "attention";
}) {
  return (
    <li className="flex flex-col rounded-xl border border-navy-blue/10 bg-white p-4">
      <AdministrationLink
        className="group grid gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
        href={href({})}
      >
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-blue/65 group-hover:text-navy-blue">
          {label}
        </span>
        <span
          className={
            {
              neutral: "text-2xl font-semibold tabular-nums",
              positive:
                "text-2xl font-semibold tabular-nums text-aquamarine-ink",
              attention:
                "text-2xl font-semibold tabular-nums text-burned-orange-ink",
            }[count === 0 ? "neutral" : tone]
          }
        >
          {formatCount(count, locale)}
        </span>
      </AdministrationLink>
      {breakdown.length > 0 && (
        <ul className="mt-3 grid gap-1 border-t border-navy-blue/10 pt-3 text-sm">
          {breakdown.map((line) => (
            <li key={line.key}>
              <AdministrationLink
                className="flex items-baseline justify-between gap-3 text-navy-blue/70 hover:text-navy-blue hover:underline"
                href={href(line.params)}
              >
                <span className="min-w-0">{line.label}</span>
                <span className="tabular-nums">
                  {formatCount(line.count, locale)}
                </span>
              </AdministrationLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Runs by state (D22): waiting at each step, sent, ended at a condition,
 * failed, skipped, withdrawn and archived. Each count opens the list
 * filtered to it.
 */
export function AutomationRunCounts({
  flow,
  href,
  locale,
  scope,
  stats,
}: {
  readonly flow: AutomationFlow | null;
  /** The run list with the counts' version and `params`. */
  readonly href: (params: AdministrationListParams) => string;
  readonly locale: Locale;
  /** Which versions the counts cover, such as "All versions". */
  readonly scope: ReactNode;
  readonly stats: AutomationRunStats;
}) {
  const stepLabel = (stepId: string) =>
    automationStepLabelOrId({ flow, stepId, locale });
  const tileHref =
    (params: AdministrationListParams) => (extra: AdministrationListParams) =>
      href({ ...params, ...extra });
  const { byOutcome, bySkipReason, byState, bySteps } = stats;
  return (
    <section aria-labelledby="automation-run-counts" className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-blue/65"
          id="automation-run-counts"
        >
          {m.emailAutomationRunsCountsTitle({}, { locale })}
        </h2>
        <span className="text-sm text-navy-blue/65">{scope}</span>
      </div>
      <ul className="grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
        <CountTile
          breakdown={[
            ...bySteps
              .filter((step) => step.byState.active > 0)
              .map((step) => ({
                key: step.stepId,
                label: stepLabel(step.stepId),
                count: step.byState.active,
                params: { step: step.stepId },
              })),
            ...(byState.sending > 0
              ? [
                  {
                    key: "sending",
                    label: m.emailAutomationRunsCountsSendingNow(
                      {},
                      { locale }
                    ),
                    count: byState.sending,
                    params: { state: "sending" },
                  },
                ]
              : []),
          ]}
          // The waiting runs its link lists; sending ones have their own line.
          count={byState.active}
          href={tileHref({ state: "active" })}
          label={m.emailAutomationRunsCountsWaiting({}, { locale })}
          locale={locale}
        />
        <CountTile
          breakdown={
            byOutcome.unconfirmed > 0
              ? [
                  {
                    key: "unconfirmed",
                    label: m.emailAutomationRunsOutcomeUnconfirmed(
                      {},
                      { locale }
                    ),
                    count: byOutcome.unconfirmed,
                    params: { outcome: "unconfirmed" },
                  },
                ]
              : []
          }
          count={byOutcome.sent}
          href={tileHref({ outcome: "sent" })}
          label={m.emailAutomationRunsCountsSent({}, { locale })}
          locale={locale}
          tone="positive"
        />
        <CountTile
          breakdown={bySteps
            .filter((step) => step.byOutcome["condition-failed"] > 0)
            .map((step) => ({
              key: step.stepId,
              label: stepLabel(step.stepId),
              count: step.byOutcome["condition-failed"],
              params: { step: step.stepId },
            }))}
          count={byOutcome["condition-failed"]}
          href={tileHref({ outcome: "condition-failed" })}
          label={m.emailAutomationRunsOutcomeConditionFailed({}, { locale })}
          locale={locale}
        />
        <CountTile
          count={byOutcome.failed}
          href={tileHref({ outcome: "failed" })}
          label={m.emailAutomationRunsCountsFailed({}, { locale })}
          locale={locale}
          tone="attention"
        />
        <CountTile
          breakdown={AdministrationCampaignRecipientSkipReason.literals
            .filter((reason) => bySkipReason[reason] > 0)
            .map((reason) => ({
              key: reason,
              label: upperCaseFirst(
                automationRunSkipReasonLabel(reason, locale),
                locale
              ),
              count: bySkipReason[reason],
              params: { skipReason: reason },
            }))}
          count={byOutcome.skipped}
          href={tileHref({ outcome: "skipped" })}
          label={m.emailAutomationRunsCountsSkipped({}, { locale })}
          locale={locale}
        />
        <CountTile
          count={byOutcome.withdrawn}
          href={tileHref({ outcome: "withdrawn" })}
          label={m.emailAutomationRunsOutcomeWithdrawn({}, { locale })}
          locale={locale}
        />
        {byOutcome.archived > 0 && (
          <CountTile
            count={byOutcome.archived}
            href={tileHref({ outcome: "archived" })}
            label={m.emailAutomationRunsCountsArchived({}, { locale })}
            locale={locale}
          />
        )}
      </ul>
    </section>
  );
}
