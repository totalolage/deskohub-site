import { testEmailAddress } from "@deskohub/test-email";
import {
  type AutomationFlowType,
  AutomationFlow as automationFlowContractSchema,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { customerAccounts, emailCampaignAudiences } from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AudienceFilter } from "@/features/email-campaigns/audience-filter";
import {
  deleteAutomatedCampaigns,
  everyoneFilter,
  seedAutomatedCampaign,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import type {
  CampaignAudienceId,
  CampaignId,
} from "@/features/email-campaigns/campaign-identifiers";
import type { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AutomationPreviewId } from "../automation-identifiers";
import { AutomationLifecycle } from "./automation-lifecycle.service";
import { loadAutomationWorkingCopy } from "./automation-working-copy";

type TestDatabase = NonNullable<
  Awaited<ReturnType<typeof connectWorkspacePostgresTestDatabase>>
>;

/** Decodes a flow fixture written as wire JSON. */
export const automationFlowFixture = Schema.decodeUnknownSync(
  automationFlowContractSchema
);

/** "When a reservation is booked, send." */
export const bookedSendFlow: AutomationFlowType = automationFlowFixture({
  trigger: { _tag: "ReservationBooked" },
  steps: [{ _tag: "Send", id: "send" }],
});

/**
 * Seeds automated campaigns through the real lifecycle: drafts with an
 * audience and working copy, dry runs of them, and activations. Every
 * operation runs at `at` (default `now`) on a `TestClock`. Call `cleanup`
 * in `afterAll`.
 */
export const automationLifecycleTestKit = (
  database: TestDatabase,
  options: { readonly now: Temporal.Instant }
) => {
  const { db, pool, layer: databaseLayer } = database;
  const runId = crypto.randomUUID().slice(0, 8);
  const campaignIds: CampaignId[] = [];
  const audienceIds: CampaignAudienceId[] = [];
  const accountIds: string[] = [];

  const run = <A, E>(
    effect: Effect.Effect<A, E, AutomationLifecycle>,
    at = options.now
  ) =>
    Effect.runPromise(
      TestClock.setTime(at.epochMilliseconds).pipe(
        Effect.andThen(effect),
        Effect.provide(
          Layer.mergeAll(
            AutomationLifecycle.Default.pipe(Layer.provide(databaseLayer)),
            TestClock.layer()
          )
        )
      )
    );

  /** Runs `effect` expecting a failure, and returns its error. */
  const failure = <A, E>(
    effect: Effect.Effect<A, E, AutomationLifecycle>,
    at = options.now
  ) => run(Effect.flip(effect), at);

  const lifecycle = <A, E>(
    use: (service: typeof AutomationLifecycle.Service) => Effect.Effect<A, E>
  ) => Effect.flatMap(AutomationLifecycle, use);

  const insertAudience = async (filter: AudienceFilter = everyoneFilter) => {
    const [audience] = await Effect.runPromise(
      db
        .insert(emailCampaignAudiences)
        .values({ title: `Automation ${runId}`, filter })
        .returning({ id: emailCampaignAudiences.id })
    );
    audienceIds.push(audience!.id);
    return audience!.id;
  };

  /** A draft automation with an audience and, optionally, a saved flow. */
  const seedDraft = async (
    input: {
      readonly flow?: AutomationFlowType;
      readonly audienceFilter?: AudienceFilter;
    } = {}
  ) => {
    const audienceId = await insertAudience(input.audienceFilter);
    const campaignId = await seedAutomatedCampaign(db, {
      purpose: "marketing",
      status: "draft",
    });
    campaignIds.push(campaignId);
    await pool.query(
      "update email_campaigns set audience_id = $2 where id = $1",
      [campaignId, audienceId]
    );
    await pool.query(
      "insert into email_campaign_automations (campaign_id) values ($1)",
      [campaignId]
    );
    if (input.flow !== undefined) {
      const flow = input.flow;
      await run(lifecycle((l) => l.updateFlow({ campaignId, flow })));
    }
    return { campaignId, audienceId };
  };

  /** The working copy's current draft hash. */
  const draftHash = async (campaignId: CampaignId) => {
    const copy = await Effect.runPromise(
      db.transaction((tx) => loadAutomationWorkingCopy(tx, campaignId))
    );
    return Option.getOrThrow(copy.draftHash);
  };

  /** A dry-run job row, of the current draft unless `draftHash` says otherwise. */
  const seedPreview = async (
    campaignId: CampaignId,
    input: {
      readonly status: "running" | "completed" | "superseded" | "failed";
      readonly draftHash?: string;
    }
  ) => {
    const { rows } = await pool.query<{ id: AutomationPreviewId }>(
      `insert into email_campaign_automation_previews
         (campaign_id, draft_hash, kind, status, as_of, units_total, units_done, completed_at)
       values ($1, $2, 'replay', $3, $4, 2, 1, $5)
       returning id`,
      [
        campaignId,
        input.draftHash ?? (await draftHash(campaignId)),
        input.status,
        options.now.toString(),
        input.status === "running" ? null : options.now.toString(),
      ]
    );
    return rows[0]!.id;
  };

  /**
   * A draft activated at `at` through a completed dry run of its current
   * copy, as an administrator would.
   */
  const seedActive = async (
    flow: AutomationFlowType = bookedSendFlow,
    input: {
      readonly audienceFilter?: AudienceFilter;
      readonly at?: Temporal.Instant;
    } = {}
  ) => {
    const draft = await seedDraft({
      flow,
      audienceFilter: input.audienceFilter,
    });
    const previewId = await seedPreview(draft.campaignId, {
      status: "completed",
    });
    const version = await run(
      lifecycle((l) =>
        l.activate({
          campaignId: draft.campaignId,
          previewId,
          activatedBy: null,
        })
      ),
      input.at
    );
    return { ...draft, previewId, version };
  };

  /** A Better Auth account, as the administrator who activates. */
  const seedAccount = async () => {
    const accountId = crypto.randomUUID() as CustomerAccountId;
    accountIds.push(accountId);
    await Effect.runPromise(
      db.insert(customerAccounts).values({ id: accountId })
    );
    await Effect.runPromise(
      db.insert(authUser).values({
        id: accountId,
        name: "Automation admin",
        email: testEmailAddress(`automation-${runId}-${accountIds.length}`),
        locale: "en-US",
      })
    );
    return accountId;
  };

  const cleanup = async () => {
    await deleteAutomatedCampaigns(db, campaignIds);
    await pool.query(
      "delete from email_campaign_audiences where id = any($1)",
      [audienceIds]
    );
    await pool.query('delete from auth."user" where id = any($1)', [
      accountIds,
    ]);
  };

  return {
    runId,
    campaignIds,
    run,
    failure,
    lifecycle,
    insertAudience,
    seedDraft,
    draftHash,
    seedPreview,
    seedActive,
    seedAccount,
    cleanup,
  };
};
