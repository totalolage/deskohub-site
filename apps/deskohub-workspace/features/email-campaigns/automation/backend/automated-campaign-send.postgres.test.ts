import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import { EmailConfigTag, EmailServiceTag } from "@deskohub/email";
import { makeEmailProviderFake } from "@deskohub/email/testing";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerMarketingConsents } from "@/db/schema";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { campaignDeliveryTestLayer } from "../../backend/campaign-delivery.test-utils";
import { CampaignEmailConfig } from "../../backend/campaign-email.config";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId, CampaignSendId } from "../../campaign-identifiers";
import {
  AutomatedSendSubmission,
  makeAutomatedCampaignSend,
} from "./automated-campaign-send";
import { deliverProfile } from "./deliver.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`sends-${run}-${name}`);

describe.skipIf(!testDatabase)(
  "automated campaign sends on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db, pool } = testDatabase;
    const automatedCampaignIds: CampaignId[] = [];
    const consentCustomerIds: DotyposCustomerId[] = [];

    afterAll(async () => {
      await deleteAutomatedCampaigns(db, automatedCampaignIds);
      await pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [consentCustomerIds]
      );
    });

    /** The deliver unit's send steps over an email provider fake. */
    const setUp = (profiles: readonly DotyposCustomer[]) => {
      const provider = makeEmailProviderFake();
      const layer = campaignDeliveryTestLayer(
        Layer.mergeAll(
          DotyposServiceMock({
            getCustomersByIds: (ids) =>
              makeInMemoryDotypos({
                customers: [...profiles],
              }).service.getCustomersByIds(ids),
          }),
          EmailServiceTag.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                provider.layer,
                Layer.succeed(EmailConfigTag, {
                  defaultFrom: { email: testEmailAddress("campaigns") },
                })
              )
            )
          ),
          Layer.succeed(CampaignEmailConfig, {
            deploymentEnvironment: "development",
            from: { email: testEmailAddress("campaigns") },
            replyTo: { email: testEmailAddress("hello") },
            adminInbox: testEmailAddress("admin"),
          })
        )
      ).pipe(Layer.provideMerge(testDatabase.layer));
      const read = new Map(profiles.map((profile) => [profile.id!, profile]));

      /**
       * Persists an automated send of the version to `recipients`, submits
       * it from the profiles read for it and settles it, as a deliver unit
       * does (§5.9). The unit also ends the send's runs; its own suite
       * covers that.
       */
      const deliverAutomated = (input: {
        readonly campaignId: CampaignId;
        readonly versionId: Awaited<ReturnType<typeof seedAutomationVersion>>;
        readonly recipients: readonly DotyposCustomerId[];
      }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const sends = yield* makeAutomatedCampaignSend;
            const { transaction } = yield* WorkspaceDatabase;
            const at = Temporal.Now.instant();
            const sendId = yield* transaction(
              sends
                .create({
                  campaignId: input.campaignId,
                  versionId: input.versionId,
                  at,
                })
                .pipe(
                  Effect.tap((created) =>
                    sends.persistBatch({
                      sendId: created,
                      recipients: input.recipients.map((dotyposCustomerId) => ({
                        dotyposCustomerId,
                        locale: "cs-CZ" as const,
                      })),
                      profiles: read,
                      at,
                    })
                  )
                )
            );
            const submission = yield* sends.submit({
              sendId,
              profiles: Option.some(read),
            });
            yield* transaction(
              AutomatedSendSubmission.$match(submission, {
                AlreadyCompleted: () => Effect.void,
                Submitted: ({ batches }) =>
                  sends.settle({
                    sendId,
                    batches,
                    at: Temporal.Now.instant(),
                  }),
              })
            );
            return sendId;
          }).pipe(Effect.provide(layer))
        );

      /** Submits an automated send again, as a reclaimed deliver unit does. */
      const resubmitAutomated = (sendId: CampaignSendId) =>
        Effect.runPromise(
          Effect.flatMap(makeAutomatedCampaignSend, (sends) =>
            sends.submit({ sendId, profiles: Option.none() })
          ).pipe(Effect.provide(layer))
        );

      return { provider, deliverAutomated, resubmitAutomated };
    };

    const grantConsent = async (ids: readonly DotyposCustomerId[]) => {
      consentCustomerIds.push(...ids);
      await Effect.runPromise(
        db.insert(customerMarketingConsents).values(
          ids.map((dotyposCustomerId) => ({
            dotyposCustomerId,
            documentHash: "hash",
            locale: "cs-CZ" as const,
            grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
          }))
        )
      );
    };

    const stored = async (sendId: string) => {
      const { rows: recipients } = await pool.query(
        "select dotypos_customer_id, status, skip_reason from email_campaign_recipients where send_id = $1 order by dotypos_customer_id",
        [sendId]
      );
      const {
        rows: [campaign],
      } = await pool.query(
        "select c.status, s.completed_at from email_campaign_sends s join email_campaigns c on c.id = s.campaign_id where s.id = $1",
        [sendId]
      );
      const { rows: batches } = await pool.query(
        "select delivery_attempt, batch_index, dotypos_customer_ids, status from email_campaign_delivery_batches where send_id = $1 order by delivery_attempt, batch_index",
        [sendId]
      );
      return { recipients, campaign, batches };
    };

    /**
     * An automated campaign whose own draft is operational and whose
     * published version is marketing.
     */
    const seedVersion = async (
      status: "active" | "paused" = "active"
    ): Promise<{
      readonly campaignId: CampaignId;
      readonly versionId: Awaited<ReturnType<typeof seedAutomationVersion>>;
    }> => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "operational",
        status,
      });
      automatedCampaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
        text: "Verze jedna",
      });
      return { campaignId, versionId };
    };

    test("settles a submitted automated send whatever its campaign's status and leaves the status as it is", async () => {
      const id = customerId("paused");
      await grantConsent([id]);
      const { provider, deliverAutomated, resubmitAutomated } = setUp([
        deliverProfile(id),
      ]);
      provider.respondWith(() => "refuse");
      const seeded = await seedVersion("paused");

      const sendId = await deliverAutomated({ ...seeded, recipients: [id] });

      const { recipients, campaign, batches } = await stored(sendId);
      expect(recipients.map((row) => row.status)).toEqual(["failed"]);
      expect(batches.map((batch) => batch.status)).toEqual(["rejected"]);
      expect(campaign.status).toBe("paused");
      expect(campaign.completed_at).not.toBeNull();

      // A completed automated send has nothing left to submit or settle.
      expect(await resubmitAutomated(sendId)).toMatchObject({
        _tag: "AlreadyCompleted",
      });
      expect(provider.requests()).toHaveLength(1);
    });

    test("a deliver unit's send mails its version's content, skips non-test recipients one by one and leaves the campaign's status", async () => {
      const inside = customerId("inside");
      const outside = customerId("outside");
      await grantConsent([inside, outside]);
      const { provider, deliverAutomated } = setUp([
        deliverProfile(inside),
        deliverProfile(outside, { email: resendSimulatorAddress("delivered") }),
      ]);
      const seeded = await seedVersion();

      const sendId = await deliverAutomated({
        ...seeded,
        recipients: [inside, outside],
      });

      const requests = provider.requests();
      expect(requests.map(({ key }) => key)).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
      ]);
      expect(requests[0]!.payload).toContain("Verze jedna");
      expect(requests[0]!.payload).not.toContain("Rozpracovan");
      // The version's marketing purpose, not the campaign's own.
      expect(
        JSON.parse(requests[0]!.payload)[0].headers["List-Unsubscribe"]
      ).toBeDefined();
      expect(provider.mailed()).toEqual([testEmailAddress(inside)]);
      const { recipients, campaign, batches } = await stored(sendId);
      expect(
        recipients.map((row) => [
          row.dotypos_customer_id,
          row.status,
          row.skip_reason,
        ])
      ).toEqual([
        [inside, "sent", null],
        [outside, "skipped", "outside-test-domain"],
      ]);
      expect(batches).toEqual([
        {
          delivery_attempt: 1,
          batch_index: 0,
          dotypos_customer_ids: [inside],
          status: "accepted",
        },
      ]);
      expect(campaign.status).toBe("active");
      expect(campaign.completed_at).not.toBeNull();
    });
  }
);
