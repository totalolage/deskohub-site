import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import { EmailConfigTag, EmailServiceTag } from "@deskohub/email";
import { makeEmailProviderFake } from "@deskohub/email/testing";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerMarketingConsents } from "@/db/schema";
import type { Locale } from "@/features/i18n";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { makeAutomatedCampaignSend } from "../automation/backend/automated-campaign-send";
import type {
  CampaignLocalizedContent,
  CampaignPurpose,
} from "../body/campaign-content";
import type { CampaignId, CampaignSendId } from "../campaign-identifiers";
import { CampaignDeliveryService } from "./campaign-delivery.service";
import { campaignDeliveryTestLayer } from "./campaign-delivery.test-utils";
import { CampaignEmailConfig } from "./campaign-email.config";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
  seedCampaignSend,
} from "./email-campaigns.test-utils";

/**
 * Pins the exact payload a delivery batch requests, as `JSON.stringify`
 * writes its messages, and the payload hash its batch row stores, for fixed
 * synthetic inputs. A batch whose outcome is unknown is replayed only while
 * its re-rendered payload hashes the same, so a change to these values makes
 * every `requested` batch `unconfirmed`. Change them only for a deliberate
 * rendering change, after comparing the delivery messages from the base and
 * the change.
 */
const pinnedPayloadHashes = {
  "one-off marketing":
    "a3bc988a1a2f8295b9d7239e451c4f4a99d4f89d0a89e7d465c44e47cf9b925c",
  "one-off operational":
    "ded2997f180873775501be4e23ee2acf5ab15747f161bc57a8dadf4e44e1ccd7",
  "automated marketing":
    "79011e454d025ed0544d576f9b3145417826a4f2ec0cc9403fe4c764fc47bc57",
  "automated operational":
    "deb8754e7610a71a6496fac049b42aa8ecd2f4657c57dd7c6f7f243268591445",
} as const;

const sendIds = {
  "one-off marketing": "019a5c55-0000-7000-8000-000000000001",
  "one-off operational": "019a5c55-0000-7000-8000-000000000002",
  "automated marketing": "019a5c55-0000-7000-8000-000000000003",
  "automated operational": "019a5c55-0000-7000-8000-000000000004",
} as const satisfies Record<keyof typeof pinnedPayloadHashes, string>;

const recipients: readonly {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
}[] = [
  {
    dotyposCustomerId: DotyposCustomerIdSchema.make("payload-pin-ada"),
    locale: "cs-CZ",
  },
  {
    dotyposCustomerId: DotyposCustomerIdSchema.make("payload-pin-grace"),
    locale: "en-US",
  },
];

const profiles = recipients.map(
  ({ dotyposCustomerId }) =>
    ({
      id: dotyposCustomerId,
      _cloudId: "cloud",
      email: testEmailAddress(dotyposCustomerId),
      points: "0",
      flags: "0",
      display: true,
      deleted: false,
    }) as DotyposCustomer
);

const paragraph = (text: string) => ({
  formatVersion: 1 as const,
  doc: {
    type: "doc" as const,
    content: [
      { type: "paragraph" as const, content: [{ type: "text", text }] },
    ],
  },
});

const content: CampaignLocalizedContent = {
  "cs-CZ": {
    subject: "Zkušební předmět",
    preheader: "Zkušební úvod",
    body: paragraph("Zkušební obsah zprávy."),
  },
  "en-US": {
    subject: "Sample subject",
    preheader: "Sample preheader",
    body: paragraph("Sample message body."),
  },
};

const sha256 = (payload: string) =>
  createHash("sha256").update(payload).digest("hex");

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "campaign delivery payload on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db, pool } = testDatabase;
    const customerIds = recipients.map(
      ({ dotyposCustomerId }) => dotyposCustomerId
    );

    /** Removes the fixed rows, including any an interrupted run left. */
    const removePinnedRows = async () => {
      const { rows } = await pool.query(
        "select campaign_id from email_campaign_sends where id = any($1)",
        [Object.values(sendIds)]
      );
      await deleteAutomatedCampaigns(
        db,
        rows.map(({ campaign_id }) => campaign_id as CampaignId)
      );
      await pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [customerIds]
      );
    };

    beforeAll(async () => {
      await removePinnedRows();
      const grantedAt = Temporal.Instant.from("2026-01-01T00:00:00Z");
      await Effect.runPromise(
        db.insert(customerMarketingConsents).values(
          customerIds.map((dotyposCustomerId) => ({
            dotyposCustomerId,
            documentHash: "hash",
            locale: "cs-CZ" as const,
            grantedAt,
          }))
        )
      );
    });

    afterAll(removePinnedRows);

    /** The delivery service on an email provider fake that records requests. */
    const deliveryLayer = () => {
      const provider = makeEmailProviderFake();
      const layer = campaignDeliveryTestLayer(
        Layer.mergeAll(
          makeInMemoryDotypos({ customers: profiles }).layer,
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
      return { layer, requests: provider.requests };
    };

    /**
     * The send made one request, of the pinned payload, and its batch row
     * stores the same hash.
     */
    const expectPinnedPayload = async (
      name: keyof typeof pinnedPayloadHashes,
      requests: ReturnType<typeof deliveryLayer>["requests"]
    ) => {
      const sendId = sendIds[name];
      const requested = requests();
      expect(requested.map(({ key, to }) => ({ key, to }))).toEqual([
        {
          key: `email-campaign:${sendId}:attempt-1:batch-0`,
          to: profiles.map(({ email }) => email!),
        },
      ]);
      expect(sha256(requested[0]!.payload)).toBe(pinnedPayloadHashes[name]);
      const { rows: batches } = await pool.query(
        "select delivery_attempt, batch_index, payload_hash from email_campaign_delivery_batches where send_id = $1",
        [sendId]
      );
      expect(batches).toEqual([
        {
          delivery_attempt: 1,
          batch_index: 0,
          payload_hash: pinnedPayloadHashes[name],
        },
      ]);
    };

    const purposes: readonly CampaignPurpose[] = ["marketing", "operational"];

    test.each(purposes)(
      "a one-off %s send requests the pinned payload",
      async (purpose) => {
        const name = `one-off ${purpose}` as const;
        const { layer, requests } = deliveryLayer();
        const sendId = sendIds[name] as CampaignSendId;
        await seedCampaignSend(db, {
          sendId,
          purpose,
          content,
          recipients,
        });

        await Effect.runPromise(
          Effect.flatMap(CampaignDeliveryService, (delivery) =>
            delivery.deliverAttempt({ sendId, deliveryAttempt: 1 })
          ).pipe(Effect.provide(layer))
        );

        await expectPinnedPayload(name, requests);
      }
    );

    test.each(purposes)(
      "an automated %s send requests the pinned payload",
      async (purpose) => {
        const name = `automated ${purpose}` as const;
        const { layer, requests } = deliveryLayer();
        const sendId = sendIds[name] as CampaignSendId;
        const campaignId = await seedAutomatedCampaign(db, { purpose });
        const versionId = await seedAutomationVersion(db, {
          campaignId,
          purpose,
          content,
        });
        await seedAutomatedSend(db, {
          sendId,
          campaignId,
          versionId,
          purpose,
          recipients: [],
        });
        const read = new Map(profiles.map((profile) => [profile.id!, profile]));

        await Effect.runPromise(
          Effect.gen(function* () {
            const sends = yield* makeAutomatedCampaignSend;
            const { transaction } = yield* WorkspaceDatabase;
            yield* transaction(
              sends.persistBatch({
                sendId,
                recipients,
                profiles: read,
                at: Temporal.Now.instant(),
              })
            );
            yield* sends.submit({
              sendId,
              profiles: Option.some(read),
            });
          }).pipe(Effect.provide(layer))
        );

        await expectPinnedPayload(name, requests);
      }
    );
  }
);
