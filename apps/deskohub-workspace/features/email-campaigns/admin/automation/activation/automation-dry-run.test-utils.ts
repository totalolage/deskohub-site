import { AutomationDryRun } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { fixtureCampaignId } from "./automation-detail.test-utils";

/**
 * A completed replay dry run of `fixtureCampaignId` with no rows, decoded
 * like the port's output.
 */
export const automationDryRunFixture = (
  overrides: Partial<typeof AutomationDryRun.Encoded> = {}
): AutomationDryRun =>
  Schema.decodeSync(AutomationDryRun)({
    previewId: "preview-1",
    campaignId: fixtureCampaignId,
    draftHash: "hash",
    kind: "replay",
    status: "completed",
    asOf: "2026-10-05T08:00:00.000Z",
    unitsDone: 1,
    unitsTotal: 1,
    errorCode: null,
    createdAt: "2026-10-05T07:59:00.000Z",
    completedAt: "2026-10-05T08:00:00.000Z",
    nextFires: [],
    frequency: null,
    eventsTotal: null,
    rows: [],
    nextCursor: null,
    customers: [],
    emails: [],
    ...overrides,
  });
