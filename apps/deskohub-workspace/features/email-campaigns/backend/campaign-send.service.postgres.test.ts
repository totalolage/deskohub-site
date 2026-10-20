import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailSendResult,
  EmailServiceTag,
} from "@deskohub/email";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { NodeCrypto } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceFilter } from "../audience-filter";
import type { CampaignLocalizedContent } from "../body/campaign-content";
import type { CampaignId } from "../campaign-identifiers";
import type { CampaignRecipientStatus } from "../campaign-states";
import { CampaignFallbackContentMissing } from "../errors";
import { CampaignService } from "./campaign.service";
import { CampaignAudienceService } from "./campaign-audience.service";
import { CampaignConfirmationCodeService } from "./campaign-confirmation-code.service";
import { CampaignEmailConfig } from "./campaign-email.config";
import { CampaignRecipientService } from "./campaign-recipient.service";
import { CampaignSendService } from "./campaign-send.service";
import {
  type CampaignDeliveryAttempt,
  CampaignSendQueueError,
  CampaignSendQueueService,
} from "./campaign-send-queue.service";
import { CampaignSendStatusService } from "./campaign-send-status.service";
import {
  campaignContentFixture,
  deleteAutomatedCampaigns,
  everyoneFilter,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
  seedCampaignSend,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`send-${run}-${name}`);
const adminInbox = testEmailAddress("campaign-admin");

const englishContent: CampaignLocalizedContent["en-US"] = {
  subject: "News",
  preheader: "What's new",
  body: {
    formatVersion: 1,
    doc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    },
  },
};

const englishOnlyContent: CampaignLocalizedContent = {
  "en-US": englishContent,
};

const englishOnlyFilter: AudienceFilter = {
  attribute: "locale",
  _tag: "Condition",
  operator: "anyOf",
  value: ["en-US"],
};

const bilingualContent: CampaignLocalizedContent = {
  ...campaignContentFixture(),
  "en-US": englishContent,
};

describe.skipIf(!testDatabase)(
  "CampaignSendService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const campaignIds: CampaignId[] = [];
    const automatedCampaignIds: CampaignId[] = [];
    const audienceIds: string[] = [];

    afterAll(async () => {
      await deleteAutomatedCampaigns(testDatabase.db, automatedCampaignIds);
      await testDatabase.pool.query(
        "delete from email_campaign_sends where campaign_id = any($1)",
        [campaignIds]
      );
      await testDatabase.pool.query(
        "delete from email_campaigns where id = any($1)",
        [campaignIds]
      );
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where id = any($1)",
        [audienceIds]
      );
    });

    let sentEmails: EmailMessage[] = [];
    let enqueued: CampaignDeliveryAttempt[] = [];
    let queueAvailable = true;
    let resolvedEmails: readonly string[] = [];

    beforeEach(() => {
      sentEmails = [];
      enqueued = [];
      queueAvailable = true;
      resolvedEmails = [testEmailAddress("ada"), testEmailAddress("bob")];
    });

    const services = Layer.mergeAll(
      CampaignService.Default,
      CampaignAudienceService.Default,
      CampaignSendStatusService.Default.pipe(
        Layer.provide(CampaignService.Default)
      ),
      CampaignSendService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            CampaignService.Default,
            CampaignAudienceService.Default,
            CampaignConfirmationCodeService.Default.pipe(
              Layer.provide(NodeCrypto.layer)
            ),
            Layer.mock(CampaignRecipientService, {
              resolve: () =>
                Effect.sync(() => ({
                  recipients: resolvedEmails.map((email, index) => ({
                    dotyposCustomerId: customerId(`recipient-${index}`),
                    locale:
                      index === 0 ? ("cs-CZ" as const) : ("en-US" as const),
                    email,
                  })),
                  exclusions: [],
                  duplicates: [],
                })),
            }),
            Layer.succeed(CampaignEmailConfig, {
              deploymentEnvironment: "preview",
              from: { email: testEmailAddress("campaigns") },
              replyTo: { email: testEmailAddress("hello") },
              adminInbox,
            }),
            Layer.mock(EmailServiceTag, {
              send: (message) =>
                Effect.sync((): EmailSendResult => {
                  sentEmails.push(message);
                  return {
                    id: EmailDeliveryIdSchema.make(`test-${sentEmails.length}`),
                    status: "sent",
                    provider: "test",
                    timestamp: new Date(),
                  };
                }),
            }),
            Layer.succeed(CampaignSendQueueService, {
              enqueue: (attempt) =>
                queueAvailable
                  ? Effect.sync(() => {
                      enqueued.push(attempt);
                    })
                  : Effect.fail(
                      new CampaignSendQueueError({ message: "Queue is down." })
                    ),
            })
          )
        )
      )
    ).pipe(Layer.provide(testDatabase.layer));

    const runExit = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | CampaignSendService
        | CampaignSendStatusService
        | CampaignService
        | CampaignAudienceService
      >
    ) => Effect.runPromiseExit(effect.pipe(Effect.provide(services)));

    const runOk = async <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | CampaignSendService
        | CampaignSendStatusService
        | CampaignService
        | CampaignAudienceService
      >
    ) => {
      const exit = await runExit(effect);
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      return exit.value;
    };

    const failure = (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

    const createDraft = async (
      input: {
        readonly content?: CampaignLocalizedContent;
        readonly withAudience?: boolean;
        readonly audienceFilter?: AudienceFilter;
      } = {}
    ) => {
      const audience = await runOk(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.create({
              title: "Everyone",
              filter: input.audienceFilter ?? everyoneFilter,
            })
          )
        )
      );
      audienceIds.push(audience.id);
      const campaign = await runOk(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Autumn news",
              purpose: "marketing",
              templateKey: "workspace",
              content: input.content ?? bilingualContent,
              audienceId: input.withAudience === false ? null : audience.id,
            })
          )
        )
      );
      campaignIds.push(campaign.id);
      return campaign;
    };

    const testSend = (campaignId: CampaignId, extraRecipients: string[] = []) =>
      runExit(
        CampaignSendService.pipe(
          Effect.flatMap((sends) =>
            sends.testSend({ campaignId, extraRecipients })
          )
        )
      );

    const send = (campaignId: CampaignId, confirmationCode: string) =>
      runExit(
        CampaignSendService.pipe(
          Effect.flatMap((sends) =>
            sends.send({ campaignId, confirmationCode })
          )
        )
      );

    const retry = (campaignId: CampaignId, includeUnconfirmed?: boolean) =>
      runExit(
        CampaignSendService.pipe(
          Effect.flatMap((sends) =>
            sends.retryUndelivered({ campaignId, includeUnconfirmed })
          )
        )
      );

    const sendStatus = (campaignId: CampaignId) =>
      runOk(
        CampaignSendStatusService.pipe(
          Effect.flatMap((sendStatus) => sendStatus.get({ campaignId }))
        )
      );

    /** The confirmation code the latest test email carries in its text. */
    const mailedCode = () => {
      const code = sentEmails.at(-1)?.text?.match(/: ([A-Z2-9]{8})\b/)?.[1];
      if (!code)
        throw new Error("The test email carried no confirmation code.");
      return code;
    };

    const storedStatus = async (campaignId: CampaignId) =>
      (
        await testDatabase.pool.query(
          "select status from email_campaigns where id = $1",
          [campaignId]
        )
      ).rows[0]?.status;

    const sendCount = async (campaignId: CampaignId) =>
      (
        await testDatabase.pool.query(
          "select count(*)::int as count from email_campaign_sends where campaign_id = $1",
          [campaignId]
        )
      ).rows[0]?.count;

    test("mails each test recipient one [TEST] email per locale with the code", async () => {
      const campaign = await createDraft();

      const exit = await testSend(campaign.id, [
        ` ${testEmailAddress("ops")} `,
        adminInbox.toUpperCase(),
      ]);

      expect(Exit.isSuccess(exit) && exit.value).toMatchObject({
        recipients: [adminInbox, testEmailAddress("ops")],
        locales: ["en-US", "cs-CZ"],
      });
      expect(
        sentEmails.map(({ to, subject }) => [
          Array.isArray(to) ? to[0]?.email : to.email,
          subject,
        ])
      ).toEqual([
        [adminInbox, "[TEST] News"],
        [adminInbox, "[TEST] Novinky"],
        [testEmailAddress("ops"), "[TEST] News"],
        [testEmailAddress("ops"), "[TEST] Novinky"],
      ]);
      const code = mailedCode();
      expect(sentEmails.every(({ text }) => text?.includes(code))).toBe(true);
      expect(sentEmails.every(({ html }) => html?.includes(code))).toBe(true);
      expect(sentEmails.every(({ headers }) => headers === undefined)).toBe(
        true
      );
      expect(await sendCount(campaign.id)).toBe(0);
      expect(await sendStatus(campaign.id)).toEqual(Option.none());
    });

    test("refuses a test send to an address outside the test domain", async () => {
      const campaign = await createDraft();

      const exit = await testSend(campaign.id, [
        resendSimulatorAddress("delivered"),
      ]);

      expect(failure(exit)).toMatchObject({
        _tag: "CampaignRecipientsOutsideTestDomain",
        recipientCount: 1,
      });
      expect(sentEmails).toEqual([]);
      const { rows } = await testDatabase.pool.query(
        "select 1 from email_campaign_confirmation_codes where campaign_id = $1",
        [campaign.id]
      );
      expect(rows).toEqual([]);
    });

    test("rejects a typed test address that isn't an email", async () => {
      const campaign = await createDraft();

      expect(failure(await testSend(campaign.id, ["ops"]))).toMatchObject({
        _tag: "CampaignTestRecipientInvalid",
        email: "ops",
      });
    });

    test("refuses a test send of a campaign without content", async () => {
      const campaign = await createDraft({ content: {} });

      expect(failure(await testSend(campaign.id))).toMatchObject({
        _tag: "CampaignContentMissing",
      });
    });

    test("freezes the recipients with the audience snapshot and queues the delivery", async () => {
      const campaign = await createDraft();
      await testSend(campaign.id);

      const exit = await send(campaign.id, mailedCode());

      expect(Exit.isSuccess(exit) && exit.value.recipientCount).toBe(2);
      const sendId = Exit.isSuccess(exit) ? exit.value.sendId : undefined;
      expect(enqueued).toEqual([{ sendId: sendId!, deliveryAttempt: 1 }]);
      expect(await storedStatus(campaign.id)).toBe("sending");
      const status = await sendStatus(campaign.id);
      expect(status.pipe(Option.getOrThrow)).toMatchObject({
        sendId,
        audienceId: campaign.audienceId,
        audienceFilter: everyoneFilter,
        completedAt: null,
        counts: { pending: 2, sent: 0, delivered: 0 },
        recipients: [
          { dotyposCustomerId: customerId("recipient-0"), locale: "cs-CZ" },
          { dotyposCustomerId: customerId("recipient-1"), locale: "en-US" },
        ],
      });
    });

    test("keeps the Draft and its code when a recipient is outside the test domain", async () => {
      const campaign = await createDraft();
      await testSend(campaign.id);
      const code = mailedCode();
      resolvedEmails = [
        testEmailAddress("ada"),
        resendSimulatorAddress("bounced"),
      ];

      expect(failure(await send(campaign.id, code))).toMatchObject({
        _tag: "CampaignRecipientsOutsideTestDomain",
      });
      expect(await storedStatus(campaign.id)).toBe("draft");
      expect(await sendCount(campaign.id)).toBe(0);
      expect(enqueued).toEqual([]);

      resolvedEmails = [testEmailAddress("ada")];
      expect(Exit.isSuccess(await send(campaign.id, code))).toBe(true);
    });

    test("needs an audience and a recipient to send", async () => {
      const withoutAudience = await createDraft({ withAudience: false });
      expect(failure(await send(withoutAudience.id, "AAAAAAAA"))).toMatchObject(
        {
          _tag: "CampaignAudienceMissing",
        }
      );

      const nobody = await createDraft();
      resolvedEmails = [];
      expect(failure(await send(nobody.id, "AAAAAAAA"))).toMatchObject({
        _tag: "CampaignNoRecipients",
      });
    });

    test("marks the campaign Failed when the delivery can't be queued", async () => {
      const campaign = await createDraft();
      await testSend(campaign.id);
      queueAvailable = false;

      expect(failure(await send(campaign.id, mailedCode()))).toMatchObject({
        _tag: "CampaignDeliveryQueueFailed",
      });
      expect(await storedStatus(campaign.id)).toBe("failed");

      queueAvailable = true;
      const retried = await retry(campaign.id);
      expect(Exit.isSuccess(retried) && retried.value.retriedCount).toBe(2);
      expect(await storedStatus(campaign.id)).toBe("sending");
    });

    test("retries only the undelivered recipients of a Failed campaign", async () => {
      const statuses: CampaignRecipientStatus[] = [
        "pending",
        "failed",
        "sent",
        "delivered",
        "bounced",
        "complained",
        "skipped",
        "unconfirmed",
      ];
      resolvedEmails = statuses.map((status) => testEmailAddress(status));
      const campaign = await createDraft();
      await testSend(campaign.id);
      const started = await send(campaign.id, mailedCode());
      const sendId = Exit.isSuccess(started) ? started.value.sendId : undefined;
      for (const [index, status] of statuses.entries()) {
        await testDatabase.pool.query(
          "update email_campaign_recipients set status = $1, skip_reason = case when $1 = 'skipped' then 'missing-email' end where send_id = $2 and dotypos_customer_id = $3",
          [status, sendId, customerId(`recipient-${index}`)]
        );
      }
      expect(failure(await retry(campaign.id))).toMatchObject({
        _tag: "CampaignNotRetryable",
        status: "sending",
      });
      await testDatabase.pool.query(
        "update email_campaigns set status = 'failed' where id = $1",
        [campaign.id]
      );

      const retried = await retry(campaign.id);

      expect(Exit.isSuccess(retried) && retried.value).toEqual({
        sendId: sendId!,
        retriedCount: 2,
      });
      expect(enqueued.at(-1)).toEqual({ sendId: sendId!, deliveryAttempt: 2 });
      const { rows } = await testDatabase.pool.query(
        "select dotypos_customer_id, status, delivery_attempt from email_campaign_recipients where send_id = $1 order by dotypos_customer_id",
        [sendId]
      );
      expect(rows.map((row) => [row.status, row.delivery_attempt])).toEqual([
        ["pending", 2],
        ["pending", 2],
        ["sent", 1],
        ["delivered", 1],
        ["bounced", 1],
        ["complained", 1],
        ["skipped", 1],
        ["unconfirmed", 1],
      ]);
      expect(await storedStatus(campaign.id)).toBe("sending");

      // Unconfirmed recipients may have the email; only an explicit retry
      // mails them again.
      await testDatabase.pool.query(
        "update email_campaigns set status = 'failed' where id = $1",
        [campaign.id]
      );
      const retriedUnconfirmed = await retry(campaign.id, true);

      expect(
        Exit.isSuccess(retriedUnconfirmed) && retriedUnconfirmed.value
      ).toEqual({ sendId: sendId!, retriedCount: 3 });
      const { rows: afterExplicitRetry } = await testDatabase.pool.query(
        "select status, delivery_attempt from email_campaign_recipients where send_id = $1 and status in ('pending', 'unconfirmed') order by dotypos_customer_id",
        [sendId]
      );
      expect(
        afterExplicitRetry.map((row) => [row.status, row.delivery_attempt])
      ).toEqual([
        ["pending", 3],
        ["pending", 3],
        ["pending", 3],
      ]);
    });

    const sendAttempts = async (campaignId: CampaignId) =>
      (
        await testDatabase.pool.query(
          "select s.automation_version_id is null as once, s.delivery_attempt, r.status from email_campaign_sends s join email_campaign_recipients r on r.send_id = s.id where s.campaign_id = $1 order by once desc",
          [campaignId]
        )
      ).rows;

    test("retries only a one-off campaign's own send, never an automated send beside it", async () => {
      const { campaignId, sendId } = await seedCampaignSend(testDatabase.db, {
        purpose: "marketing",
        status: "failed",
        recipients: [
          { dotyposCustomerId: customerId("retry-once"), status: "failed" },
        ],
      });
      automatedCampaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(testDatabase.db, {
        campaignId,
        purpose: "marketing",
      });
      await seedAutomatedSend(testDatabase.db, {
        campaignId,
        versionId,
        purpose: "marketing",
        recipients: [
          {
            dotyposCustomerId: customerId("retry-automated"),
            status: "failed",
          },
        ],
      });

      const retried = await retry(campaignId);

      expect(Exit.isSuccess(retried) && retried.value).toEqual({
        sendId,
        retriedCount: 1,
      });
      expect(enqueued).toEqual([{ sendId, deliveryAttempt: 2 }]);
      expect(await sendAttempts(campaignId)).toEqual([
        { once: true, delivery_attempt: 2, status: "pending" },
        { once: false, delivery_attempt: 1, status: "failed" },
      ]);
    });

    test("refuses to retry an automated campaign's sends", async () => {
      const campaignId = await seedAutomatedCampaign(testDatabase.db, {
        purpose: "marketing",
      });
      automatedCampaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(testDatabase.db, {
        campaignId,
        purpose: "marketing",
      });
      await seedAutomatedSend(testDatabase.db, {
        campaignId,
        versionId,
        purpose: "marketing",
        recipients: [
          { dotyposCustomerId: customerId("refused-retry"), status: "failed" },
        ],
      });

      expect(failure(await retry(campaignId))).toMatchObject({
        _tag: "CampaignDeliveryMismatch",
        campaignId,
        delivery: "automated",
      });
      expect(enqueued).toEqual([]);
      expect(await sendAttempts(campaignId)).toEqual([
        { once: false, delivery_attempt: 1, status: "failed" },
      ]);
    });

    test("refuses English-only content when the audience can reach Czech fallback recipients", async () => {
      const unrestricted = await createDraft({ content: englishOnlyContent });
      const withoutAudience = await createDraft({
        content: englishOnlyContent,
        withAudience: false,
      });

      for (const campaign of [unrestricted, withoutAudience]) {
        expect(failure(await testSend(campaign.id))).toBeInstanceOf(
          CampaignFallbackContentMissing
        );
      }
      expect(sentEmails).toEqual([]);
    });

    test("sends English-only content to a nested English-only audience", async () => {
      const campaign = await createDraft({
        content: englishOnlyContent,
        audienceFilter: {
          _tag: "Group",
          operator: "and",
          filters: [
            { _tag: "Group", operator: "and", filters: [englishOnlyFilter] },
          ],
        },
      });

      expect(Exit.isSuccess(await testSend(campaign.id))).toBe(true);
      const sent = await send(campaign.id, mailedCode());

      expect(Exit.isSuccess(sent) && sent.value.recipientCount).toBe(2);
      expect(await storedStatus(campaign.id)).toBe("sending");
    });

    test("checks the current audience before the send consumes the code", async () => {
      const campaign = await createDraft({
        content: englishOnlyContent,
        audienceFilter: englishOnlyFilter,
      });
      const updateAudienceFilter = (filter: AudienceFilter) =>
        runOk(
          CampaignAudienceService.pipe(
            Effect.flatMap((audiences) =>
              audiences.update({ audienceId: campaign.audienceId!, filter })
            )
          )
        );

      expect(Exit.isSuccess(await testSend(campaign.id))).toBe(true);
      const code = mailedCode();
      // Audience changes keep the code; the send checks the audience as it
      // is now.
      await updateAudienceFilter(everyoneFilter);
      const refused = await send(campaign.id, code);

      expect(failure(refused)).toBeInstanceOf(CampaignFallbackContentMissing);
      expect(await storedStatus(campaign.id)).toBe("draft");
      expect(await sendCount(campaign.id)).toBe(0);
      expect(enqueued).toEqual([]);

      await updateAudienceFilter(englishOnlyFilter);
      const sent = await send(campaign.id, code);

      expect(Exit.isSuccess(sent) && sent.value.recipientCount).toBe(2);
      expect(await storedStatus(campaign.id)).toBe("sending");
    });
  }
);
