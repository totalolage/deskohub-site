import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import {
  type CampaignRow,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import type { Locale } from "@/features/i18n";
import type { AudienceFilter } from "../audience-filter";
import type { CampaignContentHash } from "../body/campaign-content-hash";
import type {
  CampaignAudienceId,
  CampaignId,
  CampaignSendId,
} from "../campaign-identifiers";
import {
  isOnceCampaign,
  retryableRecipientStatuses,
  undeliveredRecipientStatuses,
} from "../campaign-states";
import type { CampaignConfirmationRejection } from "../errors";
import {
  CampaignDeliveryMismatch,
  CampaignNotFound,
  CampaignNotRetryable,
  CampaignReadOnly,
} from "../errors";
import { onceCampaignSend } from "./campaign-send-selection";

/** The recipients and audience snapshot a confirmed send freezes. */
export type CampaignSendFreeze = {
  readonly audienceId: CampaignAudienceId | null;
  readonly audienceFilter: AudienceFilter;
  readonly recipients: readonly {
    readonly dotyposCustomerId: DotyposCustomerId;
    readonly locale: Locale;
  }[];
};

type Confirmation =
  | {
      readonly _tag: "Confirm";
      readonly contentHash: CampaignContentHash;
      readonly now: Temporal.Instant;
    }
  | {
      readonly _tag: "Rejected";
      readonly reason: CampaignConfirmationRejection;
    };

const startSending = <E, R>(input: {
  readonly campaignId: CampaignId;
  readonly send: CampaignSendFreeze;
  readonly check: (campaign: CampaignRow) => Effect.Effect<Confirmation, E, R>;
}) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceTransaction;
    const [campaign] = yield* db
      .select()
      .from(emailCampaigns)
      .where(eq(emailCampaigns.id, input.campaignId))
      .for("update");
    if (!campaign)
      return yield* new CampaignNotFound({ campaignId: input.campaignId });
    if (!isOnceCampaign(campaign))
      return yield* new CampaignDeliveryMismatch({
        campaignId: input.campaignId,
        delivery: campaign.delivery,
      });
    if (campaign.status !== "draft")
      return yield* new CampaignReadOnly({
        campaignId: input.campaignId,
        status: campaign.status,
      });
    const verdict = yield* input.check(campaign);
    if (verdict._tag === "Rejected") return verdict;
    const [updated] = yield* db
      .update(emailCampaigns)
      .set({ status: "sending", updatedAt: verdict.now })
      .where(eq(emailCampaigns.id, input.campaignId))
      .returning();
    const [send] = yield* db
      .insert(emailCampaignSends)
      .values({
        campaignId: input.campaignId,
        audienceId: input.send.audienceId,
        audienceFilter: input.send.audienceFilter,
        contentHash: verdict.contentHash,
        createdAt: verdict.now,
      })
      .returning({ id: emailCampaignSends.id });
    if (input.send.recipients.length > 0) {
      yield* db.insert(emailCampaignRecipients).values(
        input.send.recipients.map((recipient) => ({
          ...recipient,
          sendId: send!.id,
          statusUpdatedAt: verdict.now,
        }))
      );
    }
    return { _tag: "Confirmed" as const, campaign: updated!, sendId: send!.id };
  });

const retry = Effect.fn("OnceCampaignLifecycle.retry")(function* (input: {
  readonly campaignId: CampaignId;
  readonly includeUnconfirmed: boolean;
  readonly now: Temporal.Instant;
}) {
  const { db } = yield* WorkspaceTransaction;
  const { campaignId, now } = input;
  // Lock order: an existing send before its campaign. A delivery run holds
  // its send under the lease before settling the campaign, so taking the
  // campaign first would deadlock against it.
  yield* db
    .select({ id: emailCampaignSends.id })
    .from(emailCampaignSends)
    .where(onceCampaignSend(campaignId))
    .for("update");
  const [campaign] = yield* db
    .select({
      delivery: emailCampaigns.delivery,
      status: emailCampaigns.status,
    })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, campaignId))
    .for("update");
  if (!campaign) {
    return yield* new CampaignNotFound({ campaignId });
  }
  if (!isOnceCampaign(campaign)) {
    return yield* new CampaignDeliveryMismatch({
      campaignId,
      delivery: campaign.delivery,
    });
  }
  if (campaign.status !== "failed") {
    return yield* new CampaignNotRetryable({
      campaignId,
      status: campaign.status,
    });
  }
  const [send] = yield* db
    .update(emailCampaignSends)
    .set({
      deliveryAttempt: sql`${emailCampaignSends.deliveryAttempt} + 1`,
    })
    .where(onceCampaignSend(campaignId))
    .returning({
      sendId: emailCampaignSends.id,
      deliveryAttempt: emailCampaignSends.deliveryAttempt,
    });
  const retried = yield* db
    .update(emailCampaignRecipients)
    .set({
      deliveryAttempt: send!.deliveryAttempt,
      status: "pending",
      statusUpdatedAt: now,
    })
    .where(
      and(
        eq(emailCampaignRecipients.sendId, send!.sendId),
        inArray(
          emailCampaignRecipients.status,
          retryableRecipientStatuses(input.includeUnconfirmed)
        )
      )
    )
    .returning({
      dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
    });
  yield* db
    .update(emailCampaigns)
    .set({ status: "sending", updatedAt: now })
    .where(eq(emailCampaigns.id, campaignId));
  return { ...send!, retriedCount: retried.length };
});

const abandon = Effect.fn("OnceCampaignLifecycle.abandon")(function* (input: {
  readonly campaignId: CampaignId;
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
  readonly now: Temporal.Instant;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [campaign] = yield* db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, input.campaignId))
    .for("update");
  if (!campaign || !isOnceCampaign(campaign) || campaign.status !== "sending")
    return;
  const [send] = yield* db
    .select({ id: emailCampaignSends.id })
    .from(emailCampaignSends)
    .where(
      and(
        onceCampaignSend(input.campaignId),
        eq(emailCampaignSends.id, input.sendId),
        eq(emailCampaignSends.deliveryAttempt, input.deliveryAttempt)
      )
    );
  if (!send) return;
  yield* db
    .update(emailCampaigns)
    .set({ status: "failed", updatedAt: input.now })
    .where(eq(emailCampaigns.id, input.campaignId));
});

const settle = Effect.fn("OnceCampaignLifecycle.settle")(function* (input: {
  readonly campaignId: CampaignId;
  readonly sendId: CampaignSendId;
  readonly deliveryAttempt: number;
  readonly now: Temporal.Instant;
}) {
  const { db } = yield* WorkspaceTransaction;
  const [campaign] = yield* db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, input.campaignId))
    .for("update");
  if (!campaign || !isOnceCampaign(campaign) || campaign.status !== "sending")
    return "stale" as const;
  const [send] = yield* db
    .select({ id: emailCampaignSends.id })
    .from(emailCampaignSends)
    .where(
      and(
        onceCampaignSend(input.campaignId),
        eq(emailCampaignSends.id, input.sendId),
        eq(emailCampaignSends.deliveryAttempt, input.deliveryAttempt)
      )
    );
  if (!send) return "stale" as const;
  const [row] = yield* db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailCampaignRecipients)
    .where(
      and(
        eq(emailCampaignRecipients.sendId, input.sendId),
        inArray(emailCampaignRecipients.status, undeliveredRecipientStatuses)
      )
    );
  const status =
    (row?.count ?? 0) > 0 ? ("failed" as const) : ("sent" as const);
  yield* db
    .update(emailCampaigns)
    .set({ status, updatedAt: input.now })
    .where(eq(emailCampaigns.id, input.campaignId));
  yield* db
    .update(emailCampaignSends)
    .set({ completedAt: status === "sent" ? input.now : null })
    .where(eq(emailCampaignSends.id, input.sendId));
  return status;
});

export const OnceCampaignLifecycle = { startSending, retry, abandon, settle };
