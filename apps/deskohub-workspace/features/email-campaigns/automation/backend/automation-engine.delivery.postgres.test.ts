import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import type { AutomationFlowType } from "@deskohub/workspace-admin-api";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { campaignContentFixture } from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  makeAutomationEngineScenario,
  type ResendFakeResponse,
} from "./automation-engine-scenario.test-utils";
import { automationFlowFixture } from "./automation-lifecycle.test-utils";

const database = await connectWorkspacePostgresTestDatabase();

/** Tuesday 20 October 2026, 10:00 in Prague. */
const start = Temporal.Instant.from("2026-10-20T08:00:00Z");

type TriggerTag = "ReservationBooked" | "AccountCreated";

/** "When `trigger` happens, send." */
const sendFlow = (trigger: TriggerTag) =>
  automationFlowFixture({
    trigger: { _tag: trigger },
    steps: [{ _tag: "Send", id: "send" }],
  });

/** "When `trigger` happens, wait an hour, then send." */
const waitThenSendFlow = (trigger: TriggerTag) =>
  automationFlowFixture({
    trigger: { _tag: trigger },
    steps: [
      {
        _tag: "Wait",
        id: "an-hour",
        wait: { _tag: "Duration", count: 1, unit: "hour" },
      },
      { _tag: "Send", id: "send" },
    ],
  });

const emailOf = (customer: DotyposCustomerId) =>
  testEmailAddress(customer.slice(-48));

describe.skipIf(!database)(
  "the automation engine's deliveries end to end",
  async () => {
    if (!database) return;
    const { pool } = database;
    const scenario = await makeAutomationEngineScenario({
      database,
      now: start,
      deploymentEnvironment: "development",
    });
    const { fixtures, kit, read } = scenario;

    // The Resend fake lives as long as the scenario; tests read their own share.
    const seen = { requests: 0, mailed: 0, subjects: 0 };
    const requests = () => scenario.resend.requests().slice(seen.requests);
    const mailed = () => scenario.resend.mailed().slice(seen.mailed);
    const subjects = () => scenario.resend.subjects().slice(seen.subjects);

    beforeEach(async () => {
      await scenario.prepare(start);
      seen.requests = scenario.resend.requests().length;
      seen.mailed = scenario.resend.mailed().length;
      seen.subjects = scenario.resend.subjects().length;
    });
    // Nothing a test leaves active can plan work in the next one.
    afterEach(async () => {
      scenario.resend.respondWith(() => "accept");
      scenario.resend.beforeEachRequest(() => Promise.resolve());
      for (const campaignId of kit.campaignIds) {
        const automation = await read.automation(campaignId);
        if (
          automation?.status === "active" ||
          automation?.status === "paused"
        ) {
          await scenario.lifecycle(
            (lifecycle) => lifecycle.archive(campaignId),
            start.add({ hours: 168 })
          );
        }
      }
    });
    afterAll(() => scenario.cleanup());

    /** A consenting customer whose visit, two days ahead, was booked at `at`. */
    const booking = async (label: string, at: Temporal.Instant) => {
      const customer = await fixtures.addCustomer(label);
      const reservation = await fixtures.book({
        label,
        customer,
        startsAt: start.add({ hours: 48 }),
        endsAt: start.add({ hours: 50 }),
      });
      await fixtures.recordEvent({
        kind: "reservation-booked",
        customer,
        occurredAt: at,
        reservationId: reservation,
      });
      return { customer, reservation };
    };

    /** A consenting customer whose account was created at `at`. */
    const signUp = async (
      label: string,
      at: Temporal.Instant,
      options: { readonly email?: string } = {}
    ) => {
      const customer = await fixtures.addCustomer(label, options);
      await fixtures.recordEvent({
        kind: "account-created",
        customer,
        occurredAt: at,
      });
      return customer;
    };

    const outcomes = async (campaignId: CampaignId) =>
      Object.fromEntries(
        (await read.runs(campaignId)).map((run) => [
          run.dotypos_customer_id,
          [run.status, run.outcome, run.outcome_reason],
        ])
      );

    const deliverUnits = async (campaignId: CampaignId) =>
      (await read.units(campaignId)).filter((unit) => unit.kind === "deliver");

    /** Ticks until every run of `campaignId` has ended. */
    const settleRuns = (
      campaignId: CampaignId,
      from: Temporal.Instant,
      until: Temporal.Instant
    ) =>
      scenario.runUntil({
        from,
        until,
        settled: async () => {
          const runs = await read.runs(campaignId);
          return runs.length > 0 && runs.every((run) => run.status === "ended");
        },
      });

    const timelineKinds = async (campaignId: CampaignId) =>
      Promise.all(
        (await read.runs(campaignId)).map(async (run) =>
          (await read.timeline(run.id)).map((entry) => entry.kind)
        )
      );

    /**
     * Plans at `at`, then cuts the consumer of the enqueued deliver unit off
     * while its batch request is with Resend, leaving it claimed with its
     * batch persisted. The planner's other units (a sweep page) are processed.
     */
    const killDeliverDuringRequest = async (at: Temporal.Instant) => {
      const reached = scenario.resend.nextRequest();
      await scenario.plan(at);
      const { rows } = await pool.query<{ id: AutomationWorkUnitId }>(
        "select id from email_campaign_automation_work_units where kind = 'deliver' and status = 'enqueued'"
      );
      expect(rows).toHaveLength(1);
      const unitId = rows[0]!.id;
      const consumer = scenario.start(unitId, at);
      await reached;
      await consumer.interrupt();
      // Its message was consumed; the rest of the queue runs as usual.
      const rest = scenario.queue.pending().filter((m) => m.unitId !== unitId);
      scenario.queue.dropPending();
      for (const message of rest) scenario.queue.redeliver(message);
      await scenario.drain(at);
      return unitId;
    };

    describe("pre-submit check", () => {
      test.each([
        ["while waiting", false],
        ["while waiting through a pause and resume", true],
      ])(
        "a visit cancelled in Dotypos %s ends withdrawn at the deliver unit, with no email",
        async (_label, paused) => {
          const { campaignId } = await kit.seedActive(
            waitThenSendFlow("ReservationBooked"),
            { at: start }
          );
          const { reservation } = await booking(
            paused ? "cancel-paused" : "cancel-waiting",
            start.add({ minutes: 1 })
          );
          await scenario.tick(start.add({ minutes: 1 }));
          await scenario.tick(start.add({ minutes: 2 }));
          expect(await read.runs(campaignId)).toEqual([
            expect.objectContaining({ status: "active", phase: "waiting" }),
          ]);

          if (paused) {
            await scenario.lifecycle(
              (lifecycle) => lifecycle.pause(campaignId),
              start.add({ minutes: 10 })
            );
          }
          fixtures.cancelVisit(reservation);
          if (paused) {
            // The wait is overshot during the pause and proceeds on resume.
            await scenario.tick(start.add({ hours: 1, minutes: 30 }));
            expect(await read.runs(campaignId)).toEqual([
              expect.objectContaining({ status: "active", phase: "waiting" }),
            ]);
            await scenario.lifecycle(
              (lifecycle) => lifecycle.resume(campaignId),
              start.add({ hours: 2 })
            );
          }
          const progress = await settleRuns(
            campaignId,
            start.add({ hours: paused ? 2 : 1, minutes: 2 }),
            start.add({ hours: 4 })
          );

          expect(progress.settled).toBe(true);
          const [run] = await read.runs(campaignId);
          expect(run).toMatchObject({
            status: "ended",
            outcome: "withdrawn",
            send_id: null,
          });
          expect(await timelineKinds(campaignId)).toEqual([
            ["started", "waiting", "woke", "withdrawn"],
          ]);
          // The withdrawal was the deliver unit's verification.
          expect(await deliverUnits(campaignId)).toEqual([
            expect.objectContaining({ status: "done", send_id: null }),
          ]);
          expect(await read.sends(campaignId)).toEqual([]);
          expect(requests()).toEqual([]);
        }
      );

      test("a deliver unit killed after persisting replays its batch once without re-verifying", async () => {
        const { campaignId } = await kit.seedActive(
          sendFlow("ReservationBooked"),
          { at: start }
        );
        const { customer, reservation } = await booking(
          "killed-replay",
          start.add({ minutes: 1 })
        );
        await scenario.tick(start.add({ minutes: 1 }));

        scenario.resend.respondWith(() => "accept-hang");
        await killDeliverDuringRequest(start.add({ minutes: 2 }));
        scenario.resend.respondWith(() => "accept");
        const [killed] = await deliverUnits(campaignId);
        expect(killed).toMatchObject({ status: "claimed" });
        expect(killed.send_id).not.toBeNull();
        const verified = scenario.dotypos.calls.listReservationsPage;

        // Cancelled after the verification: the persisted batch goes out anyway.
        fixtures.cancelVisit(reservation);
        await scenario.tick(start.add({ minutes: 8 }));

        expect(await outcomes(campaignId)).toEqual({
          [customer]: ["ended", "sent", null],
        });
        expect(requests()).toEqual([
          {
            key: `email-campaign:${killed.send_id}:attempt-1:batch-0`,
            to: [emailOf(customer)],
          },
          {
            key: `email-campaign:${killed.send_id}:attempt-1:batch-0`,
            to: [emailOf(customer)],
          },
        ]);
        expect(mailed()).toEqual([emailOf(customer)]);
        expect(scenario.dotypos.calls.listReservationsPage).toBe(verified);
        expect(await deliverUnits(campaignId)).toEqual([
          expect.objectContaining({ id: killed.id, status: "done" }),
        ]);
      });
    });

    describe("persisted delivery", () => {
      test.each<
        readonly [
          string,
          ResendFakeResponse,
          "none" | "pause" | "archive" | "lost-message",
        ]
      >([
        ["crashed before submitting", "hang", "none"],
        ["crashed after Resend accepted", "accept-hang", "none"],
        ["crashed after Resend accepted, then paused", "accept-hang", "pause"],
        ["crashed before submitting, then archived", "hang", "archive"],
        [
          "crashed after Resend accepted, whose requeued message was lost",
          "accept-hang",
          "lost-message",
        ],
      ])(
        "a deliver unit %s is reaped, replays batch 0 under its key, sends one email per recipient, ends its runs sent and only then frees its slot",
        async (_label, crash, then) => {
          const label = `persisted-${crash}-${then}`;
          const persisted = await kit.seedActive(
            sendFlow("ReservationBooked"),
            { at: start }
          );
          const first = await booking(`${label}-1`, start.add({ minutes: 1 }));
          const second = await booking(`${label}-2`, start.add({ minutes: 1 }));
          await scenario.tick(start.add({ minutes: 1 }));

          scenario.resend.respondWith(() => crash);
          await killDeliverDuringRequest(start.add({ minutes: 2 }));
          scenario.resend.respondWith(() => "accept");
          const [killed] = await deliverUnits(persisted.campaignId);
          expect(killed).toMatchObject({ status: "claimed" });
          expect(killed.send_id).not.toBeNull();
          const verified = scenario.dotypos.calls.listReservationsPage;

          if (then === "pause") {
            await scenario.lifecycle(
              (lifecycle) => lifecycle.pause(persisted.campaignId),
              start.add({ minutes: 3 })
            );
          }
          if (then === "archive") {
            await scenario.lifecycle(
              (lifecycle) => lifecycle.archive(persisted.campaignId),
              start.add({ minutes: 3 })
            );
          }
          // Lifecycle operations never mark a unit with a persisted batch.
          expect(await deliverUnits(persisted.campaignId)).toEqual([
            expect.objectContaining({
              status: "claimed",
              cancel_requested_at: null,
            }),
          ]);

          // Another automation's run reaches its send step meanwhile; its
          // deliver unit waits for the slot the killed unit holds.
          const waiting = await kit.seedActive(sendFlow("AccountCreated"), {
            at: start.add({ minutes: 3 }),
          });
          const other = await signUp(`${label}-o`, start.add({ minutes: 3 }));
          await scenario.tick(start.add({ minutes: 3 }));
          await scenario.tick(start.add({ minutes: 4 }));
          expect(await deliverUnits(waiting.campaignId)).toEqual([
            expect.objectContaining({ status: "planned" }),
          ]);
          expect(await outcomes(waiting.campaignId)).toEqual({
            [other]: ["active", null, null],
          });
          expect(requests()).toHaveLength(1);

          // The claim expires (330 s); the reaper requeues the unit whatever
          // the automation's status.
          if (then === "lost-message") {
            await scenario.plan(start.add({ minutes: 8 }));
            scenario.queue.dropPending();
            expect(requests()).toHaveLength(1);
            expect(await deliverUnits(waiting.campaignId)).toEqual([
              expect.objectContaining({ status: "planned" }),
            ]);
            await scenario.tick(start.add({ minutes: 19 }));
          } else {
            await scenario.tick(start.add({ minutes: 8 }));
          }

          expect(await outcomes(persisted.campaignId)).toEqual({
            [first.customer]: ["ended", "sent", null],
            [second.customer]: ["ended", "sent", null],
          });
          const killedKey = `email-campaign:${killed.send_id}:attempt-1:batch-0`;
          const keys = requests().map(({ key }) => key);
          expect(keys.filter((key) => key === killedKey)).toHaveLength(2);
          // One email per recipient, whether or not Resend had accepted it.
          expect(mailed().sort()).toEqual(
            [first.customer, second.customer, other].map(emailOf).sort()
          );
          expect(scenario.dotypos.calls.listReservationsPage).toBe(verified);
          expect(await deliverUnits(persisted.campaignId)).toEqual([
            expect.objectContaining({ id: killed.id, status: "done" }),
          ]);
          // Its settlement handed the slot to the waiting unit, whose batch
          // follows the replay.
          expect(keys.at(-2)).toBe(killedKey);
          expect(requests().at(-1)!.to).toEqual([emailOf(other)]);
          expect(await outcomes(waiting.campaignId)).toEqual({
            [other]: ["ended", "sent", null],
          });
        }
      );
    });

    describe("deliver units and the deliver slot", () => {
      test("300 send-ready runs go out in three deliver units, never two in flight", async () => {
        const { campaignId } = await kit.seedActive(
          sendFlow("AccountCreated"),
          { at: start }
        );
        const customers = await Promise.all(
          Array.from({ length: 300 }, (_, index) =>
            signUp(`bulk-${index}`, start.add({ minutes: 1 }))
          )
        );
        await scenario.tick(start.add({ minutes: 1 }));
        expect(
          (await read.runs(campaignId)).filter(
            (run) => run.status === "active" && run.phase === "ready"
          )
        ).toHaveLength(300);

        const inFlight: number[] = [];
        scenario.resend.beforeEachRequest(async () => {
          const { rows } = await pool.query<{ count: number }>(
            "select count(*)::int as count from email_campaign_automation_work_units where kind = 'deliver' and status in ('enqueued', 'claimed')"
          );
          inFlight.push(rows[0]!.count);
        });
        await scenario.plan(start.add({ minutes: 2 }));
        expect(
          (await deliverUnits(campaignId)).map((unit) => unit.status).sort()
        ).toEqual(["enqueued", "planned", "planned"]);
        await scenario.drain(start.add({ minutes: 2 }));

        expect(inFlight).toEqual([1, 1, 1]);
        const units = await deliverUnits(campaignId);
        expect(units.map((unit) => unit.status)).toEqual([
          "done",
          "done",
          "done",
        ]);
        expect(
          requests()
            .map(({ to }) => to.length)
            .sort()
        ).toEqual([100, 100, 100]);
        expect(mailed().sort()).toEqual(customers.map(emailOf).sort());
        const runs = await read.runs(campaignId);
        expect(
          runs.every((run) => run.status === "ended" && run.outcome === "sent")
        ).toBe(true);
      });

      test("a non-test recipient is skipped outside-test-domain in development, ending its run skipped", async () => {
        const { campaignId } = await kit.seedActive(
          sendFlow("AccountCreated"),
          { at: start }
        );
        const insider = await signUp("d25-test", start.add({ minutes: 1 }));
        const outsider = await signUp(
          "d25-outside",
          start.add({ minutes: 1 }),
          {
            email: "automation-engine-outsider@example.com",
          }
        );

        const progress = await settleRuns(
          campaignId,
          start.add({ minutes: 1 }),
          start.add({ hours: 1 })
        );

        expect(progress.settled).toBe(true);
        expect(await outcomes(campaignId)).toEqual({
          [insider]: ["ended", "sent", null],
          [outsider]: ["ended", "skipped", "outside-test-domain"],
        });
        const recipients = await read.recipients(campaignId);
        expect(
          Object.fromEntries(
            recipients.map((recipient) => [
              recipient.dotypos_customer_id,
              [recipient.status, recipient.skip_reason],
            ])
          )
        ).toEqual({
          [insider]: ["sent", null],
          [outsider]: ["skipped", "outside-test-domain"],
        });
        expect(mailed()).toEqual([emailOf(insider)]);
      });
    });

    describe("version-pinned content", () => {
      /** The campaign's working content, with `subject` in Czech. */
      const writeContent = (campaignId: CampaignId, subject: string) => {
        const content = campaignContentFixture(subject);
        return pool.query(
          "update email_campaigns set content = $2 where id = $1",
          [
            campaignId,
            JSON.stringify({
              "cs-CZ": { ...content["cs-CZ"], subject },
            }),
          ]
        );
      };

      /** Activates the current draft through a completed dry run of it. */
      const activate = async (campaignId: CampaignId, at: Temporal.Instant) => {
        const previewId = await kit.seedPreview(campaignId, {
          status: "completed",
        });
        return scenario.lifecycle(
          (lifecycle) =>
            lifecycle.activate({ campaignId, previewId, activatedBy: null }),
          at
        );
      };

      test("a v1 run sends v1 content after v2 is activated, and a run started after v2 sends v2 content", async () => {
        const flow: AutomationFlowType = waitThenSendFlow("AccountCreated");
        const { campaignId } = await kit.seedDraft({ flow });
        await writeContent(campaignId, "Verze 1");
        const v1 = await activate(campaignId, start);
        const early = await signUp("version-early", start.add({ minutes: 1 }));
        await scenario.tick(start.add({ minutes: 1 }));
        await scenario.tick(start.add({ minutes: 2 }));

        await writeContent(campaignId, "Verze 2");
        const v2 = await activate(campaignId, start.add({ minutes: 10 }));
        expect([v1.versionNumber, v2.versionNumber]).toEqual([1, 2]);
        const late = await signUp("version-late", start.add({ minutes: 11 }));

        const progress = await settleRuns(
          campaignId,
          start.add({ minutes: 11 }),
          start.add({ hours: 3 })
        );

        expect(progress.settled).toBe(true);
        const runs = new Map(
          (await read.runs(campaignId)).map((run) => [
            run.dotypos_customer_id,
            run,
          ])
        );
        const { rows: versions } = await pool.query<{
          id: string;
          version_number: number;
        }>(
          "select id, version_number from email_campaign_automation_versions where campaign_id = $1",
          [campaignId]
        );
        const versionNumbers = new Map(
          versions.map((version) => [version.id, version.version_number])
        );
        expect(versionNumbers.get(runs.get(early).version_id)).toBe(1);
        expect(versionNumbers.get(runs.get(late).version_id)).toBe(2);
        expect([runs.get(early).outcome, runs.get(late).outcome]).toEqual([
          "sent",
          "sent",
        ]);
        expect(subjects()).toEqual([
          { to: emailOf(early), subject: "Verze 1" },
          { to: emailOf(late), subject: "Verze 2" },
        ]);
      });
    });
  }
);
