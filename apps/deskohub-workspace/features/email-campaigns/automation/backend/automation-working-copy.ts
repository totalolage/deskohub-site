import "server-only";

import type { AutomationFlowType as AutomationFlow } from "@deskohub/workspace-admin-api";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import {
  type CampaignAudienceRow,
  type CampaignRow,
  emailCampaignAudiences,
  emailCampaignAutomations,
  emailCampaigns,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomatedCampaignStatus } from "../../campaign-states";
import { CampaignDeliveryMismatch, CampaignNotFound } from "../../errors";
import {
  type AutomationDraftHash,
  hashAutomationDraft,
} from "../automation-draft-hash";
import {
  automationFlowSchema,
  validateAutomationFlow,
} from "../automation-flow";
import { AutomationFlowInvalid } from "../errors";
import type { AutomationEngineTransaction } from "./automation-unit-handler";

export type AutomationRow = typeof emailCampaignAutomations.$inferSelect;

/** An automated campaign row, narrowed to its delivery's statuses. */
export type AutomatedCampaign = CampaignRow & {
  readonly delivery: "automated";
  readonly status: AutomatedCampaignStatus;
};

/**
 * An automated campaign's working copy as stored now: the campaign row, its
 * automation row with the decoded flow, its audience, and the draft hash
 * of what activation would publish. The hash is none until both a flow and
 * an audience exist.
 */
export type AutomationWorkingCopy = {
  readonly campaign: AutomatedCampaign;
  readonly automation: AutomationRow;
  readonly flow: Option.Option<AutomationFlow>;
  readonly audience: Option.Option<
    Pick<CampaignAudienceRow, "id" | "filter" | "archivedAt">
  >;
  readonly draftHash: Option.Option<AutomationDraftHash>;
};

/**
 * Loads an automated campaign's working copy. A one-off campaign fails
 * with `CampaignDeliveryMismatch`, and an automated campaign without its
 * automation row reads as not found. A stored flow that no longer decodes
 * fails `AutomationFlowInvalid`, so the admin can save it again.
 */
export const loadAutomationWorkingCopy = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId
): Effect.Effect<
  AutomationWorkingCopy,
  | CampaignNotFound
  | CampaignDeliveryMismatch
  | AutomationFlowInvalid
  | DatabaseQueryError
> =>
  Effect.Do.pipe(
    Effect.bind("row", () => selectWorkingCopy(tx, campaignId)),
    Effect.bind("flow", ({ row }) => decodeStoredFlow(row.automation.flow)),
    Effect.let("audience", ({ row }) => Option.fromNullishOr(row.audience)),
    Effect.map(
      ({ row, flow, audience }): AutomationWorkingCopy => ({
        campaign: row.campaign,
        automation: row.automation,
        flow,
        audience,
        draftHash: Option.zipWith(flow, audience, (flow, { filter }) =>
          hashAutomationDraft({ ...row.campaign, flow, audienceFilter: filter })
        ),
      })
    ),
    Effect.withSpan("automationWorkingCopy.load")
  );

const selectWorkingCopy = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId
) =>
  tx
    .select({
      campaign: emailCampaigns,
      automation: emailCampaignAutomations,
      audience: {
        id: emailCampaignAudiences.id,
        filter: emailCampaignAudiences.filter,
        archivedAt: emailCampaignAudiences.archivedAt,
      },
    })
    .from(emailCampaigns)
    .leftJoin(
      emailCampaignAutomations,
      eq(emailCampaignAutomations.campaignId, emailCampaigns.id)
    )
    .leftJoin(
      emailCampaignAudiences,
      eq(emailCampaignAudiences.id, emailCampaigns.audienceId)
    )
    .where(eq(emailCampaigns.id, campaignId))
    .pipe(Effect.flatMap(([row]) => automatedWorkingCopyRow(campaignId, row)));

type WorkingCopyRow = {
  readonly campaign: CampaignRow;
  readonly automation: AutomationRow | null;
  readonly audience: Pick<
    CampaignAudienceRow,
    "id" | "filter" | "archivedAt"
  > | null;
};

const automatedWorkingCopyRow = (
  campaignId: CampaignId,
  row: WorkingCopyRow | undefined
): Effect.Effect<
  WorkingCopyRow & {
    readonly campaign: AutomatedCampaign;
    readonly automation: AutomationRow;
  },
  CampaignNotFound | CampaignDeliveryMismatch
> => {
  if (row === undefined) {
    return Effect.fail(new CampaignNotFound({ campaignId }));
  }
  const { campaign, automation, audience } = row;
  if (!isAutomatedCampaign(campaign)) {
    return Effect.fail(
      new CampaignDeliveryMismatch({ campaignId, delivery: campaign.delivery })
    );
  }
  return automation === null
    ? Effect.fail(new CampaignNotFound({ campaignId }))
    : Effect.succeed({ campaign, automation, audience });
};

const isAutomatedCampaign = (
  campaign: CampaignRow
): campaign is AutomatedCampaign => campaign.delivery === "automated";

const decodeFlow = Schema.decodeUnknownEffect(automationFlowSchema);

const decodeStoredFlow = (flow: AutomationRow["flow"]) =>
  flow === null
    ? Effect.succeed(Option.none<AutomationFlow>())
    : decodeFlow(flow).pipe(
        Effect.map(Option.some),
        Effect.mapError(
          (cause) =>
            new AutomationFlowInvalid({
              message: `The saved flow no longer passes the flow rules (${cause.message}). Save the flow again.`,
              cause,
            })
        )
      );

/**
 * A stored flow held to every rule a save applies, for a path that writes
 * it again (duplicating its campaign). A flow saved before a rule existed,
 * such as a schedule off the engine ticks, fails here rather than being
 * copied. None stays none.
 */
export const validateStoredAutomationFlow = (flow: AutomationRow["flow"]) =>
  decodeStoredFlow(flow).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(Option.none<AutomationFlow>()),
        onSome: (decoded) =>
          validateAutomationFlow(decoded).pipe(Effect.map(Option.some)),
      })
    )
  );
