import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as workspaceSchema from "@/db/schema";
import * as authSchema from "@/db/schema/auth";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceFilter } from "../../audience-filter";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationPreviewId } from "../automation-identifiers";
import { automationTickAtOrAfter } from "../automation-ticks";
import { makeAutomationDryRunner } from "./automation-dry-run.test-utils";
import {
  databaseInstant,
  makeAutomationEngineScenario,
} from "./automation-engine-scenario.test-utils";
import { automationFlowFixture } from "./automation-lifecycle.test-utils";
import {
  comeBackOfferFlow,
  lapsedRegularsFilter,
  reviewRequestFlow,
} from "./automation-stories.test-utils";

/**
 * The engine plans over whole tables, so the suite runs on a database of
 * its own.
 */
const database = await createWorkspacePostgresSuiteDatabase(
  "automation_engine_facts"
);
afterAll(() => database?.close());

/** Tuesday 13 October 2026, 08:00 in Prague. */
const start = Temporal.Instant.from("2026-10-13T06:00:00Z");
const run = crypto.randomUUID().slice(0, 8);
const prefix = `facts-${run}`;

// Drizzle-kit generates migrations from exactly these two modules, so the
// scan covers every table and column a migration can add.
const storedTables = [
  ...Object.values(workspaceSchema),
  ...Object.values(authSchema),
]
  .filter((value): value is PgTable => is(value, PgTable))
  .map(getTableConfig);

/** The only columns that may hold the time a visit event happened (§5.13). */
const eventTimeColumns = new Set([
  "customer_events.occurred_at",
  "email_campaign_automation_runs.trigger_at",
  "email_campaign_automation_preview_rows.trigger_at",
]);

/** What the test seeded in Dotypos, as the at-rest scan looks for it. */
const seeded = {
  profileValues: new Set<string>(),
  emails: new Set<string>(),
  visitTimes: [] as Temporal.Instant[],
};

const sha256Digests = (email: string) =>
  [email, email.trim().toLowerCase()].flatMap((value) =>
    (["hex", "base64", "base64url"] as const).map((encoding) =>
      createHash("sha256").update(value).digest(encoding)
    )
  );

const isoDateTime =
  /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)?/g;

/** Every instant a written date-time can stand for: UTC, or Prague wall time without an offset. */
const instantsWritten = (text: string) =>
  [...text.matchAll(isoDateTime)].flatMap(([, date, time, offset]) => {
    if (offset !== undefined) {
      const zone =
        offset === "Z"
          ? "Z"
          : offset.replace(/^([+-]\d{2}):?(\d{2})?$/, "$1:$2");
      return [
        Temporal.Instant.from(`${date}T${time}${zone.replace(/:$/, ":00")}`),
      ];
    }
    const wall = Temporal.PlainDateTime.from(`${date}T${time}`);
    return ["UTC", "Europe/Prague"].map((timeZone) =>
      wall.toZonedDateTime(timeZone).toInstant()
    );
  });

/** Epoch seconds and milliseconds written as digits. */
const epochsWritten = (text: string) =>
  [...text.matchAll(/\d{10,13}/g)].map(([digits]) =>
    digits.length === 13 ? Number(digits) : Number(digits) * 1000
  );

/**
 * What `text` (a column value as JSON text) holds that the engine must not
 * store: a seeded profile value, an email's SHA-256 or a Dotypos visit
 * time, compared to the second, since the seeded visit times fall on odd
 * seconds no planner minute does.
 */
const leaksIn = (text: string): readonly string[] => {
  const lower = text.toLowerCase();
  const visitSeconds = new Set(
    seeded.visitTimes.map((at) => Math.floor(at.epochMilliseconds / 1000))
  );
  const atVisit = (epochMilliseconds: number) =>
    visitSeconds.has(Math.floor(epochMilliseconds / 1000));
  return [
    ...[...seeded.profileValues]
      .filter((profileValue) => lower.includes(profileValue.toLowerCase()))
      .map((profileValue) => `profile value "${profileValue}"`),
    ...[...seeded.emails]
      .filter((email) =>
        sha256Digests(email).some(
          (digest) =>
            text.includes(digest) || lower.includes(digest.toLowerCase())
        )
      )
      .map((email) => `SHA-256 of ${email}`),
    ...instantsWritten(text)
      .filter((at) => atVisit(at.epochMilliseconds))
      .map((at) => `Dotypos time ${at}`),
    ...epochsWritten(text)
      .filter(atVisit)
      .map((epoch) => `Dotypos time as epoch ${epoch}`),
  ];
};

describe.skipIf(!database)("automation facts at rest (§5.13)", async () => {
  if (!database) return;
  const { pool } = database;
  const scenario = await makeAutomationEngineScenario({
    database,
    now: start,
    prefix,
  });
  const { fixtures, kit, read } = scenario;
  const dryRunner = makeAutomationDryRunner({
    database,
    dotypos: scenario.dotypos.layer,
  });
  afterAll(() => scenario.cleanup());

  const instant = (value: string) => Temporal.Instant.from(value);
  /** A visit time on an odd second, as no planner minute or derived instant falls. */
  const visitTime = (value: string) => {
    const at = instant(value).add({
      seconds: 7 + (seeded.visitTimes.length % 47),
      milliseconds: 457,
    });
    return at;
  };

  /** A customer with a full synthetic Dotypos profile and a marketing consent. */
  const customer = async (
    label: string,
    options: { readonly tags?: readonly string[] } = {}
  ) => {
    const index = seeded.emails.size;
    const profile = {
      firstName: `Křestní-${run}-${label}`,
      lastName: `Příjmení-${run}-${label}`,
      companyName: `Firma ${run} ${label}`,
      email: testEmailAddress(`mail-${run}-${label}`),
      phone: `+420 6${String(index).padStart(2, "0")} ${run.replace(/\D/g, "7").padEnd(6, "7").slice(0, 6)}`,
      city: `Město-${run}-${label}`,
      note: `Poznámka ${run} ${label}`,
      internalNote: `Interní ${run} ${label}`,
      tags: [`tag-${run}-${label}`, `tag-${run}-shared`],
      _discountGroupId: `discount-${run}-${label}`,
    };
    seeded.emails.add(profile.email);
    for (const profileValue of Object.values(profile).flat()) {
      seeded.profileValues.add(profileValue);
    }
    // Tags an audience names are the administrator's words, not the profile's.
    return fixtures.addCustomer(label, {
      email: profile.email,
      profile: {
        ...profile,
        tags: [...profile.tags, ...(options.tags ?? [])],
      } as Partial<DotyposCustomer>,
    });
  };

  /** A Workspace-booked visit; its Dotypos times join the scan. */
  const visit = (
    label: string,
    customerId: DotyposCustomerId,
    startsAt: Temporal.Instant,
    hours = 8
  ) => {
    const endsAt = startsAt.add({ hours });
    seeded.visitTimes.push(startsAt, endsAt);
    return fixtures.book({ label, customer: customerId, startsAt, endsAt });
  };

  /** Runs whose customer is `customerId`. */
  const runsOf = async (campaignId: CampaignId, customerId: string) =>
    (await read.runs(campaignId)).filter(
      (candidate) => candidate.dotypos_customer_id === customerId
    );

  const archive = (campaignId: CampaignId, at: Temporal.Instant) =>
    scenario.lifecycle((lifecycle) => lifecycle.archive(campaignId), at);

  /**
   * Every column of every table, against what the test seeded. Visit
   * times in the event-time columns are allowed and returned apart.
   */
  const scanAtRest = async () => {
    const leaks = new Set<string>();
    const eventTimes = new Set<string>();
    for (const table of storedTables) {
      // Each column the schema declares, as the JSON text Postgres renders.
      const { rows } = await pool.query<{
        readonly column: string;
        readonly value: string;
      }>(
        `select value.key as column, value.value::text as value
           from "${table.schema ?? "public"}"."${table.name}" t
          cross join lateral jsonb_each(to_jsonb(t)) value
          where value.key = any($1)`,
        [table.columns.map((column) => column.name)]
      );
      for (const { column, value } of rows) {
        const id = `${table.name}.${column}`;
        for (const leak of leaksIn(value)) {
          if (eventTimeColumns.has(id) && leak.startsWith("Dotypos time ")) {
            eventTimes.add(id);
          } else {
            leaks.add(`${id}: ${leak}`);
          }
        }
      }
    }
    return { leaks: [...leaks].toSorted(), eventTimes };
  };

  const previewStatus = async (previewId: AutomationPreviewId) =>
    (
      await pool.query<{ status: string }>(
        "select status from email_campaign_automation_previews where id = $1",
        [previewId]
      )
    ).rows[0]?.status;

  test("stories 1 and 2 run and preview over synthetic profiles and visits", async () => {
    await scenario.prepare(start);
    const story1 = await kit.seedActive(reviewRequestFlow, { at: start });
    const story2 = await kit.seedActive(comeBackOfferFlow, {
      at: start,
      audienceFilter: lapsedRegularsFilter,
    });
    const second = await customer("second");
    await visit("second-1", second, visitTime("2026-10-01T07:00:00Z"));
    await visit("second-2", second, visitTime("2026-10-13T07:00:00Z"));
    const once = await customer("once");
    await visit("once-1", once, visitTime("2026-10-13T07:00:00Z"));
    const regular = await customer("regular");
    await visit("regular-1", regular, visitTime("2026-07-10T07:00:00Z"));
    await visit("regular-2", regular, visitTime("2026-08-14T07:00:00Z"));
    const recent = await customer("recent");
    await visit("recent-1", recent, visitTime("2026-07-10T07:00:00Z"));
    await visit("recent-2", recent, visitTime("2026-10-08T07:00:00Z"));

    // The sweep records the visits' events as their times pass.
    const dryRunAt = instant("2026-10-13T15:30:00Z");
    await scenario.runUntil({
      from: start,
      until: dryRunAt,
      sameInstant: true,
    });

    // Both stories previewed at the same instant, then run to the end.
    const previews: AutomationPreviewId[] = [];
    for (const active of [story1, story2]) {
      await pool.query(
        "update email_campaign_automation_previews set status = 'superseded' where id = $1",
        [active.previewId]
      );
      previews.push(
        (await dryRunner.start(active.campaignId, dryRunAt)).previewId
      );
    }
    const previewed = await scenario.runUntil({
      from: dryRunAt,
      until: dryRunAt,
      sameInstant: true,
      settled: async () =>
        (await Promise.all(previews.map(previewStatus))).every(
          (status) => status === "completed"
        ),
    });
    expect(previewed.settled).toBe(true);
    // The planner prunes week-old dry runs, so their rows are scanned now.
    const previewScan = await scanAtRest();
    expect(previewScan.leaks).toEqual([]);
    expect(previewScan.eventTimes).toContain(
      "email_campaign_automation_preview_rows.trigger_at"
    );
    const { rows: previewRows } = await pool.query(
      "select preview_id, dotypos_customer_id, outcome from email_campaign_automation_preview_rows where preview_id = any($1) and outcome = 'would-send'",
      [previews]
    );
    expect(
      previewRows.map((row) => row.dotypos_customer_id).toSorted()
    ).toEqual([regular, second].toSorted());

    const progress = await scenario.runUntil({
      from: dryRunAt,
      until: instant("2026-10-19T09:00:00Z"),
      sameInstant: true,
      settled: async () => {
        const runs = [
          ...(await read.runs(story1.campaignId)),
          ...(await read.runs(story2.campaignId)),
        ];
        return (
          runs.some((candidate) => candidate.trigger_kind === "schedule") &&
          runs.every((candidate) => candidate.status === "ended")
        );
      },
    });
    expect(progress.settled).toBe(true);
    expect(await runsOf(story1.campaignId, second)).toMatchObject([
      { outcome: "sent" },
    ]);
    expect(await runsOf(story1.campaignId, once)).toMatchObject([
      { outcome: "condition-failed" },
    ]);
    expect(await runsOf(story2.campaignId, regular)).toMatchObject([
      { outcome: "sent" },
    ]);
    // The engine read the profiles: it mailed their addresses.
    expect(scenario.resend.mailed().toSorted()).toEqual(
      [
        testEmailAddress(`mail-${run}-second`),
        testEmailAddress(`mail-${run}-regular`),
      ].toSorted()
    );
    await archive(story1.campaignId, progress.at);
    await archive(story2.campaignId, progress.at);
  });

  test("no profile value, email hash or Dotypos time is at rest", async () => {
    // The scan recognises what it looks for.
    const [visitAt] = seeded.visitTimes;
    expect(leaksIn(JSON.stringify({ at: visitAt!.toString() }))).not.toEqual(
      []
    );
    expect(
      leaksIn(
        visitAt!
          .toZonedDateTimeISO("Europe/Prague")
          .toPlainDateTime()
          .toString()
      )
    ).not.toEqual([]);
    expect(leaksIn(JSON.stringify([visitAt!.epochMilliseconds]))).not.toEqual(
      []
    );
    const [email] = seeded.emails;
    expect(leaksIn(sha256Digests(email!)[1])).not.toEqual([]);
    expect(
      leaksIn(JSON.stringify({ tags: [`TAG-${run}-SHARED`] }))
    ).not.toEqual([]);

    const { leaks, eventTimes } = await scanAtRest();
    expect(leaks).toEqual([]);
    // Visit times are recorded only as the times events happened.
    expect([...eventTimes].toSorted()).toEqual([
      "customer_events.occurred_at",
      "email_campaign_automation_runs.trigger_at",
    ]);
  });

  test("a tag removed between two chunks is read live by each", async () => {
    // Wednesday 21 October, 10:00 in Prague.
    const fireAt = instant("2026-10-21T08:00:00Z");
    const activatedAt = fireAt.subtract({ hours: 1 });
    await scenario.prepare(activatedAt);
    const tag = `tag-${run}-chunked`;
    const taggedAudience: AudienceFilter = {
      _tag: "Group",
      operator: "and",
      filters: [
        {
          attribute: "dotyposTags",
          _tag: "Condition",
          operator: "anyOf",
          value: [tag],
        },
      ],
    };
    const { campaignId } = await kit.seedActive(
      automationFlowFixture({
        trigger: {
          _tag: "Schedule",
          calendar: { weekdays: ["wednesday"], hours: [10] },
        },
        steps: [{ _tag: "Send", id: "send" }],
      }),
      { at: activatedAt, audienceFilter: taggedAudience }
    );
    const tagged = new Set<string>();
    for (let index = 0; index < 120; index += 1) {
      const label = `chunked-${String(index).padStart(2, "0")}`;
      const id = await customer(label, { tags: [tag] });
      tagged.add(id);
      await visit(label, id, visitTime("2026-09-02T07:00:00Z"));
    }

    await scenario.plan(fireAt);
    const chunks = (await read.units(campaignId))
      .filter((unit) => unit.kind === "fire-chunk")
      .map((unit) => ({
        id: unit.id,
        tagged: (unit.subject.customerIds as string[]).filter((id) =>
          tagged.has(id)
        ),
      }))
      .filter((chunk) => chunk.tagged.length > 0);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const [first, second] = chunks as [
      (typeof chunks)[number],
      (typeof chunks)[number],
    ];
    const entered = first.tagged[0]!;
    const untagged = second.tagged[0]!;

    expect((await scenario.process(first.id, fireAt)).outcome).toBe("done");
    for (const id of [entered, untagged]) {
      const profile = scenario.dotypos.customers.get(id as DotyposCustomerId)!;
      scenario.dotypos.customers.set(id as DotyposCustomerId, {
        ...profile,
        tags: (profile.tags ?? []).filter((value) => value !== tag),
      });
    }
    const progress = await scenario.runUntil({
      from: fireAt,
      until: fireAt.add({ minutes: 30 }),
      sameInstant: true,
      settled: async () =>
        (await read.fires(campaignId)).every(
          (fire) => fire.status !== "entering"
        ),
    });
    expect(progress.settled).toBe(true);

    // The first chunk read the tag before it was removed; the second read
    // Dotypos after, and nothing either stored stood in for it.
    expect(await runsOf(campaignId, entered)).toHaveLength(1);
    expect(await runsOf(campaignId, untagged)).toEqual([]);
    expect(
      (await read.receipts(campaignId)).filter(
        (receipt) => receipt.dotypos_customer_id === untagged
      )
    ).toEqual([]);
    // Its other tagged customers still entered.
    expect(await runsOf(campaignId, second.tagged.at(-1)!)).toHaveLength(1);
    await archive(campaignId, progress.at);
  });

  test("a reschedule between two units is read live by the second", async () => {
    const from = instant("2026-10-22T06:00:00Z");
    await scenario.prepare(from);
    const { campaignId } = await kit.seedActive(reviewRequestFlow, {
      at: from,
    });
    const moved = await customer("moved");
    const earlierVisit = await visit(
      "moved-1",
      moved,
      visitTime("2026-10-08T07:00:00Z")
    );
    const triggerStart = visitTime("2026-10-22T07:00:00Z");
    const triggerVisit = await visit("moved-2", moved, triggerStart);

    // The sweep records the finished visit; the planner on the next tick
    // takes it in, and its intake unit starts the run and queues its
    // condition unit (D36).
    const recorded = await scenario.runUntil({
      from,
      until: instant("2026-10-22T16:00:00Z"),
      settled: async () =>
        (
          await pool.query(
            "select 1 from customer_events where workspace_reservation_id = $1 and kind = 'reservation-finished'",
            [triggerVisit]
          )
        ).rows.length > 0,
    });
    expect(recorded.settled).toBe(true);
    const started = { at: automationTickAtOrAfter(recorded.at) };
    await scenario.planUntilQueued(started.at, "condition");
    expect(await runsOf(campaignId, moved)).toMatchObject([
      { status: "active", step_id: "second-visit-within-a-month" },
    ]);

    // Dotypos moves the earlier visit out of the month before the trigger.
    const movedStart = visitTime("2026-09-02T07:00:00Z");
    seeded.visitTimes.push(movedStart, movedStart.add({ hours: 8 }));
    fixtures.moveVisit(earlierVisit, {
      startsAt: movedStart,
      endsAt: movedStart.add({ hours: 8 }),
    });
    const ended = await scenario.runUntil({
      from: started.at,
      until: started.at.add({ hours: 1 }),
      sameInstant: true,
      settled: async () =>
        (await runsOf(campaignId, moved)).every(
          (candidate) => candidate.status === "ended"
        ),
    });
    expect(ended.settled).toBe(true);
    const [movedRun] = await runsOf(campaignId, moved);
    expect(movedRun).toMatchObject({
      outcome: "condition-failed",
      step_id: "second-visit-within-a-month",
    });
    expect(databaseInstant(movedRun.trigger_at)?.epochMilliseconds).toBe(
      triggerStart.add({ hours: 8 }).epochMilliseconds
    );
    await archive(campaignId, ended.at);
  });

  test("a chunk retried from 10:00 to 10:20 counts a visit that started at 10:10", async () => {
    // Monday 26 October, 10:00 in Prague (winter time).
    const fireAt = instant("2026-10-26T09:00:00Z");
    const activatedAt = fireAt.subtract({ hours: 1 });
    await scenario.prepare(activatedAt);
    const { campaignId } = await kit.seedActive(comeBackOfferFlow, {
      at: activatedAt,
      audienceFilter: lapsedRegularsFilter,
    });
    /** A lapsed regular with one more visit starting at `next`. */
    const lapsed = async (label: string, next: Temporal.Instant) => {
      const id = await customer(label);
      await visit(`${label}-1`, id, visitTime("2026-07-10T07:00:00Z"));
      await visit(`${label}-2`, id, visitTime("2026-08-14T07:00:00Z"));
      await visit(`${label}-3`, id, next, 2);
      return id;
    };
    const startedAtTenTen = await lapsed(
      "ten-ten",
      visitTime("2026-10-26T09:10:00Z")
    );
    const startsAtHalfPast = await lapsed(
      "half-past",
      visitTime("2026-10-26T09:30:00Z")
    );

    await scenario.plan(fireAt);
    const restore = scenario.dotypos.fail(
      new DotyposUnavailable({
        operation: "getCustomersByIds",
        reason: "server",
        httpStatus: 503,
      })
    );
    let failed = 0;
    for (
      let next = scenario.processNext(fireAt);
      next !== undefined;
      next = scenario.processNext(fireAt)
    ) {
      expect((await next).outcome).toBe("redelivered");
      failed += 1;
    }
    restore();
    expect(failed).toBeGreaterThan(0);

    const retryAt = instant("2026-10-26T09:20:00Z");
    const retried = await scenario.drain(retryAt);
    expect(retried.length).toBeGreaterThanOrEqual(failed);
    expect(retried.every(({ outcome }) => outcome === "done")).toBe(true);
    expect(await read.fires(campaignId)).toMatchObject([{ status: "entered" }]);

    // At 10:20 the 10:10 visit counts toward "none in the last month".
    expect(await runsOf(campaignId, startedAtTenTen)).toEqual([]);
    const [entered] = await runsOf(campaignId, startsAtHalfPast);
    expect(databaseInstant(entered?.trigger_at)?.toString()).toBe(
      fireAt.toString()
    );
    await archive(campaignId, retryAt);
  });

  test("still nothing at rest after the three cases", async () => {
    const { leaks } = await scanAtRest();
    expect(leaks).toEqual([]);
  });
});
