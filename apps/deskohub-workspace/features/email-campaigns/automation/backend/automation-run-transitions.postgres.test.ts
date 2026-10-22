import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { AutomationStepId } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import {
  deleteAutomatedCampaigns,
  seedAutomatedCampaign,
  seedAutomatedSend,
  seedAutomationVersion,
} from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import {
  type CampaignId,
  campaignAudienceIdSchema,
} from "@/features/email-campaigns/campaign-identifiers";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AutomationRunId,
  automationWorkUnitIdSchema,
} from "../automation-identifiers";
import { appendAutomationRunProgress } from "./automation-run-timeline";
import {
  type AutomationRunEnding,
  type AutomationRunExpectation,
  AutomationRunTransitions,
} from "./automation-run-transitions";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const suite = crypto.randomUUID().slice(0, 8);
let customers = 0;
const nextCustomer = () =>
  DotyposCustomerIdSchema.make(
    `automation-transitions-${suite}-${++customers}`
  );

const sendStep = AutomationStepId.make("send");
const waitStep = AutomationStepId.make("wait-1");
const unit = automationWorkUnitIdSchema.make(crypto.randomUUID());
const endedAt = Temporal.Instant.from("2026-10-19T12:00:00.123456Z");

const endings: readonly {
  readonly ending: AutomationRunEnding;
  readonly reason: string | null;
  readonly detail: object;
}[] = [
  { ending: { outcome: "sent" }, reason: null, detail: {} },
  { ending: { outcome: "unconfirmed" }, reason: null, detail: {} },
  {
    ending: {
      outcome: "condition-failed",
      detail: {
        failedConditions: [0, 2],
        savedAudiences: [
          {
            audienceId: campaignAudienceIdSchema.make("audience-1"),
            filterHash: "4f2a",
          },
        ],
      },
    },
    reason: null,
    detail: {
      failedConditions: [0, 2],
      savedAudiences: [{ audienceId: "audience-1", filterHash: "4f2a" }],
    },
  },
  {
    ending: { outcome: "skipped", reason: "consent-withdrawn" },
    reason: "consent-withdrawn",
    detail: { reason: "consent-withdrawn" },
  },
  {
    ending: { outcome: "failed", reason: "evaluation-unavailable" },
    reason: "evaluation-unavailable",
    detail: { reason: "evaluation-unavailable" },
  },
  { ending: { outcome: "withdrawn" }, reason: null, detail: {} },
  { ending: { outcome: "archived" }, reason: null, detail: {} },
];

type OpenState = "active/ready" | "active/waiting" | "sending";

const expectations = {
  "active/ready": {
    status: "active",
    stepId: waitStep,
    phase: "ready",
    workUnitId: unit,
  },
  "active/waiting": {
    status: "active",
    stepId: waitStep,
    phase: "waiting",
    workUnitId: null,
  },
  sending: { status: "sending", stepId: sendStep },
} satisfies Record<OpenState, AutomationRunExpectation>;

describe.skipIf(!testDatabase)(
  "automation run transitions on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db, pool } = testDatabase;
    const campaignIds: CampaignId[] = [];

    afterAll(() => deleteAutomatedCampaigns(db, campaignIds));

    const automation = async () => {
      const campaignId = await seedAutomatedCampaign(db, {
        purpose: "marketing",
      });
      campaignIds.push(campaignId);
      const versionId = await seedAutomationVersion(db, {
        campaignId,
        purpose: "marketing",
      });
      return { campaignId, versionId };
    };

    /** Inserts a run in `state` with a `started` entry, as intake leaves it. */
    const seedRun = async (state: OpenState) => {
      const { campaignId, versionId } = await automation();
      const customer = nextCustomer();
      const sendId =
        state === "sending"
          ? await seedAutomatedSend(db, {
              campaignId,
              versionId,
              purpose: "marketing",
              recipients: [{ dotyposCustomerId: customer, status: "sent" }],
            })
          : null;
      const {
        rows: [run],
      } = await pool.query<{ id: AutomationRunId }>(
        `insert into email_campaign_automation_runs
           (campaign_id, version_id, dotypos_customer_id, trigger_kind, trigger_at,
            status, step_id, phase, step_entered_at, due_at, work_unit_id, send_id)
         values ($1, $2, $3, 'account-created', now(), $4, $5, $6, now(), $7, $8, $9)
         returning id`,
        [
          campaignId,
          versionId,
          customer,
          state === "sending" ? "sending" : "active",
          state === "sending" ? sendStep : waitStep,
          state === "sending" ? null : state.slice("active/".length),
          state === "sending" ? null : "2026-10-20T08:00:00Z",
          state === "active/ready" ? unit : null,
          sendId,
        ]
      );
      await Effect.runPromise(
        db.transaction((tx) =>
          appendAutomationRunProgress(tx, [
            {
              runId: run!.id,
              kind: "started",
              stepId: AutomationStepId.make("condition-1"),
              at: Temporal.Instant.from("2026-10-19T08:00:00Z"),
            },
          ])
        )
      );
      return run!.id;
    };

    const end = (
      runIds: readonly AutomationRunId[],
      expect: AutomationRunExpectation,
      ending: AutomationRunEnding = { outcome: "sent" }
    ) =>
      Effect.runPromise(
        db.transaction((tx) =>
          AutomationRunTransitions.end(tx, {
            ...ending,
            runIds,
            expect,
            at: endedAt,
          })
        )
      );

    const storedRun = async (runId: AutomationRunId) => {
      const { rows } = await pool.query(
        `select status, phase, due_at, outcome, outcome_reason, step_id,
                ended_at = $2::timestamptz as ended_at_recorded
         from email_campaign_automation_runs where id = $1`,
        [runId, endedAt.toString()]
      );
      return rows[0];
    };

    const timeline = async (runId: AutomationRunId) => {
      const { rows } = await pool.query(
        `select sequence, kind, step_id, at, detail
         from email_campaign_automation_run_events where run_id = $1 order by sequence`,
        [runId]
      );
      return rows;
    };

    for (const state of Object.keys(expectations) as OpenState[]) {
      for (const { ending, reason, detail } of endings) {
        test(`ends a ${state} run ${ending.outcome} with one timeline entry`, async () => {
          const runId = await seedRun(state);
          const stepId = state === "sending" ? sendStep : waitStep;

          expect(await end([runId], expectations[state], ending)).toEqual([
            runId,
          ]);

          const run = await storedRun(runId);
          expect(run).toMatchObject({
            status: "ended",
            phase: null,
            due_at: null,
            outcome: ending.outcome,
            outcome_reason: reason,
            step_id: stepId,
            ended_at_recorded: true,
          });
          const entries = await timeline(runId);
          expect(entries.map(({ sequence, kind }) => [sequence, kind])).toEqual(
            [
              [1, "started"],
              [2, ending.outcome],
            ]
          );
          expect(entries[1]).toMatchObject({ step_id: stepId, detail });
        });
      }
    }

    test("ends nothing when a run has moved on from the expectation", async () => {
      const ready = await seedRun("active/ready");
      const waiting = await seedRun("active/waiting");
      const sending = await seedRun("sending");

      const stale: [AutomationRunId, AutomationRunExpectation][] = [
        [ready, { status: "active", phase: "waiting" }],
        [ready, { status: "active", stepId: sendStep }],
        [ready, { status: "active", workUnitId: null }],
        [
          ready,
          {
            status: "active",
            workUnitId: automationWorkUnitIdSchema.make(crypto.randomUUID()),
          },
        ],
        [waiting, { status: "sending" }],
        [sending, { status: "active" }],
      ];
      for (const [runId, expectation] of stale) {
        expect(await end([runId], expectation)).toEqual([]);
      }

      for (const runId of [ready, waiting, sending]) {
        expect((await storedRun(runId)).outcome).toBeNull();
        expect(await timeline(runId)).toHaveLength(1);
      }
    });

    test("ends only the runs still in the expectation and never ends a run twice", async () => {
      const winner = await seedRun("active/waiting");
      const loser = await seedRun("active/ready");

      expect(
        await end(
          [winner, loser],
          { status: "active", phase: "waiting" },
          {
            outcome: "archived",
          }
        )
      ).toEqual([winner]);
      expect(await end([winner], { status: "active" })).toEqual([]);

      expect((await storedRun(winner)).outcome).toBe("archived");
      expect((await storedRun(loser)).status).toBe("active");
      expect(await timeline(winner)).toHaveLength(2);
      expect(await timeline(loser)).toHaveLength(1);
    });

    test("starts a run's timeline at sequence 1", async () => {
      const { campaignId, versionId } = await automation();
      const {
        rows: [run],
      } = await pool.query<{ id: AutomationRunId }>(
        `insert into email_campaign_automation_runs
           (campaign_id, version_id, dotypos_customer_id, trigger_kind, trigger_at,
            status, step_id, phase, step_entered_at, due_at)
         values ($1, $2, $3, 'account-created', now(), 'active', $4, 'ready', now(), now())
         returning id`,
        [campaignId, versionId, nextCustomer(), waitStep]
      );

      expect(await end([run!.id], { status: "active" })).toEqual([run!.id]);

      expect(
        (await timeline(run!.id)).map(({ sequence, kind }) => [sequence, kind])
      ).toEqual([[1, "sent"]]);
    });
  }
);
