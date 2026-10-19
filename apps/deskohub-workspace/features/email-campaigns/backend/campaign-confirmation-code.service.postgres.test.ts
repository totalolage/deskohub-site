import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { NodeCrypto } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { hashCampaignContent } from "../body/campaign-content-hash";
import type { CampaignId } from "../campaign-identifiers";
import { CampaignService } from "./campaign.service";
import type { CampaignSendFreeze } from "./campaign-confirmation-code.service";
import { CampaignConfirmationCodeService } from "./campaign-confirmation-code.service";
import {
  campaignContentFixture,
  everyoneFilter,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const issuedAt = Temporal.Instant.from("2026-10-14T10:00:00Z");

const frozenSend: CampaignSendFreeze = {
  audienceId: null,
  audienceFilter: everyoneFilter,
  recipients: [
    {
      dotyposCustomerId: DotyposCustomerIdSchema.make(
        "campaign-confirm-recipient"
      ),
      locale: "cs-CZ",
    },
  ],
};

describe.skipIf(!testDatabase)(
  "CampaignConfirmationCodeService on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const campaignIds: CampaignId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from email_campaign_sends where campaign_id = any($1)",
        [campaignIds]
      );
      await testDatabase.pool.query(
        "delete from email_campaigns where id = any($1)",
        [campaignIds]
      );
    });

    const services = Layer.mergeAll(
      CampaignService.Default,
      CampaignConfirmationCodeService.Default
    ).pipe(Layer.provide(Layer.mergeAll(testDatabase.layer, NodeCrypto.layer)));

    /** Runs at `issuedAt` plus `elapsed` on the test clock. */
    const runAt = <A, E>(
      elapsed: Temporal.DurationLike,
      effect: Effect.Effect<
        A,
        E,
        CampaignService | CampaignConfirmationCodeService
      >
    ) =>
      Effect.runPromiseExit(
        TestClock.setTime(issuedAt.add(elapsed).epochMilliseconds).pipe(
          Effect.andThen(effect),
          Effect.provide(Layer.merge(services, TestClock.layer()))
        )
      );

    const failure = (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

    const createDraft = async () => {
      const exit = await runAt(
        { seconds: 0 },
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Price update",
              purpose: "operational",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId: null,
            })
          )
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      campaignIds.push(exit.value.id);
      return exit.value;
    };

    const issueFor = async (
      campaign: Awaited<ReturnType<typeof createDraft>>
    ) => {
      const exit = await runAt(
        { seconds: 0 },
        CampaignConfirmationCodeService.pipe(
          Effect.flatMap((codes) =>
            codes.issue({
              campaignId: campaign.id,
              contentHash: hashCampaignContent({
                purpose: campaign.purpose,
                templateKey: campaign.templateKey,
                locales: campaign.content,
              }),
            })
          )
        )
      );
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      return exit.value;
    };

    const confirm = (
      campaignId: CampaignId,
      code: string,
      elapsed: Temporal.DurationLike = { minutes: 5 }
    ) =>
      runAt(
        elapsed,
        CampaignConfirmationCodeService.pipe(
          Effect.flatMap((codes) =>
            codes.confirm({ campaignId, code, send: frozenSend })
          )
        )
      );

    test("issues a code that expires after 24 hours", async () => {
      const campaign = await createDraft();
      const issued = await issueFor(campaign);
      expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(issued.expiresAt).toEqual(issuedAt.add({ hours: 24 }));
    });

    const updateContent = (campaignId: CampaignId, text: string) =>
      runAt(
        { minutes: 1 },
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.update({
              campaignId,
              content: campaignContentFixture(text),
            })
          )
        )
      );

    const storedCampaign = async (campaignId: CampaignId) => {
      const { rows } = await testDatabase.pool.query(
        "select status, content from email_campaigns where id = $1",
        [campaignId]
      );
      return rows[0];
    };

    const storedCodes = async (campaignId: CampaignId) => {
      const { rows } = await testDatabase.pool.query(
        "select * from email_campaign_confirmation_codes where campaign_id = $1 order by issued_at",
        [campaignId]
      );
      return rows;
    };

    test("confirms the code as typed and moves the campaign to Sending", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      const typed = ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;

      const confirmed = await confirm(campaign.id, typed);
      expect(Exit.isSuccess(confirmed) && confirmed.value.campaign.status).toBe(
        "sending"
      );
      expect((await storedCampaign(campaign.id)).status).toBe("sending");
      const { rows: sends } = await testDatabase.pool.query(
        "select id, audience_filter, content_hash from email_campaign_sends where campaign_id = $1",
        [campaign.id]
      );
      expect(sends).toEqual([
        {
          id: Exit.isSuccess(confirmed) ? confirmed.value.sendId : undefined,
          audience_filter: everyoneFilter,
          content_hash: hashCampaignContent({
            purpose: campaign.purpose,
            templateKey: campaign.templateKey,
            locales: campaign.content,
          }),
        },
      ]);
      const { rows: recipients } = await testDatabase.pool.query(
        "select dotypos_customer_id, locale, status, delivery_attempt from email_campaign_recipients where send_id = $1",
        [sends[0].id]
      );
      expect(recipients).toEqual([
        {
          dotypos_customer_id: "campaign-confirm-recipient",
          locale: "cs-CZ",
          status: "pending",
          delivery_attempt: 1,
        },
      ]);
      expect(failure(await confirm(campaign.id, code))).toMatchObject({
        _tag: "CampaignReadOnly",
        status: "sending",
      });
    });

    test("stores only a keyed hash of the code", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      const [row] = await storedCodes(campaign.id);
      expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(code);
    });

    test("counts a wrong code as a failed attempt", async () => {
      const campaign = await createDraft();
      await issueFor(campaign);
      expect(failure(await confirm(campaign.id, "AAAAAAAA"))).toMatchObject({
        reason: "unknown-code",
      });
      const [row] = await storedCodes(campaign.id);
      expect(row.failed_attempts).toBe(1);
      expect(row.superseded_at).toBeNull();
    });

    test("supersedes the code on the fifth failed attempt", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      for (const _ of [1, 2, 3, 4]) {
        expect(failure(await confirm(campaign.id, "AAAAAAAA"))).toMatchObject({
          reason: "unknown-code",
        });
      }
      expect(failure(await confirm(campaign.id, "AAAAAAAA"))).toMatchObject({
        reason: "too-many-attempts",
      });
      const [row] = await storedCodes(campaign.id);
      expect(row.failed_attempts).toBe(5);
      expect(row.superseded_at).not.toBeNull();

      expect(failure(await confirm(campaign.id, code))).toMatchObject({
        reason: "too-many-attempts",
      });
      expect((await storedCampaign(campaign.id)).status).toBe("draft");
    });

    test("rejects a confirmation waiting on an uncommitted edit as stale", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      const edit = await holdPostgresTransaction(
        testDatabase.pool,
        "update email_campaigns set content = $2 where id = $1",
        [campaign.id, campaignContentFixture("Změněno")]
      );

      const confirmation = confirm(campaign.id, code);
      await waitForPostgresLockWaiter(testDatabase.pool, {
        condition: "$1 = any(pg_blocking_pids(pid))",
        values: [edit.pid],
        description: "the confirmation to wait on the edit",
      });
      await edit.commit();

      expect(failure(await confirmation)).toMatchObject({
        reason: "content-changed",
      });
      expect((await storedCampaign(campaign.id)).status).toBe("draft");
    });

    test("rejects an edit queued behind a confirmation as read-only", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      const blocker = await holdPostgresTransaction(
        testDatabase.pool,
        "select 1 from email_campaigns where id = $1 for update",
        [campaign.id]
      );

      const confirmation = confirm(campaign.id, code);
      await waitForPostgresLockWaiter(testDatabase.pool, {
        condition: "$1 = any(pg_blocking_pids(pid))",
        values: [blocker.pid],
        description: "the confirmation to wait on the campaign row",
      });
      const edit = updateContent(campaign.id, "Změněno");
      await waitForPostgresLockWaiter(testDatabase.pool, {
        condition:
          "locktype = 'tuple' and relation = 'email_campaigns'::regclass",
        description: "the edit to queue behind the confirmation",
      });
      await blocker.commit();

      expect(Exit.isSuccess(await confirmation)).toBe(true);
      expect(failure(await edit)).toMatchObject({
        _tag: "CampaignReadOnly",
        status: "sending",
      });
      expect((await storedCampaign(campaign.id)).content).toEqual(
        campaign.content
      );
    });

    test("rejects an unknown code", async () => {
      const campaign = await createDraft();
      await issueFor(campaign);
      expect(failure(await confirm(campaign.id, "AAAAAAAA"))).toMatchObject({
        reason: "unknown-code",
      });
    });

    test("rejects an expired code", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      expect(
        failure(await confirm(campaign.id, code, { hours: 24 }))
      ).toMatchObject({ reason: "expired" });
    });

    test("rejects a code a newer test send superseded", async () => {
      const campaign = await createDraft();
      const older = await issueFor(campaign);
      const newer = await issueFor(campaign);
      expect(failure(await confirm(campaign.id, older.code))).toMatchObject({
        reason: "superseded",
      });
      expect(Exit.isSuccess(await confirm(campaign.id, newer.code))).toBe(true);
    });

    test("rejects a code after the content changed", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      await updateContent(campaign.id, "Změněno");
      expect(failure(await confirm(campaign.id, code))).toMatchObject({
        reason: "content-changed",
      });
    });

    test("refuses codes for a campaign that left Draft", async () => {
      const campaign = await createDraft();
      const { code } = await issueFor(campaign);
      await testDatabase.pool.query(
        "update email_campaigns set status = 'sending' where id = $1",
        [campaign.id]
      );
      expect(failure(await confirm(campaign.id, code))).toMatchObject({
        _tag: "CampaignReadOnly",
        status: "sending",
      });
    });

    test("refuses codes for an automated campaign", async () => {
      // Nothing writes automated campaigns yet, so the test inserts them by SQL.
      const campaign = await createDraft();
      for (const status of ["draft", "active", "paused", "archived"] as const) {
        const { rows } = await testDatabase.pool.query<{ id: CampaignId }>(
          `insert into email_campaigns (title, purpose, template_key, delivery, status)
           values ('Weekly come-back', 'marketing', 'workspace', 'automated', $1)
           returning id`,
          [status]
        );
        const campaignId = rows[0]!.id;
        campaignIds.push(campaignId);
        const mismatch = {
          _tag: "CampaignDeliveryMismatch",
          campaignId,
          delivery: "automated",
        };

        const issued = await runAt(
          { seconds: 0 },
          CampaignConfirmationCodeService.pipe(
            Effect.flatMap((codes) =>
              codes.issue({
                campaignId,
                contentHash: hashCampaignContent({
                  purpose: campaign.purpose,
                  templateKey: campaign.templateKey,
                  locales: campaign.content,
                }),
              })
            )
          )
        );
        expect(failure(issued)).toMatchObject(mismatch);
        expect(failure(await confirm(campaignId, "AAAAAAAA"))).toMatchObject(
          mismatch
        );

        const { rows: state } = await testDatabase.pool.query(
          `select c.status,
             (select count(*)::int from email_campaign_confirmation_codes k
              where k.campaign_id = c.id) as codes,
             (select count(*)::int from email_campaign_sends s
              where s.campaign_id = c.id) as sends
           from email_campaigns c where c.id = $1`,
          [campaignId]
        );
        expect(state).toEqual([{ status, codes: 0, sends: 0 }]);
      }
    });
  }
);
