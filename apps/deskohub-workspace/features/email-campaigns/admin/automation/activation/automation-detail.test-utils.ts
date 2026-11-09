import {
  AutomationDetail,
  AutomationFlow,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";

/** The campaign every automation fixture belongs to. */
export const fixtureCampaignId = "synthetic-automation";

/**
 * A flow of a condition on saved audience `regulars`, a two-day wait and the
 * send, with step ids `check`, `pause` and `send`.
 */
export const automationFlowFixture = (
  overrides: Partial<typeof AutomationFlow.Encoded> = {}
): AutomationFlow =>
  Schema.decodeUnknownSync(AutomationFlow)({
    trigger: { _tag: "AccountCreated" },
    steps: [
      {
        _tag: "Condition",
        id: "check",
        filter: { _tag: "InAudience", audienceId: "regulars", operator: "in" },
      },
      {
        _tag: "Wait",
        id: "pause",
        wait: { _tag: "Duration", count: 2, unit: "day" },
      },
      { _tag: "Send", id: "send" },
    ],
    ...overrides,
  });

/** A draft automation of `fixtureCampaignId`, decoded like the port's output. */
export const automationDetailFixture = (
  overrides: Partial<typeof AutomationDetail.Encoded> = {}
): AutomationDetail =>
  Schema.decodeUnknownSync(AutomationDetail)({
    campaignId: fixtureCampaignId,
    status: "draft",
    flow: Schema.encodeSync(AutomationFlow)(automationFlowFixture()),
    trigger: { kind: "account-created", frequency: null },
    activeVersion: null,
    versionCount: 0,
    acceptingSince: null,
    pausedAt: null,
    archivedAt: null,
    nextFireAt: null,
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  });

/** An active version summary for `automationDetailFixture({ activeVersion })`. */
export const activeVersionFixture = (versionNumber = 1) => ({
  campaignId: fixtureCampaignId,
  versionNumber,
  trigger: { kind: "account-created" as const, frequency: null },
  draftHash: `hash-${versionNumber}`,
  activatedAt: "2026-10-02T08:00:00.000Z",
  audienceId: null,
  activatedByEmail: null,
  active: true,
});
