import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { StatusTone } from "@/shared/components/ui/status-badge";
import { automationRunFixture } from "./automation-run.test-utils";
import {
  AutomationRunStatus,
  automationRunFailureReasonLabel,
  automationRunOutcomeLabel,
  automationRunSkipReasonLabel,
} from "./automation-run-status";

const dueAt = "2026-10-06T07:30:00.000Z";

/** The badge a run renders: its tone and its label. */
const badgeOf = (
  overrides: Parameters<typeof automationRunFixture>[0],
  locale: Locale = "en-US"
) => {
  const badge = AutomationRunStatus({
    locale,
    run: automationRunFixture(overrides),
  }) as ReactElement<{ children: string; tone: StatusTone }>;
  return { label: badge.props.children, tone: badge.props.tone };
};

const activeRun = { state: "active", outcome: null, endedAt: null } as const;

describe("AutomationRunStatus", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "a sending run reads as sending in %s, whatever its phase",
    (locale) => {
      for (const phase of ["waiting", "ready", null] as const) {
        expect(
          badgeOf({ ...activeRun, state: "sending", phase, dueAt }, locale)
        ).toEqual({
          label: m.emailAutomationRunsStatusSending({}, { locale }),
          tone: "progress",
        });
      }
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "a waiting run with a due time reads as waiting until it in %s",
    (locale) => {
      expect(
        badgeOf({ ...activeRun, phase: "waiting", dueAt }, locale)
      ).toEqual({
        label: m.emailAutomationRunsStatusWaitingUntil(
          { date: formatAdministrationDateTime(dueAt, locale) },
          { locale }
        ),
        tone: "progress",
      });
    }
  );

  test("an active run reads as in progress unless it waits with a due time", () => {
    const inProgress = {
      label: m.emailAutomationRunsStatusInProgress({}, { locale: "en-US" }),
      tone: "progress",
    };

    expect(badgeOf({ ...activeRun, phase: "waiting", dueAt: null })).toEqual(
      inProgress
    );
    expect(badgeOf({ ...activeRun, phase: "ready", dueAt })).toEqual(
      inProgress
    );
    expect(badgeOf({ ...activeRun, phase: null, dueAt: null })).toEqual(
      inProgress
    );
  });

  test("an ended run reads as its outcome, with the reason it carries", () => {
    const locale = "en-US";

    expect(
      badgeOf({ outcome: "skipped", outcomeReason: "missing-email" })
    ).toEqual({
      label: m.emailAutomationRunsOutcomeSkippedBecause(
        { reason: automationRunSkipReasonLabel("missing-email", locale) },
        { locale }
      ),
      tone: "neutral",
    });
    expect(
      badgeOf({ outcome: "failed", outcomeReason: "delivery-refused" })
    ).toEqual({
      label: m.emailAutomationRunsOutcomeFailedBecause(
        {
          reason: automationRunFailureReasonLabel("delivery-refused", locale),
        },
        { locale }
      ),
      tone: "attention",
    });
    expect(badgeOf({ outcome: "sent" })).toEqual({
      label: automationRunOutcomeLabel("sent", locale),
      tone: "positive",
    });
  });

  test("an ended run's reason of the wrong kind reads as the bare outcome", () => {
    const locale = "en-US";

    expect(
      badgeOf({ outcome: "skipped", outcomeReason: "delivery-refused" })
    ).toEqual({
      label: automationRunOutcomeLabel("skipped", locale),
      tone: "neutral",
    });
    expect(
      badgeOf({ outcome: "failed", outcomeReason: "missing-email" })
    ).toEqual({
      label: automationRunOutcomeLabel("failed", locale),
      tone: "attention",
    });
  });
});
