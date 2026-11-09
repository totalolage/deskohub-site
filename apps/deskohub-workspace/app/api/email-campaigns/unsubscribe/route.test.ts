import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect } from "effect";
import { customerMarketingConsents } from "@/db/schema";
import { loadCampaignSigningKeys } from "@/features/email-campaigns/backend/campaign-signing-keys";
import {
  deleteCampaigns,
  seedCampaignSend,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import type { CampaignSendId } from "@/features/email-campaigns/campaign-identifiers";
import { signCampaignUnsubscribeToken } from "@/features/email-campaigns/campaign-unsubscribe-token";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { GET, POST } from "./route";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const signingKeys = await Effect.runPromise(
  loadCampaignSigningKeys("unsubscribe-token")
);

const unsubscribeUrl = (token: string) =>
  `https://workspace.deskohub.test/api/email-campaigns/unsubscribe?token=${encodeURIComponent(token)}`;

/** A mail client's RFC 8058 one-click request. */
const oneClick = (token: string) =>
  POST(
    new Request(unsubscribeUrl(token), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    })
  );

describe.skipIf(!testDatabase)(
  "/api/email-campaigns/unsubscribe on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const campaignIds: string[] = [];
    const customerIds: string[] = [];

    afterAll(async () => {
      await deleteCampaigns(testDatabase.pool, campaignIds);
      await testDatabase.pool.query(
        "delete from customer_marketing_management_tokens where dotypos_customer_id = any($1)",
        [customerIds]
      );
      await testDatabase.pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [customerIds]
      );
    });

    const seedRecipient = async (
      name: string,
      purpose: "marketing" | "operational" = "marketing"
    ) => {
      const dotyposCustomerId = DotyposCustomerIdSchema.make(
        `unsubscribe-${run}-${name}`
      );
      customerIds.push(dotyposCustomerId);
      const { campaignId, sendId } = await seedCampaignSend(testDatabase.db, {
        purpose,
        status: "sent",
        recipients: [{ dotyposCustomerId, status: "delivered" }],
      });
      campaignIds.push(campaignId);
      await Effect.runPromise(
        testDatabase.db.insert(customerMarketingConsents).values({
          dotyposCustomerId,
          documentHash: "hash",
          locale: "cs-CZ",
          grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
        })
      );
      return {
        dotyposCustomerId,
        token: await Effect.runPromise(
          signCampaignUnsubscribeToken(signingKeys, {
            sendId,
            dotyposCustomerId,
          })
        ),
      };
    };

    const withdrawnAt = async (dotyposCustomerId: string) =>
      (
        await testDatabase.pool.query(
          "select withdrawn_at from customer_marketing_consents where dotypos_customer_id = $1",
          [dotyposCustomerId]
        )
      ).rows[0]?.withdrawn_at;

    test("withdraws marketing consent on a one-click POST", async () => {
      const { dotyposCustomerId, token } = await seedRecipient("valid");

      const response = await oneClick(token);

      expect(response.status).toBe(200);
      expect(await withdrawnAt(dotyposCustomerId)).not.toBeNull();
    });

    test("succeeds again on a replayed request without changing the withdrawal", async () => {
      const { dotyposCustomerId, token } = await seedRecipient("replayed");
      await oneClick(token);
      const firstWithdrawal = await withdrawnAt(dotyposCustomerId);

      const replayed = await oneClick(token);

      expect(replayed.status).toBe(200);
      expect(await withdrawnAt(dotyposCustomerId)).toEqual(firstWithdrawal);
    });

    test("rejects a forged token or one for an operational email", async () => {
      const { dotyposCustomerId, token } = await seedRecipient("forged");
      const operational = await seedRecipient("operational", "operational");

      for (const candidate of [
        `${token.split(".")[0]}.${"A".repeat(43)}`,
        signCampaignUnsubscribeToken(Buffer.alloc(32, 7), {
          sendId: "unknown" as CampaignSendId,
          dotyposCustomerId,
        }),
        await Effect.runPromise(
          signCampaignUnsubscribeToken(signingKeys, {
            sendId: "unknown" as CampaignSendId,
            dotyposCustomerId,
          })
        ),
        operational.token,
        "",
      ]) {
        expect((await oneClick(candidate)).status).toBe(400);
      }
      expect(await withdrawnAt(dotyposCustomerId)).toBeNull();
      expect(await withdrawnAt(operational.dotyposCustomerId)).toBeNull();
    });

    test("opens the marketing preferences on GET without unsubscribing", async () => {
      const { dotyposCustomerId, token } = await seedRecipient("preferences");

      const response = await GET(new Request(unsubscribeUrl(token)));

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain(
        "/marketing-preferences/access?token="
      );
      expect(await withdrawnAt(dotyposCustomerId)).toBeNull();
    });
  }
);
