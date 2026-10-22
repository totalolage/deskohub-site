import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import type { AutomationRunListInputType as AutomationRunListInput } from "@deskohub/workspace-admin-api";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import {
  emailCampaignAutomationRunEvents,
  emailCampaignAutomationRuns,
} from "@/db/schema";
import {
  deleteAutomatedCampaigns,
  deleteCampaigns,
  seedAutomatedCampaign,
  seedAutomationVersion,
  seedCampaignSend,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import type { CampaignId } from "@/features/email-campaigns/campaign-identifiers";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type {
  AutomationRunId,
  AutomationStepId,
  AutomationVersionId,
} from "../automation-identifiers";
import type { AutomationRunOutcome } from "../automation-states";
import { AutomationRunLog } from "./automation-run-log.service";

/**
 * The suite swaps a table constraint, so it runs on a database of its own.
 */
const testDatabase =
  await createWorkspacePostgresSuiteDatabase("automation_run_log");
afterAll(() => testDatabase?.close());

const suite = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`automation-run-log-${suite}-${name}`);
const stepId = (id: string) => id as AutomationStepId;

const startedAt = Temporal.Instant.from("2026-10-19T08:00:00Z");
const minutes = (count: number) => startedAt.add({ minutes: count });

/** How a seeded run stands: open at a step, or ended with an outcome. */
type SeededRunState =
  | { readonly status: "active"; readonly phase: "ready" | "waiting" }
  | {
      readonly status: "ended";
      readonly outcome: AutomationRunOutcome;
      readonly reason?: string;
    };

const kindCheck = "email_campaign_automation_run_events_kind_check";

describe.skipIf(!testDatabase)(
  "automation run log on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db, pool, layer } = testDatabase;
    const automatedIds: CampaignId[] = [];
    const oneOffIds: CampaignId[] = [];
    let kindCheckDefinition = "";

    const run = <A, E>(
      operation: (log: AutomationRunLog["Service"]) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.flatMap(AutomationRunLog, operation).pipe(
          Effect.provide(AutomationRunLog.Default),
          Effect.provide(layer)
        )
      );

    const failure = <A, E>(
      operation: (log: AutomationRunLog["Service"]) => Effect.Effect<A, E>
    ) => run((log) => Effect.flip(operation(log)));

    const automation = async () => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "marketing",
      });
      automatedIds.push(campaignId);
      const versionIds = [
        await seedAutomationVersion(db, {
          campaignId,
          purpose: "marketing",
          versionNumber: 1,
        }),
        await seedAutomationVersion(db, {
          campaignId,
          purpose: "marketing",
          versionNumber: 2,
        }),
      ] as const;
      return { campaignId, versionIds };
    };

    const seedRun = async (input: {
      readonly campaignId: CampaignId;
      readonly versionId: AutomationVersionId;
      readonly customer: string;
      readonly step: string;
      readonly startedAt: Temporal.Instant;
      readonly state: SeededRunState;
    }) => {
      const { state } = input;
      const [row] = await Effect.runPromise(
        db
          .insert(emailCampaignAutomationRuns)
          .values({
            campaignId: input.campaignId,
            versionId: input.versionId,
            dotyposCustomerId: customerId(input.customer),
            triggerKind: "account-created",
            triggerAt: input.startedAt,
            status: state.status,
            stepId: stepId(input.step),
            stepEnteredAt: input.startedAt,
            startedAt: input.startedAt,
            ...(state.status === "active"
              ? { phase: state.phase, dueAt: input.startedAt.add({ hours: 1 }) }
              : {
                  outcome: state.outcome,
                  outcomeReason: (state.reason ?? null) as never,
                  endedAt: input.startedAt.add({ minutes: 30 }),
                }),
          })
          .returning({ id: emailCampaignAutomationRuns.id })
      );
      return row!.id;
    };

    let seeded: Awaited<ReturnType<typeof seedLog>>;

    /** Seven runs over two versions and two steps; r5 and r6 start together. */
    const seedLog = async () => {
      const { campaignId, versionIds } = await automation();
      const [v1, v2] = versionIds;
      const runs = [
        {
          versionId: v1,
          step: "s1",
          state: { status: "ended", outcome: "sent" },
        },
        {
          versionId: v1,
          step: "s2",
          state: {
            status: "ended",
            outcome: "skipped",
            reason: "consent-withdrawn",
          },
        },
        {
          versionId: v1,
          step: "s1",
          state: { status: "active", phase: "ready" },
        },
        {
          versionId: v2,
          step: "s1",
          state: { status: "ended", outcome: "condition-failed" },
        },
        {
          versionId: v2,
          step: "s2",
          state: { status: "active", phase: "waiting" },
        },
        {
          versionId: v2,
          step: "s2",
          state: {
            status: "ended",
            outcome: "failed",
            reason: "evaluation-unavailable",
          },
        },
        {
          versionId: v2,
          step: "s2",
          state: { status: "ended", outcome: "sent" },
        },
      ] as const;
      const ids: AutomationRunId[] = [];
      for (const [index, seededRun] of runs.entries()) {
        ids.push(
          await seedRun({
            campaignId,
            ...seededRun,
            customer: `r${index}`,
            startedAt: minutes(Math.min(index, 5)),
          })
        );
      }
      return { campaignId, ids };
    };

    /** Newest first: by start, then by id among runs that started together. */
    const newestFirst = (ids: readonly AutomationRunId[]) => {
      const [r0, r1, r2, r3, r4, r5, r6] = ids;
      const [tiedFirst, tiedSecond] = [r5!, r6!].sort().reverse();
      return [tiedFirst!, tiedSecond!, r4!, r3!, r2!, r1!, r0!];
    };

    beforeAll(async () => {
      seeded = await seedLog();
      const result = await pool.query(
        "select pg_get_constraintdef(oid) as definition from pg_constraint where conname = $1",
        [kindCheck]
      );
      kindCheckDefinition = (result as { rows: { definition: string }[] })
        .rows[0]!.definition;
    });

    afterAll(async () => {
      await deleteAutomatedCampaigns(db, automatedIds);
      await deleteCampaigns(pool, oneOffIds);
      await pool.query(
        `alter table email_campaign_automation_run_events validate constraint ${kindCheck}`
      );
    });

    test("lists runs newest first, narrowed by each filter", async () => {
      const { campaignId, ids } = seeded;
      const [r0, r1, r2, r3, r4, r5, r6] = ids;
      const listed = (filters: Omit<AutomationRunListInput, "campaignId">) =>
        run((log) => log.listRuns({ campaignId, ...filters })).then((page) =>
          page.runs.map(({ runId }) => runId)
        );

      expect(await listed({})).toEqual(newestFirst(ids));
      expect(await listed({ state: "active" })).toEqual([r4!, r2!]);
      expect(await listed({ stepId: "s1" })).toEqual([r3!, r2!, r0!]);
      expect(await listed({ outcome: "sent" })).toEqual([r6!, r0!]);
      expect(await listed({ versionNumber: 1 })).toEqual([r2!, r1!, r0!]);
      expect(await listed({ customerId: customerId("r3") })).toEqual([r3!]);
      expect(
        await listed({ state: "ended", stepId: "s2", versionNumber: 2 })
      ).toEqual(newestFirst(ids).filter((id) => id === r5 || id === r6));
    });

    test("maps each run to the contract, with phase and due only while active", async () => {
      const { campaignId, ids } = seeded;
      const page = await run((log) => log.listRuns({ campaignId }));
      const byId = new Map(
        page.runs.map((summary) => [summary.runId, summary])
      );

      expect(byId.get(ids[4]!)).toEqual({
        runId: ids[4]!,
        campaignId,
        versionNumber: 2,
        customerId: customerId("r4"),
        triggerKind: "account-created",
        triggerAt: minutes(4).toString(),
        state: "active",
        phase: "waiting",
        stepId: stepId("s2"),
        dueAt: minutes(4).add({ hours: 1 }).toString(),
        outcome: null,
        outcomeReason: null,
        sendId: null,
        startedAt: minutes(4).toString(),
        endedAt: null,
      });
      expect(byId.get(ids[1]!)).toMatchObject({
        versionNumber: 1,
        state: "ended",
        phase: null,
        dueAt: null,
        outcome: "skipped",
        outcomeReason: "consent-withdrawn",
        endedAt: minutes(1).add({ minutes: 30 }).toString(),
      });
    });

    test("pages without gaps or duplicates while newer runs start", async () => {
      const { campaignId, versionIds } = await automation();
      const ids: AutomationRunId[] = [];
      for (const index of [0, 1, 2, 3, 4]) {
        ids.push(
          await seedRun({
            campaignId,
            versionId: versionIds[0],
            customer: `page-${index}`,
            step: "s1",
            startedAt: minutes(index < 3 ? 0 : index),
            state: { status: "ended", outcome: "sent" },
          })
        );
      }

      const first = await run((log) => log.listRuns({ campaignId, limit: 2 }));
      await seedRun({
        campaignId,
        versionId: versionIds[0],
        customer: "page-late",
        step: "s1",
        startedAt: minutes(60),
        state: { status: "ended", outcome: "sent" },
      });
      const pages = [first];
      while (pages.at(-1)!.nextCursor !== null) {
        const cursor = pages.at(-1)!.nextCursor!;
        pages.push(
          await run((log) => log.listRuns({ campaignId, limit: 2, cursor }))
        );
      }

      const tied = ids.slice(0, 3).sort().reverse();
      expect(pages.map((page) => page.runs.length)).toEqual([2, 2, 1]);
      expect(
        pages.flatMap((page) => page.runs.map(({ runId }) => runId))
      ).toEqual([ids[4]!, ids[3]!, ...tied]);
    });

    test("rejects a cursor it didn't issue", async () => {
      const { campaignId } = seeded;
      for (const cursor of [
        "not a cursor!",
        Buffer.from("{}").toString("base64url"),
        Buffer.from('{"startedAt":"yesterday","runId":"x"}').toString(
          "base64url"
        ),
      ]) {
        const error = await failure((log) =>
          log.listRuns({ campaignId, cursor })
        );
        expect(error._tag).toBe("AutomationPageCursorInvalid");
      }
    });

    test("refuses an unknown campaign, a one-off campaign and an unknown version", async () => {
      const { campaignId: oneOffId } = await seedCampaignSend(db, {
        purpose: "marketing",
        status: "sent",
        recipients: [],
      });
      oneOffIds.push(oneOffId);
      const unknownId = crypto.randomUUID() as CampaignId;

      for (const operation of ["listRuns", "getRunStats"] as const) {
        expect(
          (await failure((log) => log[operation]({ campaignId: unknownId })))
            ._tag
        ).toBe("CampaignNotFound");
        expect(
          (await failure((log) => log[operation]({ campaignId: oneOffId })))
            ._tag
        ).toBe("CampaignDeliveryMismatch");
        expect(
          (
            await failure((log) =>
              log[operation]({
                campaignId: seeded.campaignId,
                versionNumber: 9,
              })
            )
          )._tag
        ).toBe("AutomationVersionNotFound");
      }
      expect(
        (
          await failure((log) =>
            log.getRun({ runId: crypto.randomUUID() as AutomationRunId })
          )
        )._tag
      ).toBe("AutomationRunNotFound");
    });

    test("reads a timeline in sequence, unreadable entries as generic ones", async () => {
      const runId = seeded.ids[4]!;
      const at = (minute: number) => minutes(4).add({ minutes: minute });
      const dueAt = minutes(4).add({ hours: 1 }).toString();
      await Effect.runPromise(
        db.transaction((tx) =>
          Effect.gen(function* () {
            // A newer build may record a kind this one doesn't know.
            yield* tx.execute(
              sql.raw(
                `alter table email_campaign_automation_run_events drop constraint ${kindCheck}`
              )
            );
            yield* tx.insert(emailCampaignAutomationRunEvents).values([
              {
                runId,
                sequence: 4,
                kind: "rerouted" as never,
                stepId: stepId("s2"),
                at: at(3),
                detail: { toStepId: "s3" } as never,
              },
              {
                runId,
                sequence: 2,
                kind: "condition-passed",
                stepId: stepId("s1"),
                at: at(1),
              },
              {
                runId,
                sequence: 1,
                kind: "started",
                stepId: null,
                at: at(0),
              },
              {
                runId,
                sequence: 3,
                kind: "waiting",
                stepId: stepId("s2"),
                at: at(2),
                detail: { dueAt },
              },
              {
                runId,
                sequence: 5,
                kind: "waiting",
                stepId: stepId("s2"),
                at: at(4),
                detail: { dueAt: 5 } as never,
              },
              {
                runId,
                sequence: 6,
                kind: "woke",
                stepId: stepId("s2"),
                at: at(5),
                detail: sql`'"oops"'::jsonb` as never,
              },
            ]);
            yield* tx.execute(
              sql.raw(
                `alter table email_campaign_automation_run_events add constraint ${kindCheck} ${kindCheckDefinition} not valid`
              )
            );
          })
        )
      );

      const detail = await run((log) => log.getRun({ runId }));

      expect(detail).toMatchObject({ runId, state: "active", stepId: "s2" });
      expect(detail.timeline).toEqual([
        {
          sequence: 1,
          kind: "started",
          stepId: null,
          at: at(0).toString(),
          detail: {},
        },
        {
          sequence: 2,
          kind: "condition-passed",
          stepId: stepId("s1"),
          at: at(1).toString(),
          detail: {},
        },
        {
          sequence: 3,
          kind: "waiting",
          stepId: stepId("s2"),
          at: at(2).toString(),
          detail: { dueAt },
        },
        {
          sequence: 4,
          kind: "rerouted",
          stepId: stepId("s2"),
          at: at(3).toString(),
          detail: { toStepId: "s3" },
        },
        {
          sequence: 5,
          kind: "waiting",
          stepId: stepId("s2"),
          at: at(4).toString(),
          detail: { dueAt: 5 },
        },
        {
          sequence: 6,
          kind: "woke",
          stepId: stepId("s2"),
          at: at(5).toString(),
          detail: {},
        },
      ]);
    });

    test("counts runs by state, outcome and step, every key present", async () => {
      const { campaignId } = seeded;
      const zeroOutcomes = {
        sent: 0,
        unconfirmed: 0,
        "condition-failed": 0,
        skipped: 0,
        failed: 0,
        withdrawn: 0,
        archived: 0,
      };

      expect(await run((log) => log.getRunStats({ campaignId }))).toEqual({
        campaignId,
        versionNumber: null,
        byState: { active: 2, sending: 0, ended: 5 },
        byOutcome: {
          ...zeroOutcomes,
          sent: 2,
          "condition-failed": 1,
          skipped: 1,
          failed: 1,
        },
        bySteps: [
          {
            stepId: stepId("s1"),
            byState: { active: 1, sending: 0, ended: 2 },
            byOutcome: { ...zeroOutcomes, sent: 1, "condition-failed": 1 },
          },
          {
            stepId: stepId("s2"),
            byState: { active: 1, sending: 0, ended: 3 },
            byOutcome: { ...zeroOutcomes, sent: 1, skipped: 1, failed: 1 },
          },
        ],
      });
      expect(
        await run((log) => log.getRunStats({ campaignId, versionNumber: 1 }))
      ).toEqual({
        campaignId,
        versionNumber: 1,
        byState: { active: 1, sending: 0, ended: 2 },
        byOutcome: { ...zeroOutcomes, sent: 1, skipped: 1 },
        bySteps: [
          {
            stepId: stepId("s1"),
            byState: { active: 1, sending: 0, ended: 1 },
            byOutcome: { ...zeroOutcomes, sent: 1 },
          },
          {
            stepId: stepId("s2"),
            byState: { active: 0, sending: 0, ended: 1 },
            byOutcome: { ...zeroOutcomes, skipped: 1 },
          },
        ],
      });
    });
  }
);
