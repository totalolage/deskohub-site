import "server-only";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { emailCampaignRecipients } from "@/db/schema";
import {
  type DeliveryReportOutcome,
  ignoredDeliveryReport,
  processedDeliveryReport,
} from "@/shared/backend/email/delivery-reports";
import type { CampaignEmailRecipient } from "../campaign-email-message";
import type { CampaignRecipientStatus } from "../campaign-states";

/** A provider delivery event for one campaign email. */
export type CampaignDeliveryEvent = {
  /** The status event; none for an event that changes no status. */
  readonly type: Option.Option<keyof typeof statusTransitions>;
  readonly providerMessageId: string;
  /** The recipient the email's tags name, when they name one. */
  readonly recipient: Option.Option<CampaignEmailRecipient>;
  readonly occurredAt: Temporal.Instant;
};

export interface ICampaignDeliveryStatusService {
  /**
   * Records a delivered, bounced, or complained event on the frozen
   * recipient, found by provider message ID or by its tags when the event
   * beat the message ID into the database. The event is proof of delivery,
   * so it settles a recipient in any state short of it, including one whose
   * batch was refused, unconfirmed, or skipped by a later attempt. Statuses
   * only move forward, so a late `delivered` never hides a bounce or
   * complaint. Bounces and complaints change no consent: the provider
   * suppresses the address.
   */
  readonly record: (
    event: CampaignDeliveryEvent
  ) => Effect.Effect<DeliveryReportOutcome, EffectDrizzleQueryError>;
}

/** Every status short of a provider-confirmed delivery. */
const unconfirmedDeliveryStatuses = [
  "pending",
  "sent",
  "failed",
  "unconfirmed",
  "skipped",
] as const satisfies readonly CampaignRecipientStatus[];

/** Each provider status and the earlier statuses it may replace. */
const statusTransitions = {
  "email.delivered": {
    status: "delivered",
    from: unconfirmedDeliveryStatuses,
  },
  "email.bounced": {
    status: "bounced",
    from: [...unconfirmedDeliveryStatuses, "delivered"],
  },
  "email.complained": {
    status: "complained",
    from: [...unconfirmedDeliveryStatuses, "delivered"],
  },
} as const satisfies Record<
  string,
  {
    readonly status: CampaignRecipientStatus;
    readonly from: readonly CampaignRecipientStatus[];
  }
>;

/** Per-recipient delivery status of campaign emails, from provider webhooks. */
export class CampaignDeliveryStatusService extends Context.Service<
  CampaignDeliveryStatusService,
  ICampaignDeliveryStatusService
>()("@deskohub-workspace/email-campaigns/CampaignDeliveryStatusService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
        record: Effect.fn("CampaignDeliveryStatusService.record")(
          function* (event) {
            if (Option.isNone(event.type)) {
              return ignoredDeliveryReport("non_status_event");
            }
            const transition = statusTransitions[event.type.value];
            const byTags = event.recipient.pipe(
              Option.map((recipient) =>
                and(
                  eq(emailCampaignRecipients.sendId, recipient.campaignSendId),
                  eq(
                    emailCampaignRecipients.dotyposCustomerId,
                    recipient.dotyposCustomerId
                  ),
                  or(
                    isNull(emailCampaignRecipients.providerMessageId),
                    eq(
                      emailCampaignRecipients.providerMessageId,
                      event.providerMessageId
                    )
                  )
                )
              ),
              Option.getOrUndefined
            );
            const updated = yield* db
              .update(emailCampaignRecipients)
              .set({
                status: transition.status,
                skipReason: null,
                statusUpdatedAt: event.occurredAt,
                providerMessageId: sql`coalesce(${emailCampaignRecipients.providerMessageId}, ${event.providerMessageId})`,
              })
              .where(
                and(
                  or(
                    eq(
                      emailCampaignRecipients.providerMessageId,
                      event.providerMessageId
                    ),
                    byTags
                  ),
                  inArray(emailCampaignRecipients.status, [...transition.from])
                )
              )
              .returning({ sendId: emailCampaignRecipients.sendId });
            return updated.length > 0
              ? processedDeliveryReport
              : ignoredDeliveryReport("campaign_recipient_unchanged");
          }
        ),
      } satisfies ICampaignDeliveryStatusService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
