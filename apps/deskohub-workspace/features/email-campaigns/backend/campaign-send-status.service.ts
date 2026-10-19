import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { asc, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Array as Arr, Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CampaignSendRow,
  emailCampaignRecipients,
  emailCampaignSends,
} from "@/db/schema";
import type { Locale } from "@/features/i18n";
import type { AudienceFilter } from "../audience-filter";
import type {
  CampaignAudienceId,
  CampaignId,
  CampaignSendId,
} from "../campaign-identifiers";
import type {
  CampaignRecipientSkipReason,
  CampaignRecipientStatus,
} from "../campaign-states";
import type { CampaignNotFound } from "../errors";
import { CampaignService } from "./campaign.service";
import { onceCampaignSend } from "./campaign-send-selection";

type CampaignRecipientDeliveryStatus = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly status: CampaignRecipientStatus;
  /** Why a `skipped` recipient wasn't mailed; null for every other status. */
  readonly skipReason: CampaignRecipientSkipReason | null;
  readonly statusUpdatedAt: Temporal.Instant;
};

type CampaignSendStatus = {
  readonly sendId: CampaignSendId;
  readonly createdAt: Temporal.Instant;
  readonly completedAt: Temporal.Instant | null;
  readonly audienceId: CampaignAudienceId | null;
  readonly audienceFilter: AudienceFilter;
  readonly counts: Readonly<Record<CampaignRecipientStatus, number>>;
  readonly recipients: readonly CampaignRecipientDeliveryStatus[];
};

export interface ICampaignSendStatusService {
  /**
   * A `once` campaign's send with per-recipient delivery status, if it was
   * sent. An automated campaign's sends never appear here.
   */
  readonly get: (input: {
    readonly campaignId: CampaignId;
  }) => Effect.Effect<
    Option.Option<CampaignSendStatus>,
    CampaignNotFound | EffectDrizzleQueryError
  >;
}

/**
 * Reads a campaign's frozen send and its delivery status. It needs only the
 * database, so the sent page and `dhw campaigns status` keep working where
 * campaign email or signing isn't configured.
 */
export class CampaignSendStatusService extends Context.Service<
  CampaignSendStatusService,
  ICampaignSendStatusService
>()("@deskohub-workspace/email-campaigns/CampaignSendStatusService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const campaigns = yield* CampaignService;

      const findSend = (campaignId: CampaignId) =>
        db
          .select()
          .from(emailCampaignSends)
          .where(onceCampaignSend(campaignId))
          .pipe(Effect.map(Arr.head));

      const listRecipients = (send: CampaignSendRow) =>
        db
          .select({
            dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
            locale: emailCampaignRecipients.locale,
            status: emailCampaignRecipients.status,
            skipReason: emailCampaignRecipients.skipReason,
            statusUpdatedAt: emailCampaignRecipients.statusUpdatedAt,
          })
          .from(emailCampaignRecipients)
          .where(eq(emailCampaignRecipients.sendId, send.id))
          .orderBy(asc(emailCampaignRecipients.dotyposCustomerId))
          .pipe(Effect.map((recipients) => toSendStatus({ send, recipients })));

      return {
        get: Effect.fn("CampaignSendStatusService.get")(({ campaignId }) =>
          campaigns
            .get(campaignId)
            .pipe(
              Effect.andThen(findSend(campaignId)),
              Effect.map(Option.map(listRecipients)),
              Effect.flatMap(Effect.transposeOption)
            )
        ),
      } satisfies ICampaignSendStatusService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(CampaignService.Default),
    Layer.provide(WorkspaceDatabase.Default)
  );
}

const toSendStatus = ({
  send,
  recipients,
}: {
  readonly send: CampaignSendRow;
  readonly recipients: readonly CampaignRecipientDeliveryStatus[];
}): CampaignSendStatus => ({
  sendId: send.id,
  createdAt: send.createdAt,
  completedAt: send.completedAt,
  audienceId: send.audienceId,
  audienceFilter: send.audienceFilter,
  counts: countRecipientStatuses(recipients),
  recipients,
});

const countRecipientStatuses = (
  recipients: readonly CampaignRecipientDeliveryStatus[]
) => {
  const counts = {
    pending: 0,
    sent: 0,
    delivered: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
    unconfirmed: 0,
    skipped: 0,
  } satisfies Record<CampaignRecipientStatus, number>;
  for (const recipient of recipients) counts[recipient.status] += 1;
  return counts;
};
