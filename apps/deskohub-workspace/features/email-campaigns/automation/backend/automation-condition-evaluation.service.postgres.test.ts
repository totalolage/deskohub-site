import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposReservation,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededCustomerReads,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import type { AutomationConditionFilter } from "@deskohub/workspace-admin-api";
import { eq } from "drizzle-orm";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import {
  emailCampaignAudiences,
  emailCampaigns,
  workspaceReservations,
} from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  createWorkspacePostgresSuiteDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceCondition, AudienceFilter } from "../../audience-filter";
import {
  type AudienceEvaluationContext,
  AudienceFactSource,
  audienceEvaluationAt,
} from "../../backend/audience-evaluation-context";
import { AudienceFactsService } from "../../backend/audience-facts.service";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import type { DatePeriod } from "../../date-period";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";

/**
 * Live facts read the earliest of all reservations, so the suite runs on a
 * database of its own.
 */
const testDatabase = await createWorkspacePostgresSuiteDatabase(
  "automation_condition_evaluation"
);
afterAll(() => testDatabase?.close());
const now = Temporal.Instant.from("2026-10-19T10:00:00Z");
const runId = crypto.randomUUID();

const customerId = (label: string) =>
  DotyposCustomerIdSchema.make(`automation-condition-${runId}-${label}`);

const customer = (id: DotyposCustomerId, tags: readonly string[] = []) =>
  ({
    id,
    _cloudId: "automation-condition-cloud",
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
};

describe.skipIf(!testDatabase)(
  "AutomationConditionEvaluation on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: string[] = [];
    const audienceIds: string[] = [];
    const campaignIds: string[] = [];
    const context = audienceEvaluationAt(now);

    const insertReservations = async (
      reservations: readonly SeedReservation[]
    ) => {
      const confirmedAt = Temporal.Instant.from("2026-10-01T10:00:00Z");
      const seeded = reservations.map(
        ({ label, customer: dotyposCustomerId, startsAt }) => {
          const workspaceReservationId = workspaceReservationIdSchema.make(
            `automation-condition-workspace-${runId}-${label}`
          );
          const dotyposReservationId = DotyposReservationIdSchema.make(
            `automation-condition-reservation-${runId}-${label}`
          );
          reservationIds.push(workspaceReservationId);
          return {
            workspaceReservationId,
            dotyposReservationId,
            customerId: dotyposCustomerId,
            row: {
              id: workspaceReservationId,
              authorAccountId: fixtureReservationAuthorId,
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                workspaceReservationId
              ),
              dotyposCustomerId,
              dotyposReservationId,
              reservationState: "confirmed" as const,
              reservationConfirmedAt: confirmedAt,
              paymentState: "paid" as const,
              paidAt: confirmedAt,
              fulfillmentState: "fulfilled" as const,
              fulfilledAt: confirmedAt,
              reservationDetails: {
                kind: "cowork" as const,
                entryTier: "open-space" as const,
                coffee: false,
              },
              locale: "cs-CZ" as const,
              createdAt: confirmedAt,
            },
            visit: {
              id: dotyposReservationId,
              _branchId: "automation-condition-branch",
              _cloudId: "automation-condition-cloud",
              _customerId: dotyposCustomerId,
              startDate: (startsAt ?? now.subtract({ hours: 240 })).toString(),
              endDate: (startsAt ?? now.subtract({ hours: 240 }))
                .add({ hours: 2 })
                .toString(),
              seats: "1",
              status: "CONFIRMED",
            } satisfies DotyposReservation,
          };
        }
      );
      if (seeded.length > 0) {
        await Effect.runPromise(
          testDatabase.db
            .insert(workspaceReservations)
            .values(seeded.map(({ row }) => row))
        );
      }
      return seeded;
    };

    const makeDotypos = (input: {
      readonly customers?: readonly DotyposCustomer[];
      readonly reservations?: readonly DotyposReservation[];
    }) => {
      const customers = input.customers ?? [];
      const customerReads = seededCustomerReads(customers);
      const reservationReads = seededReservationReads(input.reservations ?? []);
      const calls = {
        getCustomersPage: 0,
        getCustomers: 0,
        listReservationsPage: 0,
        listReservations: 0,
        listActiveReservationsPage: 0,
      };
      return {
        calls,
        layer: DotyposServiceMock({
          getCustomersPage: (ids) => {
            calls.getCustomersPage += 1;
            return customerReads.getCustomersPage(ids);
          },
          getCustomers: ({ ids }) => {
            calls.getCustomers += 1;
            const selected = new Set(ids);
            return Effect.succeed(
              customers.filter(({ id }) => id !== undefined && selected.has(id))
            );
          },
          listReservationsPage: (options) => {
            calls.listReservationsPage += 1;
            return reservationReads.listReservationsPage(options);
          },
          listReservations: (options) => {
            calls.listReservations += 1;
            return reservationReads.listReservations(options);
          },
          listActiveReservationsPage: (interval, page) => {
            calls.listActiveReservationsPage += 1;
            return reservationReads.listActiveReservationsPage(interval, page);
          },
        }),
      };
    };

    const runtimeLayer = (dotypos: ReturnType<typeof DotyposServiceMock>) => {
      const candidates = CampaignCandidateRepository.Default.pipe(
        Layer.provide(testDatabase.layer)
      );
      const audienceFacts = AudienceFactsService.Default.pipe(
        Layer.provide(Layer.mergeAll(candidates, dotypos))
      );
      const conditionEvaluation = AutomationConditionEvaluation.Default.pipe(
        Layer.provide(Layer.mergeAll(candidates, audienceFacts))
      );
      const evaluationFacts = AutomationEvaluationFacts.Default.pipe(
        Layer.provide(Layer.merge(testDatabase.layer, dotypos))
      );
      return Layer.mergeAll(conditionEvaluation, evaluationFacts);
    };

    const run = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      layer: Layer.Layer<R>
    ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

    const runExit = <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      layer: Layer.Layer<R>
    ) => Effect.runPromiseExit(effect.pipe(Effect.provide(layer)));

    const group = (
      operator: "and" | "or",
      filters: readonly AutomationConditionFilter[]
    ): AutomationConditionFilter => ({ _tag: "Group", operator, filters });

    const tagged = (...value: string[]) =>
      ({
        attribute: "dotyposTags",
        _tag: "Condition",
        operator: "anyOf",
        value,
      }) as const satisfies AudienceCondition;

    const hasAccount = (value: boolean) =>
      ({
        attribute: "hasAccount",
        _tag: "Condition",
        operator: "is",
        value,
      }) as const satisfies AudienceCondition;

    const locale = (...value: ("cs-CZ" | "en-US")[]) =>
      ({
        attribute: "locale",
        _tag: "Condition",
        operator: "anyOf",
        value,
      }) as const satisfies AudienceCondition;

    const lastVisit = (value: DatePeriod) =>
      ({
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value,
      }) as const satisfies AudienceCondition;

    const inAudience = (
      audienceId: (typeof emailCampaignAudiences.$inferSelect)["id"],
      operator: "in" | "notIn"
    ): AutomationConditionFilter => ({
      _tag: "InAudience",
      audienceId,
      operator,
    });

    const insertAudience = async (title: string, filter: AudienceFilter) => {
      const [audience] = await Effect.runPromise(
        testDatabase.db
          .insert(emailCampaignAudiences)
          .values({ title: `${title} ${runId}`, filter })
          .returning({ id: emailCampaignAudiences.id })
      );
      audienceIds.push(audience!.id);
      return audience!.id;
    };

    const planAndFetchEvaluate = async (input: {
      readonly condition: AutomationConditionFilter;
      readonly customers: readonly DotyposCustomerId[];
      readonly dotypos: ReturnType<typeof makeDotypos>;
      readonly context?: AudienceEvaluationContext;
    }) => {
      const layer = runtimeLayer(input.dotypos.layer);
      const evaluationContext = input.context ?? context;
      const plan = await run(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.plan({
            filters: { condition: input.condition },
            context: evaluationContext,
          })
        ),
        layer
      );
      const facts = await run(
        Effect.flatMap(AutomationEvaluationFacts, (service) =>
          service.fetch({ reads: plan.reads, customers: input.customers })
        ),
        layer
      );
      const decisions = await run(
        Effect.flatMap(AutomationConditionEvaluation, (service) =>
          service.evaluate({
            condition: input.condition,
            plan,
            customers: input.customers,
            context: evaluationContext,
            facts,
          })
        ),
        layer
      );
      return { plan, facts, decisions, layer };
    };

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from email_campaigns where id = any($1)",
        [campaignIds]
      );
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where id = any($1)",
        [audienceIds]
      );
    });

    test("evaluates saved audience membership in both directions", async () => {
      const [member, nonmember] = [
        customerId("membership-vip"),
        customerId("membership-gold"),
      ];
      const seeded = await insertReservations([
        { label: "membership-vip", customer: member! },
        { label: "membership-gold", customer: nonmember! },
      ]);
      const audienceId = await insertAudience("VIP", tagged("VIP"));
      const dotypos = makeDotypos({
        customers: [customer(member!, ["VIP"]), customer(nonmember!, ["GOLD"])],
      });
      const ids = [member!, nonmember!];

      const inResult = await planAndFetchEvaluate({
        condition: inAudience(audienceId, "in"),
        customers: ids,
        dotypos,
      });
      const notInResult = await planAndFetchEvaluate({
        condition: inAudience(audienceId, "notIn"),
        customers: ids,
        dotypos,
      });

      expect(inResult.decisions.get(member!)?.outcome).toBe("match");
      expect(inResult.decisions.get(nonmember!)?.outcome).toBe("noMatch");
      expect(notInResult.decisions.get(member!)?.outcome).toBe("noMatch");
      expect(notInResult.decisions.get(nonmember!)?.outcome).toBe("match");
      expect(seeded).toHaveLength(2);
    });

    test("uses the current saved-audience filter and returns its current hash", async () => {
      const known = customerId("live-membership");
      await insertReservations([{ label: "live-membership", customer: known }]);
      const audienceId = await insertAudience("Editable", tagged("VIP"));
      const dotypos = makeDotypos({ customers: [customer(known, ["VIP"])] });
      const condition = inAudience(audienceId, "in");
      const first = await planAndFetchEvaluate({
        condition,
        customers: [known],
        dotypos,
      });
      await Effect.runPromise(
        testDatabase.db
          .update(emailCampaignAudiences)
          .set({ filter: tagged("GOLD") })
          .where(eq(emailCampaignAudiences.id, audienceId))
      );
      const second = await planAndFetchEvaluate({
        condition,
        customers: [known],
        dotypos,
      });

      const firstDecision = first.decisions.get(known)!;
      const secondDecision = second.decisions.get(known)!;
      expect(firstDecision.outcome).toBe("match");
      expect(secondDecision.outcome).toBe("noMatch");
      expect(firstDecision.savedAudiences[0]?.filterHash).toMatch(
        /^[a-f0-9]{64}$/
      );
      expect(secondDecision.savedAudiences[0]?.filterHash).toMatch(
        /^[a-f0-9]{64}$/
      );
      expect(secondDecision.savedAudiences[0]?.filterHash).not.toBe(
        firstDecision.savedAudiences[0]?.filterHash
      );
    });

    test("reports a missing audience during both planning and evaluation", async () => {
      const known = customerId("missing-audience");
      await insertReservations([
        { label: "missing-audience", customer: known },
      ]);
      const audienceId = await insertAudience("Deleted", tagged("VIP"));
      await Effect.runPromise(
        testDatabase.db
          .delete(emailCampaignAudiences)
          .where(eq(emailCampaignAudiences.id, audienceId))
      );
      const dotypos = makeDotypos({ customers: [customer(known, ["VIP"])] });
      const layer = runtimeLayer(dotypos.layer);
      const condition = inAudience(audienceId, "in");

      const planExit = await runExit(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.plan({ filters: { condition }, context })
        ),
        layer
      );
      expect(Exit.isFailure(planExit)).toBe(true);
      if (Exit.isFailure(planExit)) {
        expect(Cause.squash(planExit.cause)).toMatchObject({
          _tag: "AutomationConditionAudienceMissing",
          audienceId,
        });
      }

      const planWithoutAudience = await run(
        Effect.flatMap(AutomationEvaluationFacts, (facts) =>
          facts.plan({ filters: { condition: hasAccount(false) }, context })
        ),
        layer
      );
      const facts = await run(
        Effect.flatMap(AutomationEvaluationFacts, (service) =>
          service.fetch({
            reads: planWithoutAudience.reads,
            customers: [known],
          })
        ),
        layer
      );
      const evaluateExit = await runExit(
        Effect.flatMap(AutomationConditionEvaluation, (service) =>
          service.evaluate({
            condition,
            plan: planWithoutAudience,
            customers: [known],
            context,
            facts,
          })
        ),
        layer
      );
      expect(Exit.isFailure(evaluateExit)).toBe(true);
      if (Exit.isFailure(evaluateExit)) {
        expect(Cause.squash(evaluateExit.cause)).toMatchObject({
          _tag: "AutomationConditionAudienceMissing",
          audienceId,
        });
      }
    });

    test("merges direct and saved fact requests into one fetch", async () => {
      const known = customerId("merged-facts");
      const seeded = await insertReservations([
        { label: "merged-facts", customer: known },
      ]);
      const taggedAudience = await insertAudience("Tag Y", tagged("Y"));
      const visitAudience = await insertAudience(
        "Recent visit",
        lastVisit({ _tag: "Last", count: 1, unit: "year" })
      );
      const condition = group("and", [
        tagged("X"),
        inAudience(taggedAudience, "in"),
        lastVisit({ _tag: "Last", count: 1, unit: "year" }),
        inAudience(visitAudience, "in"),
      ]);
      const dotypos = makeDotypos({
        customers: [customer(known, ["X", "Y"])],
        reservations: seeded.map(({ visit }) => visit),
      });
      const result = await planAndFetchEvaluate({
        condition,
        customers: [known],
        dotypos,
      });

      expect(result.plan.reads).toEqual({ visits: true, profiles: true });
      expect(result.decisions.get(known)?.outcome).toBe("match");
      expect(dotypos.calls.getCustomersPage).toBe(1);
      expect(dotypos.calls.listReservationsPage).toBe(1);
      expect(dotypos.calls.getCustomers).toBe(0);
    });

    test("uses the trigger window for last-visit conditions", async () => {
      const [recent, old] = [
        customerId("trigger-recent"),
        customerId("trigger-old"),
      ];
      const triggerAt = Temporal.Instant.from("2026-10-10T10:00:00Z");
      const seeded = await insertReservations([
        {
          label: "trigger-recent",
          customer: recent!,
          startsAt: triggerAt.subtract({ hours: 336 }),
        },
        {
          label: "trigger-old",
          customer: old!,
          startsAt: Temporal.Instant.from("2026-08-10T10:00:00Z"),
        },
      ]);
      const triggerContext: AudienceEvaluationContext = {
        ...context,
        trigger: Option.some({
          kind: "reservation-finished",
          at: triggerAt,
          reservationId: Option.some(seeded[0]!.workspaceReservationId),
        }),
      };
      const result = await planAndFetchEvaluate({
        condition: lastVisit({
          _tag: "TriggerWindow",
          side: "before",
          count: 1,
          unit: "month",
        }),
        customers: [recent!, old!],
        context: triggerContext,
        dotypos: makeDotypos({
          reservations: seeded.map(({ visit }) => visit),
        }),
      });

      expect(result.decisions.get(recent!)?.outcome).toBe("match");
      expect(result.decisions.get(old!)?.outcome).toBe("noMatch");
    });

    test("resolves This campaign email counts against the evaluation campaign", async () => {
      const known = customerId("this-campaign");
      await insertReservations([{ label: "this-campaign", customer: known }]);
      const [campaign] = await Effect.runPromise(
        testDatabase.db
          .insert(emailCampaigns)
          .values({
            title: `No sends ${runId}`,
            purpose: "operational",
            templateKey: "workspace",
            status: "sent",
          })
          .returning({ id: emailCampaigns.id })
      );
      campaignIds.push(campaign!.id);
      const campaignContext: AudienceEvaluationContext = {
        ...context,
        campaignId: Option.some(campaign!.id),
      };
      const condition: AutomationConditionFilter = {
        attribute: "campaignEmailCount",
        _tag: "Condition",
        params: {
          purpose: "any",
          period: { _tag: "AnyTime" },
          campaign: { _tag: "This" },
        },
        operator: "eq",
        value: 0,
      };
      const dotypos = makeDotypos({});
      const result = await planAndFetchEvaluate({
        condition,
        customers: [known],
        context: campaignContext,
        dotypos,
      });

      expect(result.decisions.get(known)?.outcome).toBe("match");
      expect(dotypos.calls.getCustomersPage).toBe(0);
      expect(dotypos.calls.listReservationsPage).toBe(0);
    });

    test("reports failed top-level clauses and unknown Workspace customers", async () => {
      const known = customerId("decision-detail");
      const unknown = customerId("unknown");
      const seeded = await insertReservations([
        { label: "decision-detail", customer: known },
      ]);
      const audienceId = await insertAudience("GOLD members", tagged("GOLD"));
      const condition = group("and", [
        hasAccount(false),
        locale("en-US"),
        inAudience(audienceId, "in"),
      ]);
      const result = await planAndFetchEvaluate({
        condition,
        customers: [known, unknown],
        dotypos: makeDotypos({
          customers: [customer(known, ["VIP"])],
          reservations: seeded.map(({ visit }) => visit),
        }),
      });

      expect(result.decisions.get(known)).toMatchObject({
        outcome: "noMatch",
        failedConditions: [1, 2],
        savedAudiences: [{ audienceId }],
      });
      expect(
        result.decisions.get(known)?.savedAudiences[0]?.filterHash
      ).toMatch(/^[a-f0-9]{64}$/);
      expect(result.decisions.get(unknown)).toEqual({
        outcome: "unknown",
        failedConditions: [],
        savedAudiences: [
          {
            audienceId,
            filterHash: result.plan.savedAudiences.get(audienceId)?.filterHash,
          },
        ],
      });
    });

    test("keeps Live and Fetched decisions in parity", async () => {
      const known = customerId("live-fetched-parity");
      const seeded = await insertReservations([
        { label: "live-fetched-parity", customer: known },
      ]);
      const condition = group("and", [
        tagged("VIP"),
        lastVisit({ _tag: "Last", count: 1, unit: "year" }),
      ]);
      const dotypos = makeDotypos({
        customers: [customer(known, ["VIP"])],
        reservations: seeded.map(({ visit }) => visit),
      });
      const fetched = await planAndFetchEvaluate({
        condition,
        customers: [known],
        dotypos,
      });
      const live = await run(
        Effect.flatMap(AutomationConditionEvaluation, (service) =>
          service.evaluate({
            condition,
            plan: fetched.plan,
            customers: [known],
            context,
            facts: AudienceFactSource.Live(),
          })
        ),
        fetched.layer
      );

      expect(live).toEqual(fetched.decisions);
      expect(dotypos.calls.getCustomers).toBeGreaterThan(0);
      expect(dotypos.calls.listReservationsPage).toBe(1);
    });
  }
);
