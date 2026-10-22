import type { DotyposCustomerId } from "@deskohub/dotypos";
import type {
  AutomationFlowType as AutomationFlow,
  AutomationTriggerType as AutomationTrigger,
} from "@deskohub/workspace-admin-api";
import { inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  emailCampaignAutomationRuns,
  emailCampaignAutomationScheduleFires,
  emailCampaignAutomations,
  emailCampaignAutomationTriggerReceipts,
  emailCampaignAutomationVersions,
  emailCampaignAutomationWorkUnits,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import type { AudienceFilter } from "../audience-filter";
import type { AutomationVersionId } from "../automation/automation-identifiers";
import type {
  CampaignLocalizedContent,
  CampaignPurpose,
} from "../body/campaign-content";
import { hashCampaignContent } from "../body/campaign-content-hash";
import type {
  CampaignAudienceId,
  CampaignId,
  CampaignSendId,
} from "../campaign-identifiers";
import type {
  automatedCampaignStatuses,
  CampaignRecipientStatus,
  CampaignStatus,
} from "../campaign-states";

export const everyoneFilter: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [],
};

/** Czech-only campaign content whose body is one paragraph of `text`. */
export const campaignContentFixture = (
  text = "Ahoj"
): CampaignLocalizedContent => ({
  "cs-CZ": {
    subject: "Novinky",
    preheader: "Co je nového",
    body: {
      formatVersion: 1,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    },
  },
});

/**
 * A flow whose condition step requires customers to be in the saved
 * audience `audienceId`, nested in a group as the builder stores it.
 */
export const audienceConditionFlowFixture = (
  audienceId: CampaignAudienceId
) => ({
  trigger: { _tag: "ReservationBooked" },
  steps: [
    {
      _tag: "Condition",
      id: "step-regulars",
      filter: {
        _tag: "Group",
        operator: "and",
        filters: [{ _tag: "InAudience", audienceId, operator: "in" }],
      },
    },
    { _tag: "Send", id: "step-send" },
  ],
});

type SeededRecipient = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly deliveryAttempt?: number;
  readonly status?: CampaignRecipientStatus;
  readonly providerMessageId?: string;
};

/** Inserts a send of `campaignId` with its frozen recipients. */
const insertSend = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly campaignId: CampaignId;
    readonly automationVersionId?: AutomationVersionId;
    readonly purpose: CampaignPurpose;
    readonly content: CampaignLocalizedContent;
    readonly deliveryAttempt?: number;
    readonly recipients: readonly SeededRecipient[];
  }
): Promise<CampaignSendId> => {
  const [send] = await Effect.runPromise(
    db
      .insert(emailCampaignSends)
      .values({
        campaignId: input.campaignId,
        automationVersionId: input.automationVersionId,
        audienceFilter: everyoneFilter,
        contentHash: hashCampaignContent({
          purpose: input.purpose,
          templateKey: "workspace",
          locales: input.content,
        }),
        deliveryAttempt: input.deliveryAttempt ?? 1,
      })
      .returning()
  );
  if (input.recipients.length > 0) {
    await Effect.runPromise(
      db.insert(emailCampaignRecipients).values(
        input.recipients.map((recipient) => ({
          ...recipient,
          skipReason:
            recipient.status === "skipped" ? ("missing-email" as const) : null,
          sendId: send!.id,
          locale: "cs-CZ" as const,
        }))
      )
    );
  }
  return send!.id;
};

/**
 * Inserts a campaign in `status` with its frozen send and recipients, as a
 * confirmed send leaves them, and returns their IDs.
 */
export const seedCampaignSend = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly purpose: CampaignPurpose;
    readonly status?: CampaignStatus;
    readonly deliveryAttempt?: number;
    readonly recipients: readonly SeededRecipient[];
  }
) => {
  const content = campaignContentFixture();
  const [campaign] = await Effect.runPromise(
    db
      .insert(emailCampaigns)
      .values({
        title: "Autumn news",
        purpose: input.purpose,
        templateKey: "workspace",
        content,
        status: input.status ?? "sending",
      })
      .returning()
  );
  const sendId = await insertSend(db, {
    ...input,
    campaignId: campaign!.id,
    content,
  });
  return { campaignId: campaign!.id, sendId };
};

/**
 * Inserts an automated campaign in `status` (Active by default) whose own
 * purpose and content differ from anything its versions publish.
 */
export const seedAutomatedCampaign = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly purpose: CampaignPurpose;
    readonly status?: (typeof automatedCampaignStatuses)[number];
  }
) => {
  const [campaign] = await Effect.runPromise(
    db
      .insert(emailCampaigns)
      .values({
        title: "Come back soon",
        purpose: input.purpose,
        templateKey: "workspace",
        content: campaignContentFixture("Rozpracovaný koncept"),
        delivery: "automated",
        status: input.status ?? "active",
      })
      .returning({ id: emailCampaigns.id })
  );
  return campaign!.id;
};

/**
 * Publishes version `versionNumber` of `campaignId` with `purpose` and the
 * content `text`, as activation will. `trigger` and `activatedAt` default to
 * a placeholder trigger and an activation ordered by version number; `flow`
 * replaces the whole stored flow, including its trigger. Pass `flow` where
 * the engine decodes the version's flow: the placeholder flow built from
 * `trigger` doesn't decode.
 */
export const seedAutomationVersion = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly campaignId: CampaignId;
    readonly purpose: CampaignPurpose;
    readonly versionNumber?: number;
    readonly text?: string;
    readonly trigger?: AutomationTrigger;
    readonly audienceFilter?: AudienceFilter;
    readonly activatedAt?: Temporal.Instant;
    readonly flow?: unknown;
  }
) => {
  const content = campaignContentFixture(input.text ?? "Verze");
  const [version] = await Effect.runPromise(
    db
      .insert(emailCampaignAutomationVersions)
      .values({
        campaignId: input.campaignId,
        versionNumber: input.versionNumber ?? 1,
        flow: input.flow ?? {
          trigger: input.trigger ?? { _tag: "reservation-booked" },
          steps: [],
        },
        purpose: input.purpose,
        templateKey: "workspace",
        content,
        contentHash: hashCampaignContent({
          purpose: input.purpose,
          templateKey: "workspace",
          locales: content,
        }),
        audienceFilter: input.audienceFilter ?? everyoneFilter,
        draftHash: `draft-${input.versionNumber ?? 1}`,
        activatedAt:
          input.activatedAt ??
          sql`now() + make_interval(secs => ${input.versionNumber ?? 1})`,
      })
      .returning({ id: emailCampaignAutomationVersions.id })
  );
  return version!.id;
};

/**
 * Inserts the automation row of `campaignId` with `activeVersionId` in
 * force, as activation and the lifecycle operations leave it. `flow`, the
 * working copy, defaults to the active version's flow.
 */
export const seedAutomation = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly campaignId: CampaignId;
    readonly activeVersionId: AutomationVersionId;
    readonly flow?: AutomationFlow;
    readonly acceptingSince?: Temporal.Instant | null;
    readonly pausedAt?: Temporal.Instant | null;
    readonly resumedAt?: Temporal.Instant | null;
    readonly nextFireAt?: Temporal.Instant | null;
  }
) => {
  await Effect.runPromise(
    db.insert(emailCampaignAutomations).values({
      campaignId: input.campaignId,
      flow:
        input.flow ??
        sql`(select ${emailCampaignAutomationVersions.flow} from ${emailCampaignAutomationVersions} where ${emailCampaignAutomationVersions.id} = ${input.activeVersionId})`,
      activeVersionId: input.activeVersionId,
      acceptingSince: input.acceptingSince ?? null,
      pausedAt: input.pausedAt ?? null,
      resumedAt: input.resumedAt ?? null,
      nextFireAt: input.nextFireAt ?? null,
    })
  );
};

/**
 * Inserts one automated send of `versionId` with its recipients, as a
 * deliver unit will.
 */
export const seedAutomatedSend = (
  db: WorkspaceDatabaseClient,
  input: {
    readonly campaignId: CampaignId;
    readonly versionId: AutomationVersionId;
    readonly purpose: CampaignPurpose;
    readonly text?: string;
    readonly recipients: readonly SeededRecipient[];
  }
) =>
  insertSend(db, {
    ...input,
    automationVersionId: input.versionId,
    content: campaignContentFixture(input.text ?? "Verze"),
  });

/**
 * Deletes campaigns with their automation rows, receipts, runs, units,
 * fires, sends, recipients and versions. Versions are immutable, so
 * removing them takes the same exclusive lock and trigger toggle an
 * operator would need.
 */
export const deleteAutomatedCampaigns = (
  db: WorkspaceDatabaseClient,
  campaignIds: readonly CampaignId[]
) =>
  Effect.runPromise(
    db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx
          .delete(emailCampaignAutomationTriggerReceipts)
          .where(
            inArray(
              emailCampaignAutomationTriggerReceipts.campaignId,
              campaignIds
            )
          );
        yield* tx
          .delete(emailCampaignAutomationRuns)
          .where(inArray(emailCampaignAutomationRuns.campaignId, campaignIds));
        yield* tx
          .delete(emailCampaignAutomationWorkUnits)
          .where(
            inArray(emailCampaignAutomationWorkUnits.campaignId, campaignIds)
          );
        yield* tx
          .delete(emailCampaignAutomationScheduleFires)
          .where(
            inArray(
              emailCampaignAutomationScheduleFires.campaignId,
              campaignIds
            )
          );
        // The automation row references its active version.
        yield* tx
          .delete(emailCampaignAutomations)
          .where(inArray(emailCampaignAutomations.campaignId, campaignIds));
        yield* tx
          .delete(emailCampaignSends)
          .where(inArray(emailCampaignSends.campaignId, campaignIds));
        yield* tx.execute(
          sql`lock table ${emailCampaignAutomationVersions} in access exclusive mode`
        );
        yield* tx.execute(
          sql`alter table ${emailCampaignAutomationVersions} disable trigger email_campaign_automation_versions_immutable`
        );
        yield* tx
          .delete(emailCampaignAutomationVersions)
          .where(
            inArray(emailCampaignAutomationVersions.campaignId, campaignIds)
          );
        yield* tx.execute(
          sql`alter table ${emailCampaignAutomationVersions} enable trigger email_campaign_automation_versions_immutable`
        );
        yield* tx
          .delete(emailCampaigns)
          .where(inArray(emailCampaigns.id, campaignIds));
      })
    )
  );

/** Deletes campaigns with their sends and recipients. */
export const deleteCampaigns = async (
  pool: {
    readonly query: (sql: string, params: unknown[]) => Promise<unknown>;
  },
  campaignIds: readonly string[]
) => {
  await pool.query(
    "delete from email_campaign_sends where campaign_id = any($1)",
    [campaignIds]
  );
  await pool.query("delete from email_campaigns where id = any($1)", [
    campaignIds,
  ]);
};
