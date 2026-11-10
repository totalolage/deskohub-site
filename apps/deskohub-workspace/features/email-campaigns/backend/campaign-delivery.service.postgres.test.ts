import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReadFailure,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import type {
  EmailBatchResult,
  EmailMessage,
  EmailSendError,
  EmailSendFailure,
  EmailSendResult,
} from "@deskohub/email";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerMarketingConsents } from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { campaignEmailKind } from "../campaign-email-kind";
import type { CampaignId, CampaignSendId } from "../campaign-identifiers";
import type { CampaignDeliveryEvent } from "./campaign-delivery-status.service";
import {
  analyticsConsentLedgerOf,
  deleteAutomatedCampaigns,
  deleteCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
  seedCampaignSend,
} from "./email-campaigns.test-utils";

type BatchEmail = {
  readonly to: readonly string[];
  readonly subject: string;
  readonly headers?: Record<string, string>;
  readonly tags?: readonly { name: string; value: string }[];
};
type BatchSendResponse =
  | { readonly data: { readonly data: readonly { id: string }[] } }
  | {
      readonly data: null;
      readonly error: { message: string; statusCode: number };
    };

/**
 * Resend's idempotency contract: a key replayed with the identical payload
 * returns the accepted batch without mailing it again, and a key reused with
 * a different payload is rejected. `mailed` lists every email it really sent.
 */
let providerIds = 0;
const acceptedKeys = new Map<
  string,
  { readonly payload: string; readonly ids: readonly string[] }
>();
let mailed: string[] = [];
const acceptBatch = async (
  payload: readonly BatchEmail[],
  options: { readonly idempotencyKey: string }
): Promise<BatchSendResponse> => {
  const body = JSON.stringify(payload);
  const accepted = acceptedKeys.get(options.idempotencyKey);
  if (accepted && accepted.payload !== body) {
    return {
      data: null,
      error: { message: "invalid_idempotent_request", statusCode: 409 },
    };
  }
  const ids =
    accepted?.ids ?? payload.map(() => `resend-${run}-${++providerIds}`);
  if (!accepted) {
    acceptedKeys.set(options.idempotencyKey, { payload: body, ids });
    mailed.push(...payload.flatMap(({ to }) => to));
  }
  return { data: { data: ids.map((id) => ({ id })) } };
};
/** A request that never answers, as when the consumer is cut off. */
const hang = () => new Promise<BatchSendResponse>(() => {});
const rateLimited: BatchSendResponse = {
  data: null,
  error: { message: "Too many requests", statusCode: 429 },
};

/** A call that stops where the test can see it until the test lets it go. */
const pause = () => {
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  return {
    reached: reached.promise,
    reach: () => reached.resolve(),
    released: released.promise,
    release: () => released.resolve(),
  };
};
let batchSend =
  mock<
    (
      payload: readonly BatchEmail[],
      options: { readonly idempotencyKey: string }
    ) => Promise<BatchSendResponse>
  >(acceptBatch);

mock.module("resend", () => ({
  Resend: class {
    batch = {
      send: (...args: Parameters<typeof batchSend>) => batchSend(...args),
    };
    emails = { send: mock() };
    domains = { list: mock() };
  },
}));

const {
  EmailConfigTag,
  EmailDeliveryIdSchema,
  EmailProviders,
  EmailServiceError,
  EmailServiceTag,
  NetworkError,
} = await import("@deskohub/email");
const { makeResendEmailProvider, resendRequestTimeouts } = await import(
  "@deskohub/email-resend"
);
const { AnalyticsConsentLedger } = await import(
  "@/features/legal/backend/analytics-consent-ledger"
);
const { connectWorkspacePostgresTestDatabase } = await import(
  "@/shared/testing/workspace-postgres-test-database.test-utils"
);
const { AutomatedSendSubmission, CampaignDeliveryService } = await import(
  "./campaign-delivery.service"
);
const { campaignDeliveryTestLayer } = await import(
  "./campaign-delivery.test-utils"
);
const { CampaignDeliveryStatusService } = await import(
  "./campaign-delivery-status.service"
);
const { CampaignEmailConfig } = await import("./campaign-email.config");
const { processCampaignSendMessage } = await import(
  "./campaign-send-queue-consumer"
);
const { OnceCampaignLifecycle } = await import("./once-campaign-lifecycle");

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`delivery-${run}-${name}`);

describe.skipIf(!testDatabase)(
  "campaign send queue consumer on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;
    const campaignIds: string[] = [];
    const automatedCampaignIds: CampaignId[] = [];
    const consentCustomerIds: DotyposCustomerId[] = [];
    const linkedCustomerIds: DotyposCustomerId[] = [];

    afterAll(async () => {
      await deleteCampaigns(testDatabase.pool, campaignIds);
      await deleteAutomatedCampaigns(db, automatedCampaignIds);
      await testDatabase.pool.query(
        "delete from customer_marketing_consents where dotypos_customer_id = any($1)",
        [consentCustomerIds]
      );
      await testDatabase.pool.query(
        "delete from customer_accounts where dotypos_customer_id = any($1)",
        [linkedCustomerIds]
      );
    });

    beforeEach(() => {
      batchSend = mock(acceptBatch);
      readCustomers = readProfiles;
      mailed = [];
    });

    let profiles: DotyposCustomer[] = [];
    const readProfiles = (ids: readonly DotyposCustomerId[]) =>
      Effect.succeed(
        profiles.filter(
          (customer) => customer.id !== undefined && ids.includes(customer.id)
        )
      );
    let readCustomers: (
      ids: readonly DotyposCustomerId[]
    ) => Effect.Effect<DotyposCustomer[], DotyposReadFailure> = readProfiles;
    const profile = (
      id: DotyposCustomerId,
      overrides: Partial<DotyposCustomer> = {}
    ) =>
      ({
        id,
        _cloudId: "cloud",
        email: testEmailAddress(id),
        points: "0",
        flags: "0",
        display: true,
        deleted: false,
        ...overrides,
      }) as DotyposCustomer;

    const resend = makeResendEmailProvider({
      apiKey: "re_test",
      timeouts: resendRequestTimeouts.nonProduction,
    });
    const resendEmailLayer = EmailServiceTag.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(EmailProviders, {
            transactional: [resend],
            marketing: [resend],
            marketingCategories: new Set(["email-campaign"]),
          }),
          Layer.succeed(EmailConfigTag, {
            defaultFrom: { email: testEmailAddress("campaigns") },
          })
        )
      )
    );

    const consumerLayerFor = (
      deploymentEnvironment: "production" | "development",
      {
        email = resendEmailLayer,
        analyticsConsent = AnalyticsConsentLedger.Default,
      }: {
        readonly email?: Layer.Layer<Layer.Success<typeof resendEmailLayer>>;
        readonly analyticsConsent?: Layer.Layer<
          Layer.Success<typeof AnalyticsConsentLedger.Default>,
          never,
          WorkspaceDatabase
        >;
      } = {}
    ) =>
      campaignDeliveryTestLayer(
        Layer.mergeAll(
          email,
          DotyposServiceMock({
            getCustomersByIds: (ids) =>
              readCustomers(ids).pipe(
                Effect.flatMap((records) =>
                  makeInMemoryDotypos({
                    customers: records,
                  }).service.getCustomersByIds(ids)
                )
              ),
          }),
          Layer.succeed(CampaignEmailConfig, {
            deploymentEnvironment,
            from: { email: testEmailAddress("campaigns") },
            replyTo: { email: testEmailAddress("hello") },
            adminInbox: testEmailAddress("admin"),
          })
        ),
        analyticsConsent
      ).pipe(Layer.provide(testDatabase.layer));

    const consumerLayer = consumerLayerFor("development");

    const consume = (
      message: Parameters<typeof processCampaignSendMessage>[0],
      layer = consumerLayer
    ) =>
      Effect.runPromise(
        processCampaignSendMessage(message).pipe(Effect.provide(layer))
      );

    /**
     * Runs the consumer until `timeout`, then cuts it off as the platform
     * would at its time limit. Returns whether it finished.
     */
    const consumeCutOff = (
      message: Parameters<typeof processCampaignSendMessage>[0],
      timeout = "1 second"
    ) =>
      Effect.runPromise(
        processCampaignSendMessage(message).pipe(
          Effect.provide(consumerLayer),
          Effect.timeoutOption(timeout),
          Effect.map(Option.isSome)
        )
      );

    /** The consumer's run fails, so the queue redelivers the message. */
    const consumeFails = async (
      message: Parameters<typeof processCampaignSendMessage>[0]
    ) => {
      const exit = await Effect.runPromiseExit(
        processCampaignSendMessage(message).pipe(Effect.provide(consumerLayer))
      );
      expect(exit._tag).toBe("Failure");
    };

    /** Starts a run without waiting for it; resolves to how it ended. */
    const consumeConcurrently = (
      message: Parameters<typeof processCampaignSendMessage>[0]
    ) =>
      Effect.runPromiseExit(
        processCampaignSendMessage(message).pipe(Effect.provide(consumerLayer))
      );

    /** The run that owns the send outlives its lease, as a stalled one would. */
    const expireLease = (sendId: string) =>
      testDatabase.pool.query(
        "update email_campaign_sends set delivery_lease_expires_at = now() - interval '1 second' where id = $1 and delivery_lease_id is not null",
        [sendId]
      );

    const recordWebhook = (event: {
      readonly type: Option.Option.Value<CampaignDeliveryEvent["type"]>;
      readonly providerMessageId: string;
      readonly sendId: string;
      readonly dotyposCustomerId: string;
    }) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const statuses = yield* CampaignDeliveryStatusService;
          return yield* statuses.record({
            type: Option.some(event.type),
            providerMessageId: event.providerMessageId,
            // Decoded the way the webhook decodes the email's tags.
            recipient: Option.fromUndefinedOr(
              decodeStandardSchema(campaignEmailKind.metadata, {
                campaignSendId: event.sendId,
                dotyposCustomerId: event.dotyposCustomerId,
              })
            ),
            occurredAt: Temporal.Now.instant(),
          });
        }).pipe(
          Effect.provide(
            CampaignDeliveryStatusService.Default.pipe(
              Layer.provide(testDatabase.layer)
            )
          )
        )
      );

    const seedSend = async (input: Parameters<typeof seedCampaignSend>[1]) => {
      const seeded = await seedCampaignSend(db, input);
      campaignIds.push(seeded.campaignId);
      return seeded;
    };

    const grantConsent = async (
      ids: readonly DotyposCustomerId[],
      withdrawn = false
    ) => {
      consentCustomerIds.push(...ids);
      const grantedAt = Temporal.Instant.from("2026-01-01T00:00:00Z");
      await Effect.runPromise(
        db.insert(customerMarketingConsents).values(
          ids.map((dotyposCustomerId) => ({
            dotyposCustomerId,
            documentHash: "hash",
            locale: "cs-CZ" as const,
            grantedAt,
            withdrawnAt: withdrawn ? grantedAt : null,
          }))
        )
      );
    };

    const stored = async (sendId: string) => {
      const { rows: recipients } = await testDatabase.pool.query(
        "select dotypos_customer_id, status, skip_reason, provider_message_id, failure_code from email_campaign_recipients where send_id = $1 order by dotypos_customer_id",
        [sendId]
      );
      const {
        rows: [campaign],
      } = await testDatabase.pool.query(
        "select c.status, s.completed_at from email_campaign_sends s join email_campaigns c on c.id = s.campaign_id where s.id = $1",
        [sendId]
      );
      const { rows: batches } = await testDatabase.pool.query(
        "select delivery_attempt, batch_index, dotypos_customer_ids, status from email_campaign_delivery_batches where send_id = $1 order by delivery_attempt, batch_index",
        [sendId]
      );
      return { recipients, campaign, batches };
    };

    const statusesOf = (
      recipients: readonly { dotypos_customer_id: string; status: string }[]
    ) =>
      Object.fromEntries(
        recipients.map((row) => [row.dotypos_customer_id, row.status])
      );

    const requestKeys = () =>
      batchSend.mock.calls.map(([, options]) => options.idempotencyKey);
    const requestPayloads = () =>
      batchSend.mock.calls.map(([payload]) => JSON.stringify(payload));

    /**
     * A provider chain that answers each email of a batch on its own, as the
     * marketing chain does: `answer` gives each email's result, by the
     * recipient it's for and the request's position among this chain's
     * requests. `failRequest` instead fails a whole request, as when no
     * provider answered.
     */
    const answeringEachEmail = ({
      answer,
      failRequest = () => undefined,
    }: {
      readonly answer: (input: {
        readonly recipient: string;
        readonly request: number;
      }) => EmailSendResult | EmailSendFailure;
      readonly failRequest?: (request: number) => EmailSendError | undefined;
    }) => {
      const requests: {
        readonly messages: readonly EmailMessage[];
        readonly idempotencyKey: string;
        readonly replay: boolean;
      }[] = [];
      const layer = Layer.succeed(EmailServiceTag, {
        send: () => Effect.die("campaigns send batches"),
        sendBatch: (messages: readonly EmailMessage[], options) =>
          Effect.suspend(() => {
            const request =
              requests.push({
                messages,
                idempotencyKey: options.idempotencyKey,
                replay: options.replay ?? false,
              }) - 1;
            const failure = failRequest(request);
            if (failure) return Effect.fail(failure);
            return Effect.succeed(
              messages.map(
                (message): EmailBatchResult =>
                  answer({
                    recipient: String(message.metadata?.dotyposCustomerId),
                    request,
                  })
              )
            );
          }),
      });
      return { layer, requests };
    };
    const acceptedBy = (provider: string, id: string): EmailSendResult => ({
      id: EmailDeliveryIdSchema.make(id),
      status: "sent",
      provider,
      timestamp: new Date(),
    });
    /** Every provider refused the email; the last one gave `code`. */
    const refusedEverywhere = (code: string): EmailSendFailure => ({
      status: "failed",
      provider: "resend",
      timestamp: new Date(),
      error: new EmailServiceError(`Refused: ${code}`, undefined, "resend", {
        failureKind: "message",
        code,
      }),
    });
    /** The email's last provider never answered, so it may have sent it. */
    const unanswered = (): EmailSendFailure => ({
      status: "failed",
      provider: "posthog",
      timestamp: new Date(),
      error: new NetworkError({ message: "Timed out", code: "timeout" }),
    });
    const lostRequest = () => new NetworkError({ message: "Timed out" });

    /** Runs the consumer to its end; resolves to whether it failed. */
    const consumeExit = (
      message: Parameters<typeof processCampaignSendMessage>[0],
      layer: typeof consumerLayer
    ) =>
      Effect.runPromiseExit(
        processCampaignSendMessage(message).pipe(Effect.provide(layer))
      ).then(Exit.isFailure);

    test("sends an attempt in batches of 100, each under its own key", async () => {
      const ids = Array.from({ length: 101 }, (_, index) =>
        customerId(`bulk-${String(index).padStart(3, "0")}`)
      );
      profiles = ids.map((id) => profile(id));
      await grantConsent(ids);
      const { sendId } = await seedSend({
        purpose: "marketing",
        recipients: ids.map((dotyposCustomerId) => ({ dotyposCustomerId })),
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(batchSend.mock.calls.map(([payload]) => payload.length)).toEqual([
        100, 1,
      ]);
      expect(
        batchSend.mock.calls.map(([, options]) => options.idempotencyKey)
      ).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-1`,
      ]);
      const [first] = batchSend.mock.calls[0]![0];
      expect(first).toMatchObject({
        to: [testEmailAddress(ids[0]!)],
        subject: "Novinky",
        headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      expect(first!.headers!["List-Unsubscribe"]).toMatch(
        /^<https?:\/\/.+\/api\/email-campaigns\/unsubscribe\?token=.+>$/
      );
      expect(first!.tags).toEqual(
        expect.arrayContaining([
          { name: "category", value: "email-campaign" },
          { name: "campaignSendId", value: sendId },
          { name: "dotyposCustomerId", value: ids[0] },
        ])
      );

      const { recipients, campaign } = await stored(sendId);
      expect(recipients.every((row) => row.status === "sent")).toBe(true);
      expect(
        new Set(recipients.map((row) => row.provider_message_id)).size
      ).toBe(101);
      expect(campaign.status).toBe("sent");
      expect(campaign.completed_at).not.toBeNull();
    });

    test("skips recipients who withdrew consent or lost a valid email", async () => {
      const reachable = customerId("skip-reachable");
      const withdrawn = customerId("skip-withdrawn");
      const invalidEmail = customerId("skip-invalid-email");
      const deleted = customerId("skip-deleted");
      profiles = [
        profile(reachable),
        profile(withdrawn),
        profile(invalidEmail, { email: "not-an-email" }),
        profile(deleted, { deleted: true }),
      ];
      await grantConsent([reachable, invalidEmail, deleted]);
      await grantConsent([withdrawn], true);
      const { sendId } = await seedSend({
        purpose: "marketing",
        recipients: [reachable, withdrawn, invalidEmail, deleted].map(
          (dotyposCustomerId) => ({ dotyposCustomerId })
        ),
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(batchSend.mock.calls).toHaveLength(1);
      expect(batchSend.mock.calls[0]![0].map(({ to }) => to)).toEqual([
        [testEmailAddress(reachable)],
      ]);
      const { recipients, campaign } = await stored(sendId);
      expect(
        Object.fromEntries(
          recipients.map((row) => [
            row.dotypos_customer_id,
            [row.status, row.skip_reason],
          ])
        )
      ).toEqual({
        [reachable]: ["sent", null],
        [withdrawn]: ["skipped", "consent-withdrawn"],
        [invalidEmail]: ["skipped", "invalid-email"],
        [deleted]: ["skipped", "deleted-customer"],
      });
      expect(campaign.status).toBe("sent");
    });

    test("mails operational recipients without consent or unsubscribe headers", async () => {
      const id = customerId("operational");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      const [message] = batchSend.mock.calls[0]![0];
      expect(message!.headers).toBeUndefined();
    });

    test("fails the campaign when the provider rejects a batch", async () => {
      batchSend = mock(async () => ({
        data: null,
        error: { message: "Invalid batch", statusCode: 422 },
      }));
      const id = customerId("rejected");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("failed");

      const { recipients, campaign, batches } = await stored(sendId);
      expect(recipients.map((row) => row.status)).toEqual(["failed"]);
      expect(batches.map((batch) => batch.status)).toEqual(["rejected"]);
      expect(campaign.status).toBe("failed");
    });

    test("settles each recipient by its own email's outcome", async () => {
      const sent = customerId("each-sent");
      const refused = customerId("each-refused");
      const unknown = customerId("each-unknown");
      profiles = [sent, refused, unknown].map((id) => profile(id));
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [sent, refused, unknown].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });
      const answers = new Map([
        [sent, () => acceptedBy("posthog", `posthog-${run}-each`)],
        [refused, () => refusedEverywhere("recipient_suppressed")],
        [unknown, unanswered],
      ]);
      const chain = answeringEachEmail({
        answer: ({ recipient }) =>
          (
            answers.get(DotyposCustomerIdSchema.make(recipient)) ?? unanswered
          )(),
      });

      expect(
        await consume(
          { sendId, deliveryAttempt: 1 },
          consumerLayerFor("development", { email: chain.layer })
        )
      ).toBe("failed");

      // Neither undelivered recipient is requested again.
      expect(chain.requests).toHaveLength(1);
      const { recipients, batches, campaign } = await stored(sendId);
      expect(
        Object.fromEntries(
          recipients.map((row) => [
            row.dotypos_customer_id,
            [row.status, row.provider_message_id, row.failure_code],
          ])
        )
      ).toEqual({
        [sent]: ["sent", `posthog-${run}-each`, null],
        [refused]: ["failed", null, "recipient_suppressed"],
        // No provider answered for this one, so it may have been mailed:
        // only a retry that includes unconfirmed recipients resends it.
        [unknown]: ["unconfirmed", null, "timeout"],
      });
      expect(batches.map((batch) => batch.status)).toEqual(["accepted"]);
      expect(campaign.status).toBe("failed");
    });

    test("replays a batch no provider answered, and treats an email refused on replay as unconfirmed", async () => {
      const sent = customerId("replay-each-sent");
      const refused = customerId("replay-each-refused");
      profiles = [sent, refused].map((id) => profile(id));
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [sent, refused].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });
      const chain = answeringEachEmail({
        failRequest: (request) => (request === 0 ? lostRequest() : undefined),
        answer: ({ recipient }) =>
          recipient === sent
            ? acceptedBy("resend", `resend-${run}-replayed`)
            : refusedEverywhere("recipient_suppressed"),
      });
      const layer = consumerLayerFor("development", { email: chain.layer });

      expect(await consumeExit({ sendId, deliveryAttempt: 1 }, layer)).toBe(
        true
      );
      const interrupted = await stored(sendId);
      expect(interrupted.batches.map((batch) => batch.status)).toEqual([
        "requested",
      ]);
      expect(statusesOf(interrupted.recipients)).toEqual({
        [sent]: "pending",
        [refused]: "pending",
      });

      expect(await consume({ sendId, deliveryAttempt: 1 }, layer)).toBe(
        "failed"
      );

      const [first, replay] = chain.requests;
      expect(replay?.idempotencyKey).toBe(first?.idempotencyKey);
      // The replay stays with the provider that may have taken the first.
      expect(chain.requests.map((request) => request.replay)).toEqual([
        false,
        true,
      ]);
      expect(JSON.stringify(replay?.messages)).toBe(
        JSON.stringify(first?.messages)
      );
      const { recipients, batches } = await stored(sendId);
      // The first request may have mailed the email the replay refused.
      expect(statusesOf(recipients)).toEqual({
        [sent]: "sent",
        [refused]: "unconfirmed",
      });
      expect(batches.map((batch) => batch.status)).toEqual(["accepted"]);
    });

    test("names a consenting recipient's account in its email, as consent stands at each request", async () => {
      const consenting = customerId("identity-consenting");
      const undecided = customerId("identity-undecided");
      profiles = [consenting, undecided].map((id) => profile(id));
      const fixtures = workspaceFixtures(db);
      const consentingAccount = await Effect.runPromise(
        fixtures.customerAccount({ linkedCustomer: consenting })
      );
      await Effect.runPromise(
        fixtures.customerAccount({ linkedCustomer: undecided })
      );
      linkedCustomerIds.push(consenting, undecided);
      const grants = new Set<CustomerAccountId>([consentingAccount]);
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [consenting, undecided].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });
      const chain = answeringEachEmail({
        failRequest: (request) => (request === 0 ? lostRequest() : undefined),
        answer: ({ recipient }) => acceptedBy("posthog", `${recipient}-email`),
      });
      const layer = consumerLayerFor("development", {
        email: chain.layer,
        analyticsConsent: analyticsConsentLedgerOf((accountId) =>
          grants.has(accountId) ? "grant" : "none"
        ),
      });
      const identities = (request: number) =>
        Object.fromEntries(
          (chain.requests[request]?.messages ?? []).map((message) => [
            String(message.metadata?.dotyposCustomerId),
            message.recipientIdentity,
          ])
        );

      expect(await consumeExit({ sendId, deliveryAttempt: 1 }, layer)).toBe(
        true
      );
      expect(identities(0)).toEqual({
        [consenting]: `workspace-account:${consentingAccount}`,
        [undecided]: undefined,
      });

      // Withdrawn before the replay: the replayed batch names no one, and
      // is still the batch that was persisted.
      grants.clear();
      expect(await consume({ sendId, deliveryAttempt: 1 }, layer)).toBe("sent");

      expect(identities(1)).toEqual({
        [consenting]: undefined,
        [undecided]: undefined,
      });
      const { recipients } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({
        [consenting]: "sent",
        [undecided]: "sent",
      });
    });

    test("delivers only the current attempt's recipients", async () => {
      const delivered = customerId("retry-delivered");
      const retried = customerId("retry-failed");
      profiles = [profile(delivered), profile(retried)];
      const { sendId } = await seedSend({
        purpose: "operational",
        deliveryAttempt: 2,
        recipients: [
          { dotyposCustomerId: delivered, status: "delivered" },
          { dotyposCustomerId: retried, deliveryAttempt: 2 },
        ],
      });

      expect(await consume({ sendId, deliveryAttempt: 2 })).toBe("sent");

      expect(batchSend.mock.calls).toHaveLength(1);
      const [payload, options] = batchSend.mock.calls[0]!;
      expect(payload.map(({ to }) => to)).toEqual([
        [testEmailAddress(retried)],
      ]);
      expect(options.idempotencyKey).toBe(
        `email-campaign:${sendId}:attempt-2:batch-0`
      );
    });

    test("ignores a message for an earlier attempt or a settled campaign", async () => {
      const id = customerId("stale");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        deliveryAttempt: 2,
        recipients: [{ dotyposCustomerId: id, deliveryAttempt: 2 }],
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("stale");
      expect(await consume({ sendId, deliveryAttempt: 2 })).toBe("sent");
      expect(await consume({ sendId, deliveryAttempt: 2 })).toBe("stale");
      expect(batchSend.mock.calls).toHaveLength(1);
    });

    /**
     * An automated campaign whose own draft is operational and whose
     * published version is marketing, with one send of that version.
     */
    const seedAutomated = async (input: {
      readonly recipient: DotyposCustomerId;
    }) => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "operational",
      });
      automatedCampaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
        text: "Verze jedna",
      });
      const sendId = await seedAutomatedSend(db, {
        campaignId,
        versionId,
        purpose: "marketing",
        text: "Verze jedna",
        recipients: [{ dotyposCustomerId: input.recipient }],
      });
      return { campaignId, versionId, sendId };
    };

    test("treats a queue message for an automated send as stale: only its deliver unit submits it", async () => {
      const id = customerId("automated-queued");
      profiles = [profile(id)];
      await grantConsent([id]);
      const { sendId } = await seedAutomated({ recipient: id });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("stale");

      expect(batchSend.mock.calls).toHaveLength(0);
      const { recipients, campaign, batches } = await stored(sendId);
      expect(recipients.map((row) => row.status)).toEqual(["pending"]);
      expect(batches).toEqual([]);
      expect(campaign.status).toBe("active");
      expect(campaign.completed_at).toBeNull();
    });

    test("settles a submitted automated send whatever its campaign's status and leaves the status as it is", async () => {
      batchSend = mock(async () => ({
        data: null,
        error: { message: "Invalid batch", statusCode: 422 },
      }));
      const id = customerId("automated-paused");
      profiles = [profile(id)];
      await grantConsent([id]);
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "operational",
        status: "paused",
      });
      automatedCampaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
        text: "Verze jedna",
      });

      const sendId = await deliverAutomated({
        campaignId,
        versionId,
        recipients: [id],
      });

      const { recipients, campaign, batches } = await stored(sendId);
      expect(recipients.map((row) => row.status)).toEqual(["failed"]);
      expect(batches.map((batch) => batch.status)).toEqual(["rejected"]);
      expect(campaign.status).toBe("paused");
      expect(campaign.completed_at).not.toBeNull();

      // A completed automated send has nothing left to submit or settle.
      expect(await resubmitAutomated(sendId)).toMatchObject({
        _tag: "AlreadyCompleted",
      });
      expect(batchSend.mock.calls).toHaveLength(1);
    });

    /**
     * Persists an automated send of the version to `recipients`, submits it
     * from the profiles read for it and settles it, as a deliver unit does
     * (§5.9). The unit also ends the send's runs; its own suite covers that.
     */
    const deliverAutomated = (input: {
      readonly campaignId: CampaignId;
      readonly versionId: Parameters<typeof seedAutomatedSend>[1]["versionId"];
      readonly recipients: readonly DotyposCustomerId[];
    }) => {
      const read = new Map(
        profiles.flatMap((customer) =>
          customer.id === undefined ? [] : [[customer.id, customer] as const]
        )
      );
      return Effect.runPromise(
        Effect.gen(function* () {
          const delivery = yield* CampaignDeliveryService;
          const { transaction } = yield* WorkspaceDatabase;
          const at = Temporal.Now.instant();
          const sendId = yield* transaction(
            delivery
              .createAutomatedSend({
                campaignId: input.campaignId,
                versionId: input.versionId,
                at,
              })
              .pipe(
                Effect.tap((created) =>
                  delivery.persistAutomatedBatch({
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
          const submission = yield* delivery.submitAutomatedSend({
            sendId,
            profiles: Option.some(read),
          });
          yield* transaction(
            AutomatedSendSubmission.$match(submission, {
              AlreadyCompleted: () => Effect.void,
              Submitted: ({ batches }) =>
                delivery.settleAutomatedSend({
                  sendId,
                  batches,
                  at: Temporal.Now.instant(),
                }),
            })
          );
          return sendId;
        }).pipe(Effect.provide(Layer.merge(consumerLayer, testDatabase.layer)))
      );
    };

    /** Submits an automated send again, as a reclaimed deliver unit does. */
    const resubmitAutomated = (sendId: CampaignSendId) =>
      Effect.runPromise(
        Effect.flatMap(CampaignDeliveryService, (delivery) =>
          delivery.submitAutomatedSend({ sendId, profiles: Option.none() })
        ).pipe(Effect.provide(consumerLayer))
      );

    test("automated batch reads consent written in its transaction", async () => {
      const id = customerId("unit-transaction-consent");
      consentCustomerIds.push(id);
      profiles = [profile(id)];
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "marketing",
      });
      automatedCampaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
      });
      const sendId = await Effect.runPromise(
        Effect.gen(function* () {
          const delivery = yield* CampaignDeliveryService;
          const { transaction, db } = yield* WorkspaceDatabase;
          const at = Temporal.Now.instant();
          return yield* transaction(
            Effect.gen(function* () {
              yield* db.insert(customerMarketingConsents).values({
                dotyposCustomerId: id,
                documentHash: "hash",
                locale: "cs-CZ",
                grantedAt: at,
              });
              const sendId = yield* delivery.createAutomatedSend({
                campaignId,
                versionId,
                at,
              });
              yield* delivery.persistAutomatedBatch({
                sendId,
                recipients: [{ dotyposCustomerId: id, locale: "cs-CZ" }],
                profiles: new Map([[id, profiles[0]!]]),
                at,
              });
              return sendId;
            })
          );
        }).pipe(Effect.provide(Layer.merge(consumerLayer, testDatabase.layer)))
      );
      const { recipients, batches } = await stored(sendId);
      expect(recipients[0]?.status).toBe("pending");
      expect(batches[0]?.dotypos_customer_ids).toEqual([id]);
    });

    test("a deliver unit's send mails its version's content, skips non-test recipients one by one and leaves the campaign's status", async () => {
      const inside = customerId("unit-inside");
      const outside = customerId("unit-outside");
      profiles = [
        profile(inside),
        profile(outside, { email: resendSimulatorAddress("delivered") }),
      ];
      await grantConsent([inside, outside]);
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "operational",
      });
      automatedCampaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
        text: "Verze jedna",
      });

      const sendId = await deliverAutomated({
        campaignId,
        versionId,
        recipients: [inside, outside],
      });

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
      ]);
      expect(requestPayloads()[0]).toContain("Verze jedna");
      expect(requestPayloads()[0]).not.toContain("Rozpracovan");
      // The version's marketing purpose, not the campaign's own.
      expect(
        batchSend.mock.calls[0]![0][0]!.headers?.["List-Unsubscribe"]
      ).toBeDefined();
      expect(mailed).toEqual([testEmailAddress(inside)]);
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

    test("skips a recipient outside the test domain before any provider request outside production", async () => {
      const inside = customerId("guard-inside");
      const outside = customerId("guard-outside");
      profiles = [
        profile(inside),
        profile(outside, { email: resendSimulatorAddress("delivered") }),
      ];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [inside, outside].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(mailed).toEqual([testEmailAddress(inside)]);
      const { recipients } = await stored(sendId);
      expect(
        Object.fromEntries(
          recipients.map((row) => [
            row.dotypos_customer_id,
            [row.status, row.skip_reason],
          ])
        )
      ).toEqual({
        [inside]: ["sent", null],
        [outside]: ["skipped", "outside-test-domain"],
      });
    });

    test("mails a recipient outside the test domain in production", async () => {
      const outside = customerId("guard-production");
      profiles = [
        profile(outside, { email: resendSimulatorAddress("delivered") }),
      ];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: outside }],
      });

      expect(
        await consume(
          { sendId, deliveryAttempt: 1 },
          consumerLayerFor("production")
        )
      ).toBe("sent");

      expect(mailed).toEqual([resendSimulatorAddress("delivered")]);
    });

    test("replays an accepted batch under its key when recording it failed", async () => {
      const ids = [customerId("db-fail-a"), customerId("db-fail-b")];
      profiles = ids.map((id) => profile(id));
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: ids.map((dotyposCustomerId) => ({ dotyposCustomerId })),
      });
      const trigger = `fail_batch_accept_${run}`;
      await testDatabase.pool.query(
        `create function ${trigger}() returns trigger language plpgsql as $$ begin raise exception 'simulated write failure'; end $$`
      );
      await testDatabase.pool.query(
        `create trigger ${trigger} before update on email_campaign_delivery_batches for each row when (new.status = 'accepted' and new.send_id = '${sendId}') execute function ${trigger}()`
      );
      try {
        await consumeFails({ sendId, deliveryAttempt: 1 });
      } finally {
        await testDatabase.pool.query(
          `drop trigger ${trigger} on email_campaign_delivery_batches`
        );
        await testDatabase.pool.query(`drop function ${trigger}()`);
      }
      const interrupted = await stored(sendId);
      expect(interrupted.batches.map((batch) => batch.status)).toEqual([
        "requested",
      ]);
      expect(Object.values(statusesOf(interrupted.recipients))).toEqual([
        "pending",
        "pending",
      ]);

      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-0`,
      ]);
      expect(new Set(requestPayloads()).size).toBe(1);
      expect(mailed.sort()).toEqual(ids.map((id) => testEmailAddress(id)));
      const { recipients, campaign } = await stored(sendId);
      expect(Object.values(statusesOf(recipients))).toEqual(["sent", "sent"]);
      expect(campaign.status).toBe("sent");
    });

    test("replays the persisted batch unchanged after a webhook moved a recipient first", async () => {
      const early = customerId("early-webhook-a");
      const later = customerId("early-webhook-b");
      profiles = [profile(early), profile(later)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [early, later].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });
      // The provider accepts, its webhook lands, then the consumer is cut
      // off before it records the answer.
      batchSend = mock(async (payload, options) => {
        const response = await acceptBatch(payload, options);
        if (response.data) {
          await recordWebhook({
            type: "email.delivered",
            providerMessageId: response.data.data[0]!.id,
            sendId,
            dotyposCustomerId: early,
          });
        }
        return hang();
      });

      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);
      expect(statusesOf((await stored(sendId)).recipients)).toEqual({
        [early]: "delivered",
        [later]: "pending",
      });

      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-0`,
      ]);
      expect(new Set(requestPayloads()).size).toBe(1);
      expect(mailed.sort()).toEqual(
        [early, later].map((id) => testEmailAddress(id))
      );
      const { recipients, campaign } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({
        [early]: "delivered",
        [later]: "sent",
      });
      expect(
        new Set(recipients.map((row) => row.provider_message_id)).size
      ).toBe(2);
      expect(campaign.status).toBe("sent");
    });

    test("resumes a run cut off mid-request with the same batch and key", async () => {
      const ids = Array.from({ length: 101 }, (_, index) =>
        customerId(`cut-off-${String(index).padStart(3, "0")}`)
      );
      profiles = ids.map((id) => profile(id));
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: ids.map((dotyposCustomerId) => ({ dotyposCustomerId })),
      });
      batchSend = mock(hang);

      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);
      expect(mailed).toEqual([]);

      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-1`,
      ]);
      expect(requestPayloads()[0]).toBe(requestPayloads()[1]!);
      expect(mailed).toHaveLength(101);
      expect(new Set(mailed).size).toBe(101);
      const { batches, campaign } = await stored(sendId);
      expect(
        batches.map((batch) => [
          batch.dotypos_customer_ids.length,
          batch.status,
        ])
      ).toEqual([
        [100, "accepted"],
        [1, "accepted"],
      ]);
      expect(campaign.status).toBe("sent");
    });

    test("never resends a batch whose payload changed; its recipients become unconfirmed", async () => {
      const changed = customerId("changed-email");
      const unchanged = customerId("unchanged-email");
      profiles = [profile(changed), profile(unchanged)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [changed, unchanged].map((dotyposCustomerId) => ({
          dotyposCustomerId,
        })),
      });
      batchSend = mock(hang);
      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);

      profiles = [
        profile(changed, { email: testEmailAddress(`${changed}-new`) }),
        profile(unchanged),
      ];
      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("failed");

      expect(batchSend.mock.calls).toHaveLength(1);
      const { recipients, batches, campaign } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({
        [changed]: "unconfirmed",
        [unchanged]: "unconfirmed",
      });
      expect(batches.map((batch) => batch.status)).toEqual(["unconfirmed"]);
      expect(campaign.status).toBe("failed");
    });

    test("gives up on a batch with an unknown outcome once its key's replay window passed", async () => {
      const id = customerId("expired-key");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });
      batchSend = mock(hang);
      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);
      await testDatabase.pool.query(
        "update email_campaign_delivery_batches set requested_at = now() - interval '23 hours 1 minute' where send_id = $1",
        [sendId]
      );

      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("failed");

      expect(batchSend.mock.calls).toHaveLength(1);
      const { recipients, batches } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({ [id]: "unconfirmed" });
      expect(batches.map((batch) => batch.status)).toEqual(["unconfirmed"]);
    });

    test("treats a refused replay as unconfirmed, since the first request may have been delivered", async () => {
      const id = customerId("refused-replay");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });
      batchSend = mock(hang);
      expect(await consumeCutOff({ sendId, deliveryAttempt: 1 })).toBe(false);

      batchSend.mockImplementation(async () => ({
        data: null,
        error: { message: "Invalid batch", statusCode: 422 },
      }));
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("failed");

      const { recipients, batches } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({ [id]: "unconfirmed" });
      expect(batches.map((batch) => batch.status)).toEqual(["unconfirmed"]);
    });

    test("replays a batch whose response was lost instead of retrying it within the run", async () => {
      const id = customerId("lost-response");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });
      // Resend accepts the batch but its response is lost; a second request
      // in the same run would be rate limited, which says nothing about the
      // first.
      batchSend = mock(async (payload, options) => {
        if (batchSend.mock.calls.length > 1) return rateLimited;
        await acceptBatch(payload, options);
        return {
          data: null,
          error: { message: "Internal server error", statusCode: 500 },
        };
      });

      await consumeFails({ sendId, deliveryAttempt: 1 });

      expect(batchSend.mock.calls).toHaveLength(1);
      const interrupted = await stored(sendId);
      expect(interrupted.batches.map((batch) => batch.status)).toEqual([
        "requested",
      ]);
      expect(statusesOf(interrupted.recipients)).toEqual({ [id]: "pending" });

      batchSend.mockImplementation(acceptBatch);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-0`,
      ]);
      expect(mailed).toEqual([testEmailAddress(id)]);
      const { recipients, campaign } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({ [id]: "sent" });
      expect(campaign.status).toBe("sent");
    });

    test("a run whose preparation fails after another run delivered its recipients records nothing", async () => {
      const ids = [customerId("overlap-a"), customerId("overlap-b")];
      profiles = ids.map((id) => profile(id));
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: ids.map((dotyposCustomerId) => ({ dotyposCustomerId })),
      });
      const stalled = pause();
      let reads = 0;
      readCustomers = (requested) =>
        ++reads === 1
          ? Effect.promise(() => {
              stalled.reach();
              return stalled.released;
            }).pipe(
              Effect.andThen(
                Effect.fail(
                  new DotyposUnavailable({
                    operation: "getCustomersByIds",
                    reason: "transport",
                  })
                )
              )
            )
          : readProfiles(requested);

      const first = consumeConcurrently({ sendId, deliveryAttempt: 1 });
      await stalled.reached;

      // While the first run owns the send, a duplicate message waits.
      await consumeFails({ sendId, deliveryAttempt: 1 });
      expect(batchSend.mock.calls).toHaveLength(0);

      await expireLease(sendId);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      // The first run's Dotypos read fails only now; it lost the send.
      stalled.release();
      expect((await first)._tag).toBe("Failure");

      expect(mailed.sort()).toEqual(ids.map((id) => testEmailAddress(id)));
      const { recipients, batches, campaign } = await stored(sendId);
      expect(Object.values(statusesOf(recipients))).toEqual(["sent", "sent"]);
      expect(batches.map((batch) => batch.status)).toEqual(["accepted"]);
      expect(campaign.status).toBe("sent");
    });

    test("a run whose lease expired mid-request can't overwrite the run that settled its batch", async () => {
      const id = customerId("lease-expired-mid-request");
      profiles = [profile(id)];
      const { sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });
      const stalled = pause();
      // The first request is accepted but answers only after its run lost
      // the send, and then with a refusal that would fail the recipient.
      batchSend = mock(async (payload, options) => {
        const response = await acceptBatch(payload, options);
        if (batchSend.mock.calls.length > 1) return response;
        stalled.reach();
        await stalled.released;
        return rateLimited;
      });

      const first = consumeConcurrently({ sendId, deliveryAttempt: 1 });
      await stalled.reached;
      await expireLease(sendId);
      expect(await consume({ sendId, deliveryAttempt: 1 })).toBe("sent");

      stalled.release();
      expect((await first)._tag).toBe("Failure");

      expect(requestKeys()).toEqual([
        `email-campaign:${sendId}:attempt-1:batch-0`,
        `email-campaign:${sendId}:attempt-1:batch-0`,
      ]);
      expect(mailed).toEqual([testEmailAddress(id)]);
      const { recipients, batches, campaign } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({ [id]: "sent" });
      expect(batches.map((batch) => batch.status)).toEqual(["accepted"]);
      expect(campaign.status).toBe("sent");
      const {
        rows: [lease],
      } = await testDatabase.pool.query(
        "select delivery_lease_id from email_campaign_sends where id = $1",
        [sendId]
      );
      expect(lease.delivery_lease_id).toBeNull();
    });

    test("a retry queued on a failing campaign and the run still holding its send never deadlock", async () => {
      const id = customerId("retry-beside-run");
      profiles = [profile(id)];
      const { campaignId, sendId } = await seedSend({
        purpose: "operational",
        recipients: [{ dotyposCustomerId: id }],
      });
      // The run takes the send's lease, then stops reading its recipients'
      // profiles until the test lets it go, before it persists any batch.
      const stalled = pause();
      readCustomers = (ids) =>
        Effect.promise(async () => {
          stalled.reach();
          await stalled.released;
        }).pipe(Effect.andThen(readProfiles(ids)));

      const delivery = consumeConcurrently({ sendId, deliveryAttempt: 1 });
      await stalled.reached;
      // Another transaction is failing the campaign and holds its row.
      const failing = await holdPostgresTransaction(
        testDatabase.pool,
        "update email_campaigns set status = 'failed' where id = $1",
        [campaignId]
      );
      const retry = Effect.runPromiseExit(
        Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
          transaction(
            OnceCampaignLifecycle.retry({
              campaignId,
              includeUnconfirmed: false,
              now: Temporal.Now.instant(),
            })
          )
        ).pipe(Effect.provide(testDatabase.layer))
      );
      await waitForPostgresLockWaiter(testDatabase.pool, {
        condition: "$1 = any(pg_blocking_pids(pid))",
        values: [failing.pid],
        description: "the retry to queue on the campaign row",
      });
      stalled.release();
      await waitForPostgresLockWaiter(testDatabase.pool, {
        condition: "not (pg_blocking_pids(pid) <@ array[$1]::int[])",
        values: [failing.pid],
        description: "the run to wait on a lock the retry holds or queues for",
      });
      await failing.commit();

      const retried = await retry;
      if (Exit.isFailure(retried)) throw Cause.squash(retried.cause);
      expect(retried.value).toMatchObject({ deliveryAttempt: 2 });
      const delivered = await delivery;
      expect(
        Exit.isFailure(delivered) ? Cause.squash(delivered.cause) : undefined
      ).toMatchObject({ _tag: "CampaignDeliveryIncomplete" });
      expect(mailed).toEqual([]);

      readCustomers = readProfiles;
      expect(await consume({ sendId, deliveryAttempt: 2 })).toBe("sent");
      expect(mailed).toEqual([testEmailAddress(id)]);
      const { recipients, campaign } = await stored(sendId);
      expect(statusesOf(recipients)).toEqual({ [id]: "sent" });
      expect(campaign.status).toBe("sent");
    });
  }
);
