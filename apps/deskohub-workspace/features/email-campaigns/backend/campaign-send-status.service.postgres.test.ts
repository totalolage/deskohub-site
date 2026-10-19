import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Option } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignId } from "../campaign-identifiers";
import { CampaignService } from "./campaign.service";
import { CampaignSendStatusService } from "./campaign-send-status.service";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
  seedCampaignSend,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`send-status-${run}-${name}`);

describe.skipIf(!testDatabase)(
  "CampaignSendStatusService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;
    const campaignIds: CampaignId[] = [];

    afterAll(async () => {
      await deleteAutomatedCampaigns(db, campaignIds);
    });

    const sendStatus = (campaignId: CampaignId) =>
      Effect.runPromise(
        CampaignSendStatusService.pipe(
          Effect.flatMap((statuses) => statuses.get({ campaignId })),
          Effect.provide(
            CampaignSendStatusService.Default.pipe(
              Layer.provide(CampaignService.Default),
              Layer.provide(testDatabase.layer)
            )
          )
        )
      );

    test("reads a one-off campaign's own send and ignores automated sends beside it", async () => {
      const once = customerId("once");
      const automated = customerId("automated");
      const { campaignId, sendId } = await seedCampaignSend(db, {
        purpose: "marketing",
        status: "sent",
        recipients: [{ dotyposCustomerId: once, status: "delivered" }],
      });
      campaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
      });
      await seedAutomatedSend(db, {
        campaignId,
        versionId,
        purpose: "marketing",
        recipients: [{ dotyposCustomerId: automated, status: "failed" }],
      });

      const status = Option.getOrThrow(await sendStatus(campaignId));

      expect(status.sendId).toBe(sendId);
      expect(status.recipients.map((row) => row.dotyposCustomerId)).toEqual([
        once,
      ]);
      expect(status.counts).toMatchObject({ delivered: 1, failed: 0 });
    });

    test("finds no one-off send for an automated campaign", async () => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "marketing",
      });
      campaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
      });
      for (const name of ["first", "second"]) {
        await seedAutomatedSend(db, {
          campaignId,
          versionId,
          purpose: "marketing",
          recipients: [{ dotyposCustomerId: customerId(name) }],
        });
      }

      expect(Option.isNone(await sendStatus(campaignId))).toBe(true);
    });
  }
);
