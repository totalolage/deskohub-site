import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import { loadAutomationVersionActivations } from "./automation-version-activations";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "loadAutomationVersionActivations on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;
    const campaignIds: CampaignId[] = [];

    afterAll(() => deleteAutomatedCampaigns(db, campaignIds));

    test("loads one automation's versions in activation order with their triggers", async () => {
      const [campaignId, otherCampaignId] = await Promise.all([
        seedAutomatedCampaign(db, { purpose: "marketing" }),
        seedAutomatedCampaign(db, { purpose: "marketing" }),
      ]);
      campaignIds.push(campaignId, otherCampaignId);
      const first = Temporal.Instant.from("2026-11-01T09:00:00.123456Z");
      const second = Temporal.Instant.from("2026-11-03T12:00:00Z");
      // Inserted newest first: the loader orders by activation.
      const secondId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
        versionNumber: 2,
        trigger: { _tag: "AccountCreated" },
        activatedAt: second,
      });
      const firstId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
        versionNumber: 1,
        trigger: { _tag: "Schedule", calendar: { hours: [10] } },
        activatedAt: first,
      });
      await seedAutomationVersion(db, {
        campaignId: otherCampaignId,
        purpose: "marketing",
        trigger: { _tag: "AccountCreated" },
      });

      const activations = await Effect.runPromise(
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(loadAutomationVersionActivations(campaignId))
        ).pipe(Effect.provide(testDatabase.layer))
      );

      expect(activations).toEqual([
        {
          id: firstId,
          activatedAt: first,
          trigger: { _tag: "Schedule", calendar: { hours: [10] } },
        },
        {
          id: secondId,
          activatedAt: second,
          trigger: { _tag: "AccountCreated" },
        },
      ]);
    });
  }
);
