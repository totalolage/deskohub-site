import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import { EmailConfigTag, EmailServiceTag } from "@deskohub/email";
import {
  type EmailProviderFakeResponse,
  makeEmailProviderFake,
} from "@deskohub/email/testing";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit, Fiber, Layer } from "effect";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deliverProfile,
  makeDeliverEngine,
  seedDeliverAutomation,
  seedSendReadyRuns,
} from "../automation/backend/deliver.test-utils";
import type { CampaignId, CampaignSendId } from "../campaign-identifiers";
import { CampaignDeliveryService } from "./campaign-delivery.service";
import { campaignDeliveryTestLayer } from "./campaign-delivery.test-utils";
import { CampaignEmailConfig } from "./campaign-email.config";
import {
  deleteAutomatedCampaigns,
  deleteCampaigns,
  seedCampaignSend,
} from "./email-campaigns.test-utils";

/**
 * Pins what every batch a one-off run or a deliver unit persists must keep
 * across a change to the batch protocol: the key it is requested under, the
 * identical payload its replay sends under that key, and the recipient and
 * batch statuses each outcome leaves. A batch already `requested` when the
 * change deploys is replayed by the changed code, so change these values
 * only for a deliberate change to delivery.
 */
const pinnedOneOffPayloadHashes = {
  replayed: "723b5b086293f9dbd89f5d9a56295f358f85a793ae40c6e861e3ea6aa312d53e",
  inFlight: "a04e8d48a336c15ca59d0260d86e56402b07bd9fc1e1ca4598fa943bf20abeb9",
} as const;

/** Fixed sends, so their keys and payloads are fixed too. */
const oneOffSendIds = {
  replayed: "019a5c55-0000-7000-8000-000000000101",
  inFlight: "019a5c55-0000-7000-8000-000000000102",
} as const satisfies Record<keyof typeof pinnedOneOffPayloadHashes, string>;

/**
 * The automation engine plans over whole tables, so the suite runs on a
 * database of its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "campaign_batch_delivery"
);
afterAll(() => database?.close());

const run = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`batch-${run}-${name}`);
/** A fixed customer, for the pinned payload. */
const pinnedCustomer = DotyposCustomerIdSchema.make("batch-pin-ada");

const sha256 = (payload: string) =>
  createHash("sha256").update(payload).digest("hex");

/** Monday 19 October 2026, 12:00 in Prague. */
const startedAt = Temporal.Instant.from("2026-10-19T10:00:00Z");

describe.skipIf(!database)(
  "campaign batch delivery on disposable Postgres",
  () => {
    if (!database) return;
    const { db, pool } = database;
    const campaignIds: string[] = [];
    const automatedCampaignIds: CampaignId[] = [];

    afterAll(async () => {
      await deleteCampaigns(pool, campaignIds);
      await deleteAutomatedCampaigns(db, automatedCampaignIds);
    });

    /** The send's recipients and batches, as delivery left them. */
    const statusesOf = async (sendId: string) => {
      const { rows: recipients } = await pool.query<{
        dotypos_customer_id: string;
        status: string;
      }>(
        "select dotypos_customer_id, status from email_campaign_recipients where send_id = $1 order by dotypos_customer_id",
        [sendId]
      );
      const { rows: batches } = await pool.query<{ status: string }>(
        "select status from email_campaign_delivery_batches where send_id = $1 order by delivery_attempt, batch_index",
        [sendId]
      );
      return {
        recipients: Object.fromEntries(
          recipients.map((row) => [row.dotypos_customer_id, row.status])
        ),
        batches: batches.map((batch) => batch.status),
      };
    };

    const storedPayloadHashes = async (sendId: string) => {
      const { rows } = await pool.query<{ payload_hash: string }>(
        "select payload_hash from email_campaign_delivery_batches where send_id = $1 order by delivery_attempt, batch_index",
        [sendId]
      );
      return rows.map((row) => row.payload_hash);
    };

    describe("a one-off send's run", () => {
      let profiles: DotyposCustomer[] = [];
      const provider = makeEmailProviderFake();
      let requestsBefore = 0;

      beforeEach(() => {
        requestsBefore = provider.requests().length;
        provider.respondWith(() => "accept");
      });

      /** Requests the provider received in the current test. */
      const requests = () => provider.requests().slice(requestsBefore);

      const layer = campaignDeliveryTestLayer(
        Layer.mergeAll(
          DotyposServiceMock({
            getCustomersByIds: (ids) =>
              makeInMemoryDotypos({
                customers: profiles,
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
      ).pipe(Layer.provide(database.layer));

      const deliver = (sendId: CampaignSendId) =>
        Effect.flatMap(CampaignDeliveryService, (delivery) =>
          delivery.deliverAttempt({ sendId, deliveryAttempt: 1 })
        ).pipe(Effect.provide(layer));

      /** The run ends; a failure redelivers its message. */
      const consume = (sendId: CampaignSendId) =>
        Effect.runPromiseExit(deliver(sendId));

      /**
       * Cuts the run off while its request is with the provider, as the
       * platform's time limit would, before the provider answered.
       */
      const cutOff = async (sendId: CampaignSendId) => {
        provider.respondWith(() => "hang");
        const reached = provider.nextRequest();
        const running = Effect.runFork(deliver(sendId));
        await reached;
        await Effect.runPromise(Fiber.interrupt(running));
      };

      const seedSend = async (input: {
        readonly sendId?: CampaignSendId;
        readonly recipients: readonly DotyposCustomerId[];
      }) => {
        profiles = input.recipients.map((id) => deliverProfile(id));
        const seeded = await seedCampaignSend(db, {
          sendId: input.sendId,
          purpose: "operational",
          recipients: input.recipients.map((dotyposCustomerId) => ({
            dotyposCustomerId,
          })),
        });
        campaignIds.push(seeded.campaignId);
        return seeded.sendId;
      };

      test.each<
        readonly [string, EmailProviderFakeResponse, "sent" | "failed", string]
      >([
        ["accepted", "accept", "sent", "accepted"],
        ["refused", "refuse", "failed", "rejected"],
      ])(
        "a first request the provider %s settles its batch",
        async (_label, response, recipientStatus, batchStatus) => {
          const id = customerId(`once-first-${response}`);
          const sendId = await seedSend({ recipients: [id] });
          provider.respondWith(() => response);

          expect(Exit.isSuccess(await consume(sendId))).toBe(true);

          expect(requests().map(({ key }) => key)).toEqual([
            `email-campaign:${sendId}:attempt-1:batch-0`,
          ]);
          expect(await statusesOf(sendId)).toEqual({
            recipients: { [id]: recipientStatus },
            batches: [batchStatus],
          });
        }
      );

      test("an unknown outcome leaves the batch requested, and the next run replays its identical payload under the same key", async () => {
        const sendId = await seedSend({
          sendId: oneOffSendIds.replayed as CampaignSendId,
          recipients: [pinnedCustomer],
        });
        provider.respondWith(() => "accept-lost");

        expect(Exit.isFailure(await consume(sendId))).toBe(true);
        expect(await statusesOf(sendId)).toEqual({
          recipients: { [pinnedCustomer]: "pending" },
          batches: ["requested"],
        });

        provider.respondWith(() => "accept");
        expect(Exit.isSuccess(await consume(sendId))).toBe(true);

        const key = `email-campaign:${oneOffSendIds.replayed}:attempt-1:batch-0`;
        const [first, replay] = requests();
        expect([first?.key, replay?.key]).toEqual([key, key]);
        expect(replay?.payload).toBe(first?.payload);
        expect(sha256(replay!.payload)).toBe(
          pinnedOneOffPayloadHashes.replayed
        );
        expect(await storedPayloadHashes(sendId)).toEqual([
          pinnedOneOffPayloadHashes.replayed,
        ]);
        expect(provider.mailed().slice(-1)).toEqual([
          testEmailAddress(pinnedCustomer),
        ]);
        expect(await statusesOf(sendId)).toEqual({
          recipients: { [pinnedCustomer]: "sent" },
          batches: ["accepted"],
        });
      });

      test.each<
        readonly [string, (sendId: CampaignSendId) => Promise<unknown>]
      >([
        [
          "the provider refuses its replay",
          async () => provider.respondWith(() => "refuse"),
        ],
        [
          "its payload changed",
          async () => {
            profiles = profiles.map((profile) =>
              deliverProfile(profile.id!, {
                email: testEmailAddress(`${profile.id}-new`),
              })
            );
          },
        ],
        [
          "its key's replay window passed",
          (sendId) =>
            pool.query(
              "update email_campaign_delivery_batches set requested_at = now() - interval '23 hours 1 minute' where send_id = $1",
              [sendId]
            ),
        ],
      ])(
        "a batch with an unknown outcome is unconfirmed when %s",
        async (label, change) => {
          const id = customerId(`once-${label.split(" ").at(-1)}`);
          const sendId = await seedSend({ recipients: [id] });
          await cutOff(sendId);
          expect(await statusesOf(sendId)).toEqual({
            recipients: { [id]: "pending" },
            batches: ["requested"],
          });

          provider.respondWith(() => "accept");
          await change(sendId);
          expect(Exit.isSuccess(await consume(sendId))).toBe(true);

          const key = `email-campaign:${sendId}:attempt-1:batch-0`;
          expect(requests().map((request) => request.key)).toEqual(
            label === "the provider refuses its replay" ? [key, key] : [key]
          );
          expect(await statusesOf(sendId)).toEqual({
            recipients: { [id]: "unconfirmed" },
            batches: ["unconfirmed"],
          });
        }
      );

      test("a batch persisted before a change replays its pinned payload under its key", async () => {
        const sendId = await seedSend({
          sendId: oneOffSendIds.inFlight as CampaignSendId,
          recipients: [pinnedCustomer],
        });
        // Persisted as a run cut off mid-request left it, its hash pinned.
        await pool.query(
          "insert into email_campaign_delivery_batches (send_id, delivery_attempt, batch_index, dotypos_customer_ids, payload_hash, requested_at) values ($1, 1, 0, $2, $3, now())",
          [sendId, [pinnedCustomer], pinnedOneOffPayloadHashes.inFlight]
        );

        expect(Exit.isSuccess(await consume(sendId))).toBe(true);

        const [replay] = requests();
        expect(replay?.key).toBe(
          `email-campaign:${oneOffSendIds.inFlight}:attempt-1:batch-0`
        );
        expect(sha256(replay!.payload)).toBe(
          pinnedOneOffPayloadHashes.inFlight
        );
        expect(await statusesOf(sendId)).toEqual({
          recipients: { [pinnedCustomer]: "sent" },
          batches: ["accepted"],
        });
      });
    });

    describe("an automated send's deliver unit", () => {
      // A test that failed midway can't hold the deliver slot for the next.
      beforeEach(() =>
        pool.query(
          `update email_campaign_automation_work_units
            set status = 'dropped', claim_id = null, claim_expires_at = null, settled_at = now()
          where campaign_id = any($1) and status in ('planned', 'enqueued', 'claimed')`,
          [automatedCampaignIds]
        )
      );

      /** An engine with one send-ready run of a new automation for `id`. */
      const setUp = async (id: DotyposCustomerId) => {
        const engine = await makeDeliverEngine({
          database,
          customers: [deliverProfile(id)],
        });
        const seeded = await seedDeliverAutomation(db, {
          activatedAt: startedAt.subtract({ hours: 48 }),
        });
        automatedCampaignIds.push(seeded.campaignId);
        await seedSendReadyRuns(db, {
          ...seeded,
          runs: [{ customer: id }],
          at: startedAt,
        });
        const sendOf = async () => {
          const {
            rows: [send],
          } = await pool.query<{ id: string }>(
            "select id from email_campaign_sends where campaign_id = $1",
            [seeded.campaignId]
          );
          return send!.id;
        };
        return { engine, sendOf };
      };

      test.each<
        readonly [string, EmailProviderFakeResponse, "sent" | "failed", string]
      >([
        ["accepted", "accept", "sent", "accepted"],
        ["refused", "refuse", "failed", "rejected"],
      ])(
        "a first request the provider %s settles its batch",
        async (_label, response, recipientStatus, batchStatus) => {
          const id = customerId(`unit-first-${response}`);
          const { engine, sendOf } = await setUp(id);
          engine.resend.respondWith(() => response);

          await engine.tick(startedAt);

          const sendId = await sendOf();
          expect(engine.resend.requests().map(({ key }) => key)).toEqual([
            `email-campaign:${sendId}:attempt-1:batch-0`,
          ]);
          expect(await statusesOf(sendId)).toEqual({
            recipients: { [id]: recipientStatus },
            batches: [batchStatus],
          });
        }
      );

      test("an unknown outcome is replayed with its identical payload under the same key", async () => {
        const id = customerId("unit-unknown");
        const { engine, sendOf } = await setUp(id);
        engine.resend.respondWith(() => "accept-lost");

        await engine.tick(startedAt);

        const sendId = await sendOf();
        const key = `email-campaign:${sendId}:attempt-1:batch-0`;
        const [first, replay] = engine.resend.requests();
        expect([first?.key, replay?.key]).toEqual([key, key]);
        expect(replay?.payload).toBe(first?.payload);
        expect(await storedPayloadHashes(sendId)).toEqual([
          sha256(replay!.payload),
        ]);
        expect(engine.resend.mailed()).toEqual([testEmailAddress(id)]);
        expect(await statusesOf(sendId)).toEqual({
          recipients: { [id]: "sent" },
          batches: ["accepted"],
        });
      });

      test.each<
        readonly [
          string,
          (engine: Awaited<ReturnType<typeof setUp>>["engine"]) => void,
          Temporal.Instant,
        ]
      >([
        [
          "the provider refuses its replay",
          (engine) => engine.resend.respondWith(() => "refuse"),
          startedAt.add({ minutes: 6 }),
        ],
        [
          "its payload changed",
          (engine) =>
            engine.dotypos.setCustomers(
              [...engine.dotypos.customers.values()].map((customer) =>
                deliverProfile(customer.id!, {
                  email: testEmailAddress(`${customer.id}-new`),
                })
              )
            ),
          startedAt.add({ minutes: 6 }),
        ],
        [
          "its key's replay window passed",
          () => {},
          startedAt.add({ hours: 23, minutes: 1 }),
        ],
      ])(
        "a batch with an unknown outcome is unconfirmed when %s",
        async (label, change, replayAt) => {
          const id = customerId(`unit-${label.split(" ").at(-1)}`);
          const { engine, sendOf } = await setUp(id);
          engine.resend.respondWith(() => "hang");
          await engine.killDuringRequest(startedAt);
          const sendId = await sendOf();
          expect(await statusesOf(sendId)).toEqual({
            recipients: { [id]: "pending" },
            batches: ["requested"],
          });

          engine.resend.respondWith(() => "accept");
          change(engine);
          await engine.tick(replayAt);

          const key = `email-campaign:${sendId}:attempt-1:batch-0`;
          expect(
            engine.resend.requests().map((request) => request.key)
          ).toEqual(
            label === "the provider refuses its replay" ? [key, key] : [key]
          );
          expect(engine.resend.mailed()).toEqual([]);
          expect(await statusesOf(sendId)).toEqual({
            recipients: { [id]: "unconfirmed" },
            batches: ["unconfirmed"],
          });
        }
      );
    });
  }
);
