import type { AutomationEngineHealth } from "@deskohub/workspace-admin-api";
import { Result } from "effect";
import {
  AdministrationAlert,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { cn } from "@/shared/utils";
import type { AutomationRunLogFailure } from "./automation-run-log.server";

const minute = 60;
const hour = 60 * minute;
const day = 24 * hour;

/** A lag or a run time in whole minutes, hours or days: "12 minutes". */
const formatDuration = (seconds: number, locale: Locale) => {
  if (seconds < 90 * minute) {
    return m.emailAutomationRunsDurationMinutes(
      { count: Math.max(1, Math.round(seconds / minute)) },
      { locale }
    );
  }
  return seconds < 2 * day
    ? m.emailAutomationRunsDurationHours(
        { count: Math.round(seconds / hour) },
        { locale }
      )
    : m.emailAutomationRunsDurationDays(
        { count: Math.round(seconds / day) },
        { locale }
      );
};

/** How long ago `at` was when the page read the health: "4 minutes ago". */
const formatAge = (at: string, checkedAt: number, locale: Locale) => {
  const seconds = Math.max(0, (checkedAt - Date.parse(at)) / 1000);
  if (seconds < minute) return m.emailAutomationRunsAgeJustNow({}, { locale });
  if (seconds < 90 * minute) {
    return m.emailAutomationRunsAgeMinutes(
      { count: Math.round(seconds / minute) },
      { locale }
    );
  }
  return seconds < 2 * day
    ? m.emailAutomationRunsAgeHours(
        { count: Math.round(seconds / hour) },
        { locale }
      )
    : m.emailAutomationRunsAgeDays(
        { count: Math.round(seconds / day) },
        { locale }
      );
};

/** One engine-wide warning, with the numbers behind it. */
const warningLine = (
  warning: AutomationEngineHealth["warnings"][number],
  health: AutomationEngineHealth,
  checkedAt: number,
  locale: Locale
): string => {
  switch (warning) {
    case "planner-stale":
      return health.lastPlannedAt === null
        ? m.emailAutomationRunsHealthPlannerNeverRan({}, { locale })
        : m.emailAutomationRunsHealthPlannerStale(
            { age: formatAge(health.lastPlannedAt, checkedAt, locale) },
            { locale }
          );
    case "sweep-lagging":
      return health.sweepLagSeconds === null
        ? m.emailAutomationRunsHealthSweepLaggingUnknown({}, { locale })
        : m.emailAutomationRunsHealthSweepLagging(
            { duration: formatDuration(health.sweepLagSeconds, locale) },
            { locale }
          );
    case "event-backlog":
      return health.oldestUnprocessedEventAt === null
        ? m.emailAutomationRunsHealthEventBacklogUnknown({}, { locale })
        : m.emailAutomationRunsHealthEventBacklog(
            {
              date: formatAdministrationDateTime(
                health.oldestUnprocessedEventAt,
                locale
              ),
            },
            { locale }
          );
    case "unit-backlog":
      return health.oldestPlannedUnitAt === null
        ? m.emailAutomationRunsHealthUnitBacklogUnknown({}, { locale })
        : m.emailAutomationRunsHealthUnitBacklog(
            {
              date: formatAdministrationDateTime(
                health.oldestPlannedUnitAt,
                locale
              ),
            },
            { locale }
          );
    case "schedule-lagging":
      return m.emailAutomationRunsHealthScheduleLagging({}, { locale });
    case "falling-behind":
      return m.emailAutomationRunsHealthFallingBehind({}, { locale });
  }
};

/** What the engine reports about this campaign's own schedule. */
const campaignLines = (
  health: AutomationEngineHealth,
  campaignId: string,
  locale: Locale
) => {
  const automation = health.automations.find(
    (entry) => entry.campaignId === campaignId
  );
  if (automation === undefined) return [];
  const { enteringFire, lastFire, scheduleLagSeconds } = automation;
  return [
    health.warnings.includes("schedule-lagging") &&
      scheduleLagSeconds !== null &&
      scheduleLagSeconds > 0 &&
      m.emailAutomationRunsHealthCampaignScheduleLag(
        { duration: formatDuration(scheduleLagSeconds, locale) },
        { locale }
      ),
    enteringFire !== null &&
      m.emailAutomationRunsHealthCampaignEnteringFire(
        {
          date: formatAdministrationDateTime(enteringFire.fireAt, locale),
          done: enteringFire.chunksDone,
          total: enteringFire.chunksTotal,
        },
        { locale }
      ),
    lastFire?.fallingBehind === true &&
      (lastFire.intervalSeconds === null
        ? m.emailAutomationRunsHealthCampaignFallingBehindUnknown(
            { duration: formatDuration(lastFire.durationSeconds, locale) },
            { locale }
          )
        : m.emailAutomationRunsHealthCampaignFallingBehind(
            {
              duration: formatDuration(lastFire.durationSeconds, locale),
              interval: formatDuration(lastFire.intervalSeconds, locale),
            },
            { locale }
          )),
  ].filter((line) => line !== false);
};

/**
 * One line on whether the engine that runs every automation keeps up, and a
 * warning with the numbers when it doesn't or this campaign's schedule is
 * mid-fire or behind.
 */
export function AutomationEngineHealthIndicator({
  campaignId,
  checkedAt,
  health,
  locale,
}: {
  readonly campaignId: string;
  readonly checkedAt: number;
  readonly health: Result.Result<
    AutomationEngineHealth,
    AutomationRunLogFailure
  >;
  readonly locale: Locale;
}) {
  if (Result.isFailure(health)) {
    return (
      <p className="flex items-center gap-2 text-sm text-navy-blue/65">
        <span aria-hidden className="size-2 rounded-full bg-navy-blue/35" />
        {m.emailAutomationRunsHealthUnavailable({}, { locale })}
      </p>
    );
  }
  const report = health.success;
  const warnings = report.warnings.map((warning) =>
    warningLine(warning, report, checkedAt, locale)
  );
  const campaign = campaignLines(report, campaignId, locale);
  const lastPlanned =
    report.lastPlannedAt === null
      ? m.emailAutomationRunsHealthNotPlannedYet({}, { locale })
      : formatAge(report.lastPlannedAt, checkedAt, locale);
  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-2 text-sm text-navy-blue/65">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            warnings.length === 0 ? "bg-aquamarine-ink" : "bg-burned-orange"
          )}
        />
        {warnings.length === 0
          ? m.emailAutomationRunsHealthRunning({ lastPlanned }, { locale })
          : m.emailAutomationRunsHealthBehind({ lastPlanned }, { locale })}
      </p>
      {(warnings.length > 0 || campaign.length > 0) && (
        <AdministrationAlert status="warning">
          <p className="font-semibold">
            {warnings.length > 0
              ? m.emailAutomationRunsHealthWarningTitle({}, { locale })
              : m.emailAutomationRunsHealthCampaignTitle({}, { locale })}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {[...warnings, ...campaign].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </AdministrationAlert>
      )}
    </div>
  );
}
