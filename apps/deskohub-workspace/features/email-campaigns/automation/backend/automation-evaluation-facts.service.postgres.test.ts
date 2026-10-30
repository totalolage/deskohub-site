import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReadFailure,
  type DotyposReservation,
  DotyposUnavailable,
  dotyposIdReadBatchSize,
} from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededCustomerReads,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import type { AutomationConditionFilter } from "@deskohub/workspace-admin-api";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { emailCampaignAudiences } from "@/db/schema";
import type {
  AudienceCondition,
  AudienceFilter,
} from "@/features/email-campaigns/audience-filter";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  AudienceFactSource,
  audienceEvaluationAt,
} from "../../backend/audience-evaluation-context";
import type { AutomationConditionAudienceMissing } from "../errors";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const now = Temporal.Instant.from("2026-10-19T10:00:00Z");
const runId = crypto.randomUUID();

const customerId = (label: string) =>
  DotyposCustomerIdSchema.make(`automation-facts-${runId}-${label}`);

const customer = (id: DotyposCustomerId, tags: readonly string[] = []) =>
  ({
    id,
    _cloudId: "automation-facts-cloud",
    firstName: "Test",
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    tags,
  }) as DotyposCustomer;

type SeedReservation = {
  readonly label: string;
  readonly customer: DotyposCustomerId;
  readonly startsAt?: Temporal.Instant;
  readonly state?: "booked" | "unconfirmed";
};

const insertReservations = async (
  db: NonNullable<typeof testDatabase>["db"],
  insertedIds: string[],
  reservations: readonly SeedReservation[]
) => {
  const confirmedAt = Temporal.Instant.from("2026-10-01T10:00:00Z");
  const rows = await Effect.runPromise(
    workspaceFixtures(db).reservations(
      reservations.map(({ customer, state }) => ({
        stage:
          state === "unconfirmed"
            ? { reservation: "held", payment: "pending" }
            : {
                reservation: "confirmed",
                payment: "paid",
                fulfillment: "fulfilled",
              },
        customer,
        at: confirmedAt,
        locale: "cs-CZ",
        overrides: { createdAt: confirmedAt },
      }))
    )
  );
  return rows.map((row, index) => {
    insertedIds.push(row.id);
    const start = reservations[index]!.startsAt ?? now.subtract({ hours: 240 });
    return {
      id: row.dotyposReservationId!,
      _branchId: "automation-facts-branch",
      _cloudId: "automation-facts-cloud",
      _customerId: row.dotyposCustomerId,
      startDate: start.toString(),
      endDate: start.add({ hours: 2 }).toString(),
      seats: "1",
      status: "CONFIRMED",
    } satisfies DotyposReservation;
  });
};

const tagged = (...value: string[]) =>
  ({
    attribute: "dotyposTags",
    _tag: "Condition",
    operator: "anyOf",
    value,
  }) as const satisfies AudienceCondition;

const lastVisit = (
  value: Extract<AudienceCondition, { attribute: "lastVisit" }>["value"]
) =>
  ({
    attribute: "lastVisit",
    _tag: "Condition",
    operator: "in",
    value,
  }) as const satisfies AudienceCondition;

const makeDotypos = (input: {
  readonly customers?: readonly DotyposCustomer[];
  readonly reservations?: readonly DotyposReservation[];
  readonly customerPageError?: DotyposReadFailure;
}) => {
  const customers = input.customers ?? [];
  const customerReads = seededCustomerReads(customers);
  const reservationReads = seededReservationReads(input.reservations ?? []);
  const calls = {
    getCustomersByIds: 0,
    getReservationsByIds: 0,
    listReservationsPage: 0,
    listReservations: 0,
    listActiveReservationsPage: 0,
  };
  return {
    calls,
    layer: DotyposServiceMock({
      getCustomersByIds: (ids) => {
        calls.getCustomersByIds += 1;
        return input.customerPageError
          ? Effect.fail(input.customerPageError)
          : customerReads.getCustomersByIds(ids);
      },

      listReservationsPage: (options) => {
        calls.listReservationsPage += 1;
        return reservationReads.listReservationsPage(options);
      },
      listReservations: (options) => {
        calls.listReservations += 1;
        return reservationReads.listReservations(options);
      },
      getReservationsByIds: (ids, readOptions) => {
        const options = { ...readOptions, ids: [...ids] };
        calls.getReservationsByIds += 1;
        return reservationReads
          .listReservations(options)
          .pipe(
            Effect.flatMap((records) =>
              seededReservationReads(records).getReservationsByIds(ids)
            )
          );
      },
      listActiveReservationsPage: (interval, page) => {
        calls.listActiveReservationsPage += 1;
        return reservationReads.listActiveReservationsPage(interval, page);
      },
    }),
  };
};

describe.skipIf(!testDatabase)(
  "AutomationEvaluationFacts on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: string[] = [];
    const audienceIds: string[] = [];
    const context = audienceEvaluationAt(now);

    const run = <A, E>(
      effect: Effect.Effect<A, E, AutomationEvaluationFacts>,
      dotypos: ReturnType<typeof DotyposServiceMock>
    ) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(
            AutomationEvaluationFacts.Default.pipe(
              Layer.provide(Layer.merge(testDatabase.layer, dotypos))
            )
          )
        )
      );

    const runExit = <A, E>(
      effect: Effect.Effect<A, E, AutomationEvaluationFacts>,
      dotypos: ReturnType<typeof DotyposServiceMock>
    ) =>
      Effect.runPromiseExit(
        effect.pipe(
          Effect.provide(
            AutomationEvaluationFacts.Default.pipe(
              Layer.provide(Layer.merge(testDatabase.layer, dotypos))
            )
          )
        )
      );

    const plan = (
      filters: Parameters<
        AutomationEvaluationFacts["Service"]["plan"]
      >[0]["filters"],
      dotypos: ReturnType<typeof DotyposServiceMock>
    ) =>
      run(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.plan({ filters, context })
        ),
        dotypos
      );

    const insertAudience = async (filter: AudienceFilter) => {
      const [audience] = await Effect.runPromise(
        testDatabase.db
          .insert(emailCampaignAudiences)
          .values({ title: `Automation facts ${runId}`, filter })
          .returning({ id: emailCampaignAudiences.id })
      );
      audienceIds.push(audience!.id);
      return audience!.id;
    };

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where id = any($1)",
        [audienceIds]
      );
    });

    test("plans the merged fact reads from local, Dotypos, visit, and saved-audience filters", async () => {
      const audienceId = await insertAudience(
        lastVisit({
          _tag: "Last",
          count: 1,
          unit: "year",
        })
      );
      const dotypos = makeDotypos({});
      const local: AutomationConditionFilter = {
        _tag: "Group",
        operator: "and",
        filters: [
          {
            attribute: "locale",
            _tag: "Condition",
            operator: "anyOf",
            value: ["en-US"],
          },
          {
            attribute: "hasAccount",
            _tag: "Condition",
            operator: "is",
            value: true,
          },
        ],
      };

      expect((await plan({ condition: local }, dotypos.layer)).reads).toEqual({
        visits: false,
        profiles: false,
      });
      expect(
        (await plan({ condition: tagged("VIP") }, dotypos.layer)).reads
      ).toEqual({ visits: false, profiles: true });
      expect(
        (
          await plan(
            { condition: lastVisit({ _tag: "Last", count: 1, unit: "year" }) },
            dotypos.layer
          )
        ).reads
      ).toEqual({ visits: true, profiles: false });
      expect(
        (await plan({ condition: local, reachability: true }, dotypos.layer))
          .reads
      ).toEqual({ visits: false, profiles: true });

      const savedCondition: AutomationConditionFilter = {
        _tag: "InAudience",
        audienceId,
        operator: "in",
      };
      const savedPlan = await plan(
        { condition: savedCondition },
        dotypos.layer
      );
      expect(savedPlan.reads).toEqual({ visits: true, profiles: false });
      expect(savedPlan.factFilter).toMatchObject({
        _tag: "Group",
        filters: [
          {
            attribute: "lastVisit",
            _tag: "Condition",
          },
        ],
      });

      const missingAudienceId =
        `automation-facts-missing-${runId}` as typeof audienceId;
      const missingCondition: AutomationConditionFilter = {
        _tag: "InAudience",
        audienceId: missingAudienceId,
        operator: "in",
      };
      const exit = await runExit(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.plan({ filters: { condition: missingCondition }, context })
        ),
        dotypos.layer
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "AutomationConditionAudienceMissing",
          audienceId: missingAudienceId,
        } satisfies Partial<AutomationConditionAudienceMissing>);
      }
    });

    test("costs profile and visit reads by booked reservations", async () => {
      const customers = [customerId("cost-a"), customerId("cost-b")];
      const reservations = Array.from({ length: 120 }, (_, index) => ({
        label: `cost-${index}`,
        customer: customers[index % customers.length]!,
      }));
      await insertReservations(testDatabase.db, reservationIds, reservations);
      const dotypos = makeDotypos({});

      const withVisits = await run(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.cost({ reads: { profiles: true, visits: true }, customers })
        ),
        dotypos.layer
      );
      const profilesOnly = await run(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.cost({ reads: { profiles: true, visits: false }, customers })
        ),
        dotypos.layer
      );

      expect(withVisits).toBe(3);
      expect(profilesOnly).toBe(1);
    });

    test("packs ordered customers by cost and the 100-customer limit", async () => {
      const [a, b, c, d, unconfirmed] = ["a", "b", "c", "d", "unconfirmed"].map(
        (label) => customerId(`pack-${label}`)
      );
      const reservations = [
        ...Array.from({ length: 600 }, (_, index) => ({
          label: `pack-a-${index}`,
          customer: a!,
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          label: `pack-b-${index}`,
          customer: b!,
        })),
        ...Array.from({ length: 800 }, (_, index) => ({
          label: `pack-c-${index}`,
          customer: c!,
        })),
        ...Array.from({ length: 2 }, (_, index) => ({
          label: `pack-d-${index}`,
          customer: d!,
        })),
        ...Array.from({ length: 60 }, (_, index) => ({
          label: `pack-unconfirmed-${index}`,
          customer: unconfirmed!,
          state: "unconfirmed" as const,
        })),
      ];
      await insertReservations(testDatabase.db, reservationIds, reservations);
      const dotypos = makeDotypos({});
      const reads = { profiles: true, visits: true } as const;
      const chunks = await run(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.pack({ reads, customers: [a!, b!, c!, d!] })
        ),
        dotypos.layer
      );

      expect(chunks).toEqual([
        { customers: [a!, b!], requestCost: 8 },
        { customers: [c!], requestCost: 9 },
        { customers: [d!], requestCost: 2 },
      ]);
      expect(
        chunks.every(
          ({ customers: unit, requestCost }) =>
            unit.length <= 100 &&
            (requestCost <= 8 || (unit.length === 1 && requestCost === 9))
        )
      ).toBe(true);
      expect(chunks[1]).toEqual({ customers: [c!], requestCost: 9 });

      const noConfirmedBookings = await run(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.pack({ reads, customers: [unconfirmed!] })
        ),
        dotypos.layer
      );
      expect(noConfirmedBookings).toEqual([
        { customers: [unconfirmed!], requestCost: 1 },
      ]);

      const profileOnlyCustomers = Array.from({ length: 120 }, (_, index) =>
        customerId(`profile-only-${index}`)
      );
      const profileOnly = await run(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.pack({
            reads: { profiles: true, visits: false },
            customers: profileOnlyCustomers,
          })
        ),
        dotypos.layer
      );
      expect(
        profileOnly.map(({ customers: unit, requestCost }) => [
          unit.length,
          requestCost,
        ])
      ).toEqual([
        [100, 1],
        [20, 1],
      ]);
      expect(profileOnly.flatMap(({ customers: unit }) => unit)).toEqual(
        profileOnlyCustomers
      );
      expect(
        profileOnly.every(
          ({ customers: unit }) => unit.length <= dotyposIdReadBatchSize
        )
      ).toBe(true);
    });

    test("fetches profiles and visits through their ID operations", async () => {
      const customers = ["one", "two", "three"].map((label) =>
        customerId(`fetch-${label}`)
      );
      const reservations = Array.from({ length: 51 }, (_, index) => ({
        label: `fetch-${index}`,
        customer: customers[index % customers.length]!,
      }));
      const dotyposReservations = await insertReservations(
        testDatabase.db,
        reservationIds,
        reservations
      );
      const dotypos = makeDotypos({
        customers: [customer(customers[0]!), customer(customers[1]!)],
        reservations: dotyposReservations,
      });
      const facts = await run(
        Effect.flatMap(AutomationEvaluationFacts, (service) =>
          service.fetch({
            reads: { profiles: true, visits: true },
            customers,
          })
        ),
        dotypos.layer
      );

      expect(dotypos.calls.getCustomersByIds).toBe(1);
      expect(dotypos.calls.getReservationsByIds).toBe(1);
      expect(AudienceFactSource.$is("Fetched")(facts)).toBe(true);
      if (AudienceFactSource.$is("Fetched")(facts)) {
        expect(Option.getOrThrow(facts.profiles).has(customers[0]!)).toBe(true);
        expect(Option.getOrThrow(facts.profiles).has(customers[1]!)).toBe(true);
        expect(Option.getOrThrow(facts.profiles).has(customers[2]!)).toBe(
          false
        );
        expect([...Option.getOrThrow(facts.visits).keys()]).toEqual(customers);
      }
    });

    test("does not call Dotypos when neither fact source is needed", async () => {
      const dotypos = makeDotypos({});
      const facts = await run(
        Effect.flatMap(AutomationEvaluationFacts, (service) =>
          service.fetch({
            reads: { profiles: false, visits: false },
            customers: [customerId("no-reads")],
          })
        ),
        dotypos.layer
      );

      expect(dotypos.calls).toEqual({
        getCustomersByIds: 0,
        getReservationsByIds: 0,
        listReservationsPage: 0,
        listReservations: 0,
        listActiveReservationsPage: 0,
      });
      expect(AudienceFactSource.$is("Fetched")(facts)).toBe(true);
      if (AudienceFactSource.$is("Fetched")(facts)) {
        expect(Option.isNone(facts.profiles)).toBe(true);
        expect(Option.isNone(facts.visits)).toBe(true);
      }
    });

    test("maps a Dotypos 429 to one failed fetch attempt", async () => {
      const dotypos = makeDotypos({
        customerPageError: new DotyposUnavailable({
          operation: "getCustomersByIds",
          reason: "rate-limited",
          httpStatus: 429,
          message: "rate limited",
        }),
      });
      const exit = await runExit(
        Effect.flatMap(AutomationEvaluationFacts, (service) =>
          service.fetch({
            reads: { profiles: true, visits: false },
            customers: [customerId("rate-limited")],
          })
        ),
        dotypos.layer
      );

      expect(dotypos.calls.getCustomersByIds).toBe(1);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "AutomationUnitFetchFailure",
          code: "dotypos-unavailable",
        });
      }
    });
  }
);
