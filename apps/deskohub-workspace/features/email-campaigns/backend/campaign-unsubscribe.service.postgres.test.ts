import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { customerMarketingConsents } from "@/db/schema";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import { MarketingManagementService } from "@/features/legal/backend/marketing-management.service";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignPurpose } from "../body/campaign-content";
import type { CampaignId } from "../campaign-identifiers";
import { signCampaignUnsubscribeToken } from "../campaign-unsubscribe-token";
import { loadCampaignSigningKeys } from "./campaign-signing-keys";
import { CampaignUnsubscribeService } from "./campaign-unsubscribe.service";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const [signingKey] = await Effect.runPromise(
  loadCampaignSigningKeys("unsubscribe-token")
);

describe.skipIf(!testDatabase)(
  "CampaignUnsubscribeService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;
    const campaignIds: CampaignId[] = [];
    const customerIds: string[] = [];

    afterAll(async () => {
      await deleteAutomatedCampaigns(db, campaignIds);
      await testDatabase.pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [customerIds]
      );
    });

    /**
     * A consenting recipient of an automated send whose version was
     * published as `versionPurpose`, while the campaign's own draft has the
     * other purpose.
     */
    const seedAutomatedRecipient = async (versionPurpose: CampaignPurpose) => {
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `unsubscribe-automated-${run}-${versionPurpose}`
      );
      customerIds.push(dotyposCustomerId);
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: versionPurpose === "marketing" ? "operational" : "marketing",
      });
      campaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: versionPurpose,
      });
      const sendId = await seedAutomatedSend(db, {
        campaignId,
        versionId,
        purpose: versionPurpose,
        recipients: [{ dotyposCustomerId, status: "delivered" }],
      });
      await Effect.runPromise(
        db.insert(customerMarketingConsents).values({
          dotyposCustomerId,
          documentHash: "hash",
          locale: "cs-CZ",
          grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
        })
      );
      return signCampaignUnsubscribeToken(signingKey, {
        sendId,
        dotyposCustomerId,
      });
    };

    const unsubscribe = (token: string) =>
      Effect.runPromiseExit(
        CampaignUnsubscribeService.pipe(
          Effect.flatMap((service) => service.unsubscribe(token)),
          Effect.provide(
            CampaignUnsubscribeService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  CustomerMarketingConsentRepository.Default,
                  MarketingManagementService.Default
                )
              ),
              Layer.provide(testDatabase.layer)
            )
          )
        )
      );

    test("unsubscribes from an automated send its version published as marketing", async () => {
      const token = await seedAutomatedRecipient("marketing");

      expect(await unsubscribe(token)).toMatchObject({
        _tag: "Success",
        value: "withdrawn",
      });
    });

    test("rejects a token for an automated send its version published as operational", async () => {
      const token = await seedAutomatedRecipient("operational");

      expect(await unsubscribe(token)).toMatchObject({
        _tag: "Failure",
      });
    });
  }
);
