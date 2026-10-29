import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Option } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignEmailRecipient } from "../campaign-email-message";
import type { CampaignRecipientStatus } from "../campaign-states";
import {
  type CampaignDeliveryEvent,
  CampaignDeliveryStatusService,
} from "./campaign-delivery-status.service";
import {
  deleteCampaigns,
  seedCampaignSend,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const customerId = DotyposCustomerIdSchema.make(`status-${run}`);
const occurredAt = Temporal.Instant.from("2026-10-14T12:00:00Z");

describe.skipIf(!testDatabase)(
  "CampaignDeliveryStatusService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const campaignIds: string[] = [];

    afterAll(() => deleteCampaigns(testDatabase.pool, campaignIds));

    const seed = async (
      status: CampaignRecipientStatus,
      providerMessageId?: string
    ) => {
      const seeded = await seedCampaignSend(testDatabase.db, {
        purpose: "marketing",
        recipients: [
          { dotyposCustomerId: customerId, status, providerMessageId },
        ],
      });
      campaignIds.push(seeded.campaignId);
      return seeded;
    };

    const record = (event: {
      readonly type:
        | Option.Option.Value<CampaignDeliveryEvent["type"]>
        | "email.opened";
      readonly providerMessageId: string;
      readonly recipient?: CampaignEmailRecipient;
    }) =>
      Effect.runPromise(
        CampaignDeliveryStatusService.pipe(
          Effect.flatMap((statuses) =>
            statuses.record({
              ...event,
              type: Option.liftPredicate(
                event.type,
                (type) => type !== "email.opened"
              ),
              recipient: Option.fromUndefinedOr(event.recipient),
              occurredAt,
            })
          ),
          Effect.provide(
            CampaignDeliveryStatusService.Default.pipe(
              Layer.provide(testDatabase.layer)
            )
          )
        )
      );

    const stored = async (sendId: string) =>
      (
        await testDatabase.pool.query(
          "select status, provider_message_id, status_updated_at from email_campaign_recipients where send_id = $1",
          [sendId]
        )
      ).rows[0];

    test("records delivered, bounced, and complained by provider message ID", async () => {
      for (const [type, status] of [
        ["email.delivered", "delivered"],
        ["email.bounced", "bounced"],
        ["email.complained", "complained"],
      ] as const) {
        const messageId = `msg-${run}-${status}`;
        const { sendId } = await seed("sent", messageId);

        expect(await record({ type, providerMessageId: messageId })).toEqual({
          status: "processed",
        });
        expect(await stored(sendId)).toMatchObject({
          status,
          provider_message_id: messageId,
        });
      }
    });

    test("matches a recipient by its tags before its message ID is stored", async () => {
      const { sendId } = await seed("pending");
      const messageId = `msg-${run}-early`;

      expect(
        await record({
          type: "email.delivered",
          providerMessageId: messageId,
          recipient: { campaignSendId: sendId, dotyposCustomerId: customerId },
        })
      ).toEqual({ status: "processed" });
      expect(await stored(sendId)).toMatchObject({
        status: "delivered",
        provider_message_id: messageId,
      });
    });

    test("settles a failed, unconfirmed, or skipped recipient the provider reports delivered", async () => {
      for (const status of ["failed", "unconfirmed", "skipped"] as const) {
        const { sendId } = await seed(status);
        const messageId = `msg-${run}-settles-${status}`;

        expect(
          await record({
            type: "email.delivered",
            providerMessageId: messageId,
            recipient: {
              campaignSendId: sendId,
              dotyposCustomerId: customerId,
            },
          })
        ).toEqual({ status: "processed" });
        expect(await stored(sendId)).toMatchObject({
          status: "delivered",
          provider_message_id: messageId,
        });
      }
    });

    test("never moves a recipient back to an earlier status", async () => {
      const messageId = `msg-${run}-late`;
      const { sendId } = await seed("complained", messageId);

      expect(
        await record({ type: "email.delivered", providerMessageId: messageId })
      ).toEqual({ status: "ignored", reason: "campaign_recipient_unchanged" });
      expect(await stored(sendId)).toMatchObject({ status: "complained" });
    });

    test("ignores events for unknown messages and non-status events", async () => {
      const messageId = `msg-${run}-opened`;
      const { sendId } = await seed("sent", messageId);

      expect(
        await record({ type: "email.opened", providerMessageId: messageId })
      ).toEqual({ status: "ignored", reason: "non_status_event" });
      expect(
        await record({
          type: "email.bounced",
          providerMessageId: `msg-${run}-unknown`,
        })
      ).toEqual({ status: "ignored", reason: "campaign_recipient_unchanged" });
      expect(await stored(sendId)).toMatchObject({ status: "sent" });
    });
  }
);
