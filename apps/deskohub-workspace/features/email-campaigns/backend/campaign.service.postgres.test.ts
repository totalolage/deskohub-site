import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { EmailServiceTag } from "@deskohub/email";
import { Cause, Effect, Exit, Layer } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CampaignId } from "../campaign-identifiers";
import type { CampaignStatus } from "../campaign-states";
import { CampaignService } from "./campaign.service";
import { CampaignAudienceService } from "./campaign-audience.service";
import { CampaignConfirmationCodeService } from "./campaign-confirmation-code.service";
import { CampaignEmailConfig } from "./campaign-email.config";
import { CampaignRecipientService } from "./campaign-recipient.service";
import { CampaignSendService } from "./campaign-send.service";
import { CampaignSendQueueService } from "./campaign-send-queue.service";
import { campaignContentFixture } from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("CampaignService on disposable Postgres", () => {
  if (!testDatabase) return;
  const campaignIds: CampaignId[] = [];

  afterAll(async () => {
    await testDatabase.pool.query(
      "delete from email_campaigns where id = any($1)",
      [campaignIds]
    );
  });

  // The one-off guards refuse before sending touches anything else, so its
  // other capabilities are unimplemented mocks.
  const services = Layer.mergeAll(
    CampaignService.Default,
    CampaignSendService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          CampaignService.Default,
          Layer.mock(CampaignAudienceService, {}),
          Layer.mock(CampaignRecipientService, {}),
          Layer.mock(CampaignConfirmationCodeService, {}),
          Layer.mock(CampaignEmailConfig, {}),
          Layer.mock(EmailServiceTag, {}),
          Layer.mock(CampaignSendQueueService, {})
        )
      )
    )
  ).pipe(Layer.provide(testDatabase.layer));

  const run = <A, E>(
    effect: Effect.Effect<A, E, CampaignService | CampaignSendService>
  ) => Effect.runPromiseExit(effect.pipe(Effect.provide(services)));

  const failure = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

  const createDraft = async () => {
    const exit = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) =>
          campaigns.create({
            title: "Opening hours",
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

  test("edits a draft", async () => {
    const draft = await createDraft();
    const updated = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) =>
          campaigns.update({
            campaignId: draft.id,
            title: "New opening hours",
            content: campaignContentFixture("Nově otevřeno"),
          })
        )
      )
    );
    expect(Exit.isSuccess(updated) && updated.value).toMatchObject({
      title: "New opening hours",
      content: campaignContentFixture("Nově otevřeno"),
      status: "draft",
    });
  });

  test("persists and duplicates an operational reason override", async () => {
    const draft = await createDraft();
    const content = campaignContentFixture();
    const withReason = {
      "cs-CZ": {
        ...content["cs-CZ"]!,
        operationalReason: "Měníme provozní dobu.",
      },
    };
    const updated = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) =>
          campaigns.update({ campaignId: draft.id, content: withReason })
        )
      )
    );
    expect(Exit.isSuccess(updated)).toBe(true);

    const copy = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) => campaigns.duplicate(draft.id))
      )
    );
    if (Exit.isFailure(copy)) throw Cause.squash(copy.cause);
    campaignIds.push(copy.value.id);
    expect(copy.value.content).toEqual(withReason);

    const blank = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) =>
          campaigns.update({
            campaignId: draft.id,
            content: {
              "cs-CZ": { ...content["cs-CZ"]!, operationalReason: "  " },
            },
          })
        )
      )
    );
    expect(failure(blank)).toMatchObject({ _tag: "CampaignContentInvalid" });
  });

  test("rejects content that breaks the body rules", async () => {
    const draft = await createDraft();
    const content = campaignContentFixture();
    const update = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) =>
          campaigns.update({
            campaignId: draft.id,
            content: {
              "cs-CZ": {
                ...content["cs-CZ"]!,
                body: {
                  formatVersion: 1,
                  doc: { type: "doc", content: [{ type: "unknownNode" }] },
                },
              },
            },
          })
        )
      )
    );
    expect(failure(update)).toMatchObject({ _tag: "CampaignContentInvalid" });
  });

  test("makes a campaign read-only once it leaves Draft", async () => {
    const campaign = await createDraft();
    await testDatabase.pool.query(
      "update email_campaigns set status = 'sent' where id = $1",
      [campaign.id]
    );

    const update = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) =>
          campaigns.update({ campaignId: campaign.id, title: "Changed" })
        )
      )
    );
    expect(failure(update)).toMatchObject({
      _tag: "CampaignReadOnly",
      status: "sent",
    });
    const deletion = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) => campaigns.delete(campaign.id))
      )
    );
    expect(failure(deletion)).toMatchObject({ _tag: "CampaignReadOnly" });
    const stored = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) => campaigns.get(campaign.id))
      )
    );
    expect(Exit.isSuccess(stored) && stored.value.title).toBe("Opening hours");
  });

  test("duplicates a sent campaign into a new draft", async () => {
    const campaign = await createDraft();
    await testDatabase.pool.query(
      "update email_campaigns set status = 'sent' where id = $1",
      [campaign.id]
    );
    const copy = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) => campaigns.duplicate(campaign.id))
      )
    );
    if (Exit.isFailure(copy)) throw Cause.squash(copy.cause);
    campaignIds.push(copy.value.id);
    expect(copy.value).toMatchObject({
      title: `Copy of ${campaign.title}`,
      purpose: campaign.purpose,
      templateKey: campaign.templateKey,
      content: campaign.content,
      audienceId: campaign.audienceId,
      delivery: "once",
      status: "draft",
    });
    expect(copy.value.id).not.toBe(campaign.id);
  });

  // Nothing writes automated campaigns yet, so the tests insert them by SQL.
  const insertAutomated = async (status: CampaignStatus) => {
    const { rows } = await testDatabase.pool.query<{ id: CampaignId }>(
      `insert into email_campaigns (title, purpose, template_key, delivery, status)
       values ('Weekly come-back', 'marketing', 'workspace', 'automated', $1)
       returning id`,
      [status]
    );
    campaignIds.push(rows[0]!.id);
    return rows[0]!.id;
  };

  test("refuses one-off operations on an automated campaign", async () => {
    for (const status of ["draft", "active", "paused", "archived"] as const) {
      const campaignId = await insertAutomated(status);
      const mismatch = {
        _tag: "CampaignDeliveryMismatch",
        campaignId,
        delivery: "automated",
      };

      const operations = [
        CampaignSendService.pipe(
          Effect.flatMap((sending) =>
            sending.testSend({ campaignId, extraRecipients: [] })
          )
        ),
        CampaignSendService.pipe(
          Effect.flatMap((sending) =>
            sending.send({ campaignId, confirmationCode: "ABCD-EFGH" })
          )
        ),
        CampaignSendService.pipe(
          Effect.flatMap((sending) => sending.retryUndelivered({ campaignId }))
        ),
        CampaignService.pipe(
          Effect.flatMap((campaigns) => campaigns.duplicate(campaignId))
        ),
      ];
      for (const operation of operations) {
        expect(failure(await run(operation))).toMatchObject(mismatch);
      }

      const { rows } = await testDatabase.pool.query(
        "select status from email_campaigns where id = $1",
        [campaignId]
      );
      expect(rows).toEqual([{ status }]);
    }
    const { rows: copies } = await testDatabase.pool.query(
      "select id from email_campaigns where title = 'Copy of Weekly come-back'"
    );
    expect(copies).toEqual([]);
  });

  test("reads an automated campaign with its delivery and status", async () => {
    const campaignId = await insertAutomated("active");
    const stored = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) => campaigns.get(campaignId))
      )
    );
    expect(Exit.isSuccess(stored) && stored.value).toMatchObject({
      delivery: "automated",
      status: "active",
    });
  });

  test("keeps a campaign's delivery mode and its statuses consistent", async () => {
    const draft = await createDraft();
    const automatedId = await insertAutomated("draft");

    expect(draft.delivery).toBe("once");
    await expect(
      testDatabase.pool.query(
        "update email_campaigns set delivery = 'automated' where id = $1",
        [draft.id]
      )
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      testDatabase.pool.query(
        "update email_campaigns set delivery = 'once' where id = $1",
        [automatedId]
      )
    ).rejects.toMatchObject({ code: "55000" });
    // An update that leaves the mode as it is still goes through.
    await testDatabase.pool.query(
      "update email_campaigns set delivery = 'once', title = 'Hours' where id = $1",
      [draft.id]
    );

    await expect(
      testDatabase.pool.query(
        "update email_campaigns set status = 'active' where id = $1",
        [draft.id]
      )
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      testDatabase.pool.query(
        "update email_campaigns set status = 'sent' where id = $1",
        [automatedId]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("deletes a draft and reports a missing campaign", async () => {
    const draft = await createDraft();
    const deletion = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) => campaigns.delete(draft.id))
      )
    );
    expect(Exit.isSuccess(deletion)).toBe(true);
    const lookup = await run(
      CampaignService.pipe(
        Effect.flatMap((campaigns) => campaigns.get(draft.id))
      )
    );
    expect(failure(lookup)).toMatchObject({ _tag: "CampaignNotFound" });
  });
});
