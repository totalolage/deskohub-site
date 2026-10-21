import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { EmailServiceTag } from "@deskohub/email";
import { Cause, Effect, Exit, Layer } from "effect";
import { waitForPostgresLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { parseCampaignBodyMarkdown } from "../body/campaign-body-markdown";
import {
  type CampaignAudienceId,
  type CampaignId,
  campaignIdSchema,
} from "../campaign-identifiers";
import type { automatedCampaignStatuses } from "../campaign-states";
import { CampaignService, type ICampaignService } from "./campaign.service";
import { CampaignAudienceService } from "./campaign-audience.service";
import { CampaignConfirmationCodeService } from "./campaign-confirmation-code.service";
import { CampaignEmailConfig } from "./campaign-email.config";
import { CampaignRecipientService } from "./campaign-recipient.service";
import { CampaignSendService } from "./campaign-send.service";
import { CampaignSendQueueService } from "./campaign-send-queue.service";
import {
  audienceConditionFlowFixture,
  campaignContentFixture,
  deleteAutomatedCampaigns,
  everyoneFilter,
  seedAutomationVersion,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("CampaignService on disposable Postgres", () => {
  if (!testDatabase) return;
  const { db, pool } = testDatabase;
  const campaignIds: CampaignId[] = [];
  const audienceIds: CampaignAudienceId[] = [];

  afterAll(async () => {
    await deleteAutomatedCampaigns(db, campaignIds);
    await pool.query(
      "delete from email_campaign_audiences where id = any($1)",
      [audienceIds]
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

  const succeeded = <A>(exit: Exit.Exit<A, unknown>) => {
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    return exit.value;
  };

  const withCampaigns = <A, E>(
    operation: (campaigns: ICampaignService) => Effect.Effect<A, E>
  ) => run(CampaignService.pipe(Effect.flatMap(operation)));

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

  /** Creates an automated campaign and moves it to `status` by SQL. */
  const createAutomated = async (
    status: (typeof automatedCampaignStatuses)[number],
    audienceId: CampaignAudienceId | null = null
  ) => {
    const campaign = succeeded(
      await withCampaigns((campaigns) =>
        campaigns.create({
          title: "Weekly come-back",
          purpose: "marketing",
          templateKey: "workspace",
          content: campaignContentFixture(),
          audienceId,
          delivery: "automated",
        })
      )
    );
    campaignIds.push(campaign.id);
    if (status !== "draft") {
      await pool.query("update email_campaigns set status = $2 where id = $1", [
        campaign.id,
        status,
      ]);
    }
    return campaign.id;
  };

  /** Publishes a version of the campaign and makes it the active one. */
  const publishVersion = async (campaignId: CampaignId) => {
    const versionId = await seedAutomationVersion(db, {
      campaignId,
      purpose: "marketing",
    });
    await pool.query(
      "update email_campaign_automations set active_version_id = $2 where campaign_id = $1",
      [campaignId, versionId]
    );
  };

  const automationRows = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select flow, active_version_id from email_campaign_automations where campaign_id = $1",
        [campaignId]
      )
    ).rows;

  /** Rows a single transaction inserted share its `xmin`. */
  const insertedWithItsAutomation = async (campaignId: CampaignId) =>
    (
      await pool.query(
        `select c.xmin::text = a.xmin::text as together
         from email_campaigns c
         join email_campaign_automations a on a.campaign_id = c.id
         where c.id = $1`,
        [campaignId]
      )
    ).rows;

  const insertAudience = async () => {
    const { rows } = await pool.query<{ id: CampaignAudienceId }>(
      "insert into email_campaign_audiences (title, filter) values ('Regulars', $1) returning id",
      [everyoneFilter]
    );
    audienceIds.push(rows[0]!.id);
    return rows[0]!.id;
  };

  test("creates an automated draft with its automation row in one transaction", async () => {
    const campaignId = await createAutomated("draft");
    const stored = succeeded(
      await withCampaigns((campaigns) => campaigns.get(campaignId))
    );
    expect(stored).toMatchObject({ delivery: "automated", status: "draft" });
    expect(await automationRows(campaignId)).toEqual([
      { flow: null, active_version_id: null },
    ]);
    expect(await insertedWithItsAutomation(campaignId)).toEqual([
      { together: true },
    ]);

    const oneOff = await createDraft();
    expect(oneOff.delivery).toBe("once");
    expect(await automationRows(oneOff.id)).toEqual([]);
  });

  test("edits an automated campaign until it's archived, leaving its status and versions", async () => {
    for (const status of ["draft", "active", "paused"] as const) {
      const campaignId = await createAutomated(status);
      if (status !== "draft") await publishVersion(campaignId);

      const updated = succeeded(
        await withCampaigns((campaigns) =>
          campaigns.update({
            campaignId,
            title: "Edited",
            content: campaignContentFixture("Upraveno"),
          })
        )
      );
      expect(updated).toMatchObject({
        title: "Edited",
        content: campaignContentFixture("Upraveno"),
        status,
      });
      const patched = succeeded(
        await withCampaigns((campaigns) =>
          campaigns.patch({
            campaignId,
            content: { "cs-CZ": { subject: "Nový předmět" } },
          })
        )
      );
      expect(patched).toMatchObject({ status });
      expect(patched.content["cs-CZ"]?.subject).toBe("Nový předmět");

      const { rows: versions } = await pool.query(
        "select content from email_campaign_automation_versions where campaign_id = $1",
        [campaignId]
      );
      expect(versions).toEqual(
        status === "draft" ? [] : [{ content: campaignContentFixture("Verze") }]
      );
    }

    const archivedId = await createAutomated("archived");
    const readOnly = {
      _tag: "CampaignReadOnly",
      campaignId: archivedId,
      status: "archived",
    };
    expect(
      failure(
        await withCampaigns((campaigns) =>
          campaigns.update({ campaignId: archivedId, title: "Edited" })
        )
      )
    ).toMatchObject(readOnly);
    expect(
      failure(
        await withCampaigns((campaigns) =>
          campaigns.patch({
            campaignId: archivedId,
            content: { "cs-CZ": { subject: "Nový předmět" } },
          })
        )
      )
    ).toMatchObject(readOnly);
    const { rows } = await pool.query(
      "select title, status from email_campaigns where id = $1",
      [archivedId]
    );
    expect(rows).toEqual([{ title: "Weekly come-back", status: "archived" }]);
  });

  test("an automated edit waits on the lifecycle lock and then rechecks the status", async () => {
    const campaignId = await createAutomated("active");
    const lifecycle = await pool.connect();
    try {
      const {
        rows: [{ pid }],
      } = await lifecycle.query("select pg_backend_pid() as pid");
      await lifecycle.query("begin");
      await lifecycle.query(
        "select campaign_id from email_campaign_automations where campaign_id = $1 for update",
        [campaignId]
      );

      const pending = withCampaigns((campaigns) =>
        campaigns.update({ campaignId, title: "Edited" })
      );
      await waitForPostgresLockWaiter(pool, {
        condition: "$1 = any(pg_blocking_pids(pid))",
        values: [pid],
        description: "the edit to wait on the lifecycle lock",
      });
      await lifecycle.query(
        "update email_campaigns set status = 'archived' where id = $1",
        [campaignId]
      );
      await lifecycle.query("commit");

      expect(failure(await pending)).toMatchObject({
        _tag: "CampaignReadOnly",
        status: "archived",
      });
    } finally {
      lifecycle.release();
    }
  });

  test("patches content as the CLI merges it", async () => {
    const draft = await createDraft();
    const czech = campaignContentFixture()["cs-CZ"]!;
    const patch = (
      changes: Omit<Parameters<ICampaignService["patch"]>[0], "campaignId">
    ) =>
      withCampaigns((campaigns) =>
        campaigns.patch({ campaignId: draft.id, ...changes })
      );

    expect(
      failure(await patch({ content: { "en-US": { subject: "News" } } }))
    ).toMatchObject({
      _tag: "CampaignLocaleContentMissing",
      campaignId: draft.id,
      locale: "en-US",
    });

    const english = {
      subject: "News",
      preheader: "",
      body: await Effect.runPromise(parseCampaignBodyMarkdown("Hello")),
    };
    const added = succeeded(
      await patch({
        content: { "en-US": { subject: "News", bodyMarkdown: "Hello" } },
      })
    );
    expect(added.content).toEqual({ "cs-CZ": czech, "en-US": english });

    const reason = "Měníme provozní dobu.";
    const changed = succeeded(
      await patch({
        content: { "cs-CZ": { subject: "Nové", operationalReason: reason } },
      })
    );
    expect(changed.content).toEqual({
      "cs-CZ": { ...czech, subject: "Nové", operationalReason: reason },
      "en-US": english,
    });

    const kept = succeeded(
      await patch({
        title: "Hours",
        content: { "cs-CZ": { preheader: "Jiný" } },
      })
    );
    expect(kept.title).toBe("Hours");
    expect(kept.content["cs-CZ"]).toEqual({
      ...czech,
      subject: "Nové",
      preheader: "Jiný",
      operationalReason: reason,
    });

    const cleared = succeeded(
      await patch({
        content: { "cs-CZ": { operationalReason: null }, "en-US": null },
      })
    );
    expect(cleared.content).toEqual({
      "cs-CZ": { ...czech, subject: "Nové", preheader: "Jiný" },
    });

    expect(
      failure(
        await patch({
          content: {
            "cs-CZ": { bodyMarkdown: "[[button: Go](http://deskohub.cz)]" },
          },
        })
      )
    ).toMatchObject({
      _tag: "CampaignBodyMarkdownInvalid",
      locale: "cs-CZ",
      cause: { _tag: "InvalidCampaignBody" },
    });
    const stored = succeeded(
      await withCampaigns((campaigns) => campaigns.get(draft.id))
    );
    expect(stored.content).toEqual(cleared.content);
  });

  test("patches other fields and reports a missing or read-only campaign", async () => {
    const draft = await createDraft();
    const renamed = succeeded(
      await withCampaigns((campaigns) =>
        campaigns.patch({ campaignId: draft.id, title: "Renamed" })
      )
    );
    expect(renamed).toMatchObject({
      title: "Renamed",
      content: campaignContentFixture(),
    });

    const missingId = campaignIdSchema.make("missing-campaign");
    for (const content of [undefined, { "cs-CZ": { subject: "Nové" } }]) {
      expect(
        failure(
          await withCampaigns((campaigns) =>
            campaigns.patch({ campaignId: missingId, title: "X", content })
          )
        )
      ).toMatchObject({ _tag: "CampaignNotFound", campaignId: missingId });
    }

    await pool.query(
      "update email_campaigns set status = 'sent' where id = $1",
      [draft.id]
    );
    expect(
      failure(
        await withCampaigns((campaigns) =>
          campaigns.patch({
            campaignId: draft.id,
            content: { "cs-CZ": { subject: "Nové" } },
          })
        )
      )
    ).toMatchObject({ _tag: "CampaignReadOnly", status: "sent" });
  });

  test("duplicates an automated campaign with its working copy", async () => {
    const audienceId = await insertAudience();
    const campaignId = await createAutomated("active", audienceId);
    const flow = audienceConditionFlowFixture(audienceId);
    await pool.query(
      "update email_campaign_automations set flow = $2 where campaign_id = $1",
      [campaignId, flow]
    );
    await publishVersion(campaignId);
    await pool.query(
      "update email_campaigns set status = 'archived' where id = $1",
      [campaignId]
    );

    const copy = succeeded(
      await withCampaigns((campaigns) => campaigns.duplicate(campaignId))
    );
    campaignIds.push(copy.id);
    expect(copy).toMatchObject({
      title: "Copy of Weekly come-back",
      purpose: "marketing",
      templateKey: "workspace",
      content: campaignContentFixture(),
      audienceId,
      delivery: "automated",
      status: "draft",
    });
    expect(await automationRows(copy.id)).toEqual([
      { flow, active_version_id: null },
    ]);
    expect(await insertedWithItsAutomation(copy.id)).toEqual([
      { together: true },
    ]);
  });

  test("refuses to duplicate a draft whose saved flow breaks a save rule", async () => {
    const campaignId = await createAutomated("draft");
    // Saved before schedules had to fire on engine ticks (D36).
    await pool.query(
      "update email_campaign_automations set flow = $2 where campaign_id = $1",
      [
        campaignId,
        {
          trigger: {
            _tag: "Schedule",
            calendar: { hours: [10], minutes: [7] },
          },
          steps: [{ _tag: "Send", id: "step-send" }],
        },
      ]
    );
    const copies = async () => {
      const { rows } = await pool.query(
        "select count(*)::int as copies from email_campaigns where title = 'Copy of Weekly come-back'"
      );
      return rows[0].copies;
    };
    const before = await copies();

    expect(
      failure(
        await withCampaigns((campaigns) => campaigns.duplicate(campaignId))
      )
    ).toMatchObject({ _tag: "AutomationScheduleMinutesNotAllowed" });
    expect(await copies()).toBe(before);
  });

  test("deletes an automated draft until it publishes a version", async () => {
    const draftId = await createAutomated("draft");
    succeeded(await withCampaigns((campaigns) => campaigns.delete(draftId)));
    const { rows } = await pool.query(
      "select id from email_campaigns where id = $1",
      [draftId]
    );
    expect(rows).toEqual([]);
    expect(await automationRows(draftId)).toEqual([]);

    const activeId = await createAutomated("active");
    await publishVersion(activeId);
    expect(
      failure(await withCampaigns((campaigns) => campaigns.delete(activeId)))
    ).toMatchObject({ _tag: "CampaignReadOnly", status: "active" });

    // Activation leaves Draft as it publishes, so this only guards the rule.
    const publishedId = await createAutomated("draft");
    await publishVersion(publishedId);
    expect(
      failure(await withCampaigns((campaigns) => campaigns.delete(publishedId)))
    ).toMatchObject({ _tag: "CampaignPublished", campaignId: publishedId });
    expect(await automationRows(publishedId)).toHaveLength(1);
  });

  test("refuses one-off sending operations on an automated campaign", async () => {
    for (const status of ["draft", "active", "paused", "archived"] as const) {
      const campaignId = await createAutomated(status);
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
      ];
      for (const operation of operations) {
        expect(failure(await run(operation))).toMatchObject(mismatch);
      }

      const { rows } = await pool.query(
        "select title, status from email_campaigns where id = $1",
        [campaignId]
      );
      expect(rows).toEqual([{ title: "Weekly come-back", status }]);
    }
  });

  test("reads an automated campaign with its delivery and status", async () => {
    const campaignId = await createAutomated("active");
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
    const automatedId = await createAutomated("draft");

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
