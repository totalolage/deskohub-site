import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { AutomationFlow } from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationStepId,
  AutomationVersionId,
} from "../automation-identifiers";
import { makeEngineDotypos } from "./automation-engine-scenario.test-utils";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import {
  type AutomationTriggerOccurrence,
  enterAutomationRuns,
} from "./automation-run-entry";

const database = await createWorkspacePostgresSuiteDatabase(
  "automation_run_entry"
);
afterAll(() => database?.close());
const now = Temporal.Instant.from("2026-10-19T10:00:00Z");
const prefix = `run-entry-${crypto.randomUUID()}`;

const sendFlow: AutomationFlow = {
  trigger: { _tag: "Schedule", calendar: { minutes: [0], hours: [10] } },
  steps: [{ _tag: "Send", id: "send" as AutomationStepId }],
};

const customer = (name: string) => `${prefix}-${name}` as DotyposCustomerId;

const occurrence = (
  name: string,
  minutesAfter: number,
  key = `${name}-${minutesAfter}`
): AutomationTriggerOccurrence => ({
  dotyposCustomerId: customer(name),
  dedupKey: `${prefix}:${key}`,
  kind: "schedule",
  at: now.add({ minutes: minutesAfter }),
  eventId: null,
  reservationId: null,
});

describe.skipIf(!database)("enterAutomationRuns on Postgres", () => {
  if (!database) return;
  const { db, pool } = database;
  const dotypos = makeEngineDotypos();
  const layer = Layer.mergeAll(
    database.layer,
    AutomationEvaluationFacts.Default.pipe(
      Layer.provide(Layer.merge(database.layer, dotypos.layer))
    )
  );
  const campaignIds: CampaignId[] = [];

  afterEach(async () => {
    await deleteAutomatedCampaigns(db, campaignIds.splice(0));
  });

  const automation = async () => {
    const campaignId = await seedAutomatedCampaign(db, {
      purpose: "marketing",
    });
    campaignIds.push(campaignId);
    const versionId = await seedAutomationVersion(db, {
      campaignId,
      purpose: "marketing",
      flow: sendFlow,
      activatedAt: now.subtract({ hours: 1 }),
    });
    await seedAutomation(db, {
      campaignId,
      activeVersionId: versionId,
      acceptingSince: now.subtract({ hours: 1 }),
    });
    return { campaignId, versionId };
  };

  const enter = (input: {
    readonly campaignId: CampaignId;
    readonly versionId: AutomationVersionId;
    readonly flow?: AutomationFlow;
    readonly admitted?: readonly AutomationTriggerOccurrence[];
    readonly rejected?: Parameters<typeof enterAutomationRuns>[0]["rejected"];
  }) =>
    Effect.flatMap(WorkspaceDatabase, ({ transaction }) =>
      transaction(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          enterAutomationRuns({
            campaignId: input.campaignId,
            versionId: input.versionId,
            ...(input.admitted && {
              admitted: {
                flow: input.flow ?? sendFlow,
                occurrences: input.admitted,
                facts,
              },
            }),
            rejected: input.rejected ?? [],
            at: now,
          })
        )
      )
    ).pipe(Effect.provide(layer));

  const receiptsOf = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select dedup_key, dotypos_customer_id, disposition, run_id is not null as has_run from email_campaign_automation_trigger_receipts where campaign_id = $1 order by dedup_key",
        [campaignId]
      )
    ).rows.map((row) => [
      row.dedup_key,
      row.dotypos_customer_id,
      row.disposition,
      row.has_run,
    ]);

  const runsOf = async (campaignId: CampaignId) =>
    (
      await pool.query(
        "select dotypos_customer_id, (extract(epoch from trigger_at) * 1000)::bigint::text as trigger_ms, status, step_id from email_campaign_automation_runs where campaign_id = $1 order by dotypos_customer_id",
        [campaignId]
      )
    ).rows;

  test("starts one run per customer from the earliest occurrence, recording every occurrence", async () => {
    const { campaignId, versionId } = await automation();

    const entry = await Effect.runPromise(
      enter({
        campaignId,
        versionId,
        admitted: [
          occurrence("alice", 5),
          occurrence("bob", 1),
          occurrence("alice", 0),
        ],
        rejected: [
          { ...occurrence("carol", 0), disposition: "not-in-audience" },
        ],
      })
    );

    expect(entry).toEqual({ started: 2, alreadyActive: 1, rejected: 1 });
    expect(await receiptsOf(campaignId)).toEqual([
      [`${prefix}:alice-0`, customer("alice"), "started", true],
      [`${prefix}:alice-5`, customer("alice"), "already-active", false],
      [`${prefix}:bob-1`, customer("bob"), "started", true],
      [`${prefix}:carol-0`, customer("carol"), "not-in-audience", false],
    ]);
    expect(await runsOf(campaignId)).toEqual(
      ["alice", "bob"].toSorted().map((name) => ({
        dotypos_customer_id: customer(name),
        trigger_ms: String(
          now.add({ minutes: name === "bob" ? 1 : 0 }).epochMilliseconds
        ),
        status: "active",
        step_id: "send",
      }))
    );
  });

  test("records already-active for a customer with an open run", async () => {
    const { campaignId, versionId } = await automation();
    await Effect.runPromise(
      enter({ campaignId, versionId, admitted: [occurrence("alice", 0)] })
    );

    const entry = await Effect.runPromise(
      enter({ campaignId, versionId, admitted: [occurrence("alice", 30)] })
    );

    expect(entry).toEqual({ started: 0, alreadyActive: 1, rejected: 0 });
    expect(await receiptsOf(campaignId)).toEqual([
      [`${prefix}:alice-0`, customer("alice"), "started", true],
      [`${prefix}:alice-30`, customer("alice"), "already-active", false],
    ]);
  });

  test("starts no run for a flow without steps", async () => {
    const { campaignId, versionId } = await automation();

    const entry = await Effect.runPromise(
      enter({
        campaignId,
        versionId,
        flow: { ...sendFlow, steps: [] },
        admitted: [occurrence("alice", 0)],
      })
    );

    expect(entry).toEqual({ started: 0, alreadyActive: 1, rejected: 0 });
    expect(await runsOf(campaignId)).toEqual([]);
  });

  test("records rejections without admitted occurrences", async () => {
    const { campaignId, versionId } = await automation();

    const entry = await Effect.runPromise(
      enter({
        campaignId,
        versionId,
        rejected: [{ ...occurrence("carol", 0), disposition: "withdrawn" }],
      })
    );

    expect(entry).toEqual({ started: 0, alreadyActive: 0, rejected: 1 });
    expect(await receiptsOf(campaignId)).toEqual([
      [`${prefix}:carol-0`, customer("carol"), "withdrawn", false],
    ]);
  });

  test("enters nothing without occurrences", async () => {
    const { campaignId, versionId } = await automation();

    const entry = await Effect.runPromise(
      enter({ campaignId, versionId, admitted: [] })
    );

    expect(entry).toEqual({ started: 0, alreadyActive: 0, rejected: 0 });
    expect(await receiptsOf(campaignId)).toEqual([]);
  });

  test("fails and keeps no run when another commit took the receipt key", async () => {
    const { campaignId, versionId } = await automation();
    await Effect.runPromise(
      enter({
        campaignId,
        versionId,
        rejected: [
          { ...occurrence("alice", 0), disposition: "not-in-audience" },
        ],
      })
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        enter({ campaignId, versionId, admitted: [occurrence("alice", 0)] })
      )
    );

    expect(failure).toMatchObject({
      _tag: "AutomationUnitRecheckFailed",
      code: "receipt-taken",
    });
    expect(await runsOf(campaignId)).toEqual([]);
  });
});
