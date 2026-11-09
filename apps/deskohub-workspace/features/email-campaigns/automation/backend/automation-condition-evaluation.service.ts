import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import type {
  AudienceFilterOf,
  AutomationConditionFilter,
  InSavedAudience,
} from "@deskohub/workspace-admin-api";
import { Context, Data, Effect, Layer, Match, Option } from "effect";
import {
  type AudienceCondition,
  type AudienceFilterOutcome,
  audienceLeavesOf,
  audienceTopLevelClauses,
  evaluateAudienceTree,
} from "../../audience-filter";
import { audienceConditionOutcome } from "../../backend/audience-evaluation";
import {
  type AudienceEvaluationContext,
  type AudienceFactSource,
  AudienceScope,
} from "../../backend/audience-evaluation-context";
import { AudienceFactsService } from "../../backend/audience-facts.service";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import type { CampaignAudienceId } from "../../campaign-identifiers";
import { CampaignRecipientResolutionError } from "../../errors";
import { resolveRecipientLocale } from "../../recipient-locale";
import { AutomationConditionAudienceMissing } from "../errors";
import type {
  AutomationEvaluationPlan,
  SavedAudienceDefinition,
} from "./automation-evaluation-facts.service";

/**
 * A condition's outcome for one customer, with the decision detail its
 * timeline records: the top-level clauses that evaluated `noMatch`, by
 * index, and each referenced saved audience's definition as evaluated.
 */
type AutomationConditionDecision = {
  readonly outcome: AudienceFilterOutcome;
  readonly failedConditions: readonly number[];
  readonly savedAudiences: readonly {
    readonly audienceId: CampaignAudienceId;
    readonly filterHash: string;
  }[];
};

interface IAutomationConditionEvaluation {
  /**
   * Evaluates a condition step's filter for each customer at the context's
   * time, with the saved audiences the plan read and the facts the unit
   * fetched. "In saved audience" combines the audience's own outcome with
   * the same three-valued logic. A customer Workspace doesn't know is
   * `unknown`.
   */
  readonly evaluate: (input: {
    readonly condition: AutomationConditionFilter;
    readonly plan: AutomationEvaluationPlan;
    readonly customers: readonly DotyposCustomerId[];
    readonly context: AudienceEvaluationContext;
    readonly facts: AudienceFactSource;
  }) => Effect.Effect<
    ReadonlyMap<DotyposCustomerId, AutomationConditionDecision>,
    AutomationConditionAudienceMissing | CampaignRecipientResolutionError
  >;
}

export class AutomationConditionEvaluation extends Context.Service<
  AutomationConditionEvaluation,
  IAutomationConditionEvaluation
>()("@deskohub-workspace/email-campaigns/AutomationConditionEvaluation") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const candidates = yield* CampaignCandidateRepository;
      const audienceFacts = yield* AudienceFactsService;

      return {
        evaluate: ({ condition, plan, customers, context, facts }) =>
          Effect.Do.pipe(
            Effect.bind("evaluatedCondition", () =>
              withSavedAudiences(condition, plan)
            ),
            Effect.bind("candidates", () =>
              // Every customer Workspace knows: a condition isn't a consent gate.
              candidates
                .listCandidates({ purpose: "operational", ids: customers })
                .pipe(
                  Effect.mapError(CampaignRecipientResolutionError.database)
                )
            ),
            Effect.bind("audienceFacts", () =>
              audienceFacts.resolve({
                filter: plan.factFilter,
                contexts: [context],
                scope: AudienceScope.Customers({ ids: customers }),
                facts,
              })
            ),
            Effect.bind("profiles", () =>
              plan.reads.profiles
                ? audienceFacts.profiles({ customers, facts })
                : Effect.succeed(new Map<DotyposCustomerId, DotyposCustomer>())
            ),
            Effect.map(
              ({
                evaluatedCondition,
                candidates: known,
                audienceFacts: resolved,
                profiles,
              }) => {
                const candidateById = new Map(
                  known.map((facts) => [facts.dotyposCustomerId, facts])
                );
                const savedAudiences = savedAudiencesIn(evaluatedCondition);
                const decisions: ReadonlyMap<
                  DotyposCustomerId,
                  AutomationConditionDecision
                > = new Map(
                  customers.map((id) => [
                    id,
                    Option.match(
                      Option.fromUndefinedOr(candidateById.get(id)),
                      {
                        onNone: (): AutomationConditionDecision => ({
                          outcome: "unknown",
                          failedConditions: [],
                          savedAudiences,
                        }),
                        onSome: (candidate) => ({
                          ...decide(
                            evaluatedCondition,
                            audienceConditionOutcome({
                              candidate: {
                                dotyposCustomerId: id,
                                hasAccount: candidate.hasAccount,
                                locale: resolveRecipientLocale(candidate),
                              },
                              context,
                              facts: resolved,
                              profile: Option.fromUndefinedOr(profiles.get(id)),
                            })
                          ),
                          savedAudiences,
                        }),
                      }
                    ),
                  ])
                );
                return decisions;
              }
            ),
            Effect.withSpan("AutomationConditionEvaluation.evaluate")
          ),
      } satisfies IAutomationConditionEvaluation;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CampaignCandidateRepository.Live,
        AudienceFactsService.Live
      )
    )
  );
}

/**
 * The condition's outcome and failed top-level clauses for one customer,
 * from their catalogue conditions' outcomes.
 */
const decide = (
  condition: AudienceFilterOf<EvaluatedLeaf>,
  conditionOutcome: (condition: AudienceCondition) => AudienceFilterOutcome
): Pick<AutomationConditionDecision, "outcome" | "failedConditions"> => {
  const leafOutcome = (leaf: EvaluatedLeaf) =>
    Match.value(leaf).pipe(
      Match.tagsExhaustive({
        Condition: conditionOutcome,
        SavedAudienceMembership: ({ operator, definition }) =>
          membershipOutcome(
            operator,
            evaluateAudienceTree(definition.filter, conditionOutcome)
          ),
      })
    );
  return {
    outcome: evaluateAudienceTree(condition, leafOutcome),
    failedConditions: audienceTopLevelClauses(condition).flatMap(
      (clause, index) =>
        evaluateAudienceTree(clause, leafOutcome) === "noMatch" ? [index] : []
    ),
  };
};

/** "In saved audience" with the definition the plan read for it. */
class SavedAudienceMembership extends Data.TaggedClass(
  "SavedAudienceMembership"
)<{
  readonly operator: InSavedAudience["operator"];
  readonly definition: SavedAudienceDefinition;
}> {}

type EvaluatedLeaf = AudienceCondition | SavedAudienceMembership;

/**
 * The condition with each saved-audience leaf bound to the definition the
 * plan read, or the first audience the plan doesn't hold.
 */
const withSavedAudiences = (
  condition: AutomationConditionFilter,
  plan: AutomationEvaluationPlan
): Effect.Effect<
  AudienceFilterOf<EvaluatedLeaf>,
  AutomationConditionAudienceMissing
> =>
  condition._tag === "Group"
    ? Effect.forEach(condition.filters, (filter) =>
        withSavedAudiences(filter, plan)
      ).pipe(Effect.map((filters) => ({ ...condition, filters })))
    : Match.value(condition).pipe(
        Match.tagsExhaustive({
          Condition: (catalogued) => Effect.succeed(catalogued),
          InAudience: ({ audienceId, operator }) =>
            Option.match(
              Option.fromUndefinedOr(plan.savedAudiences.get(audienceId)),
              {
                onNone: () =>
                  Effect.fail(
                    new AutomationConditionAudienceMissing({ audienceId })
                  ),
                onSome: (definition) =>
                  Effect.succeed(
                    new SavedAudienceMembership({ operator, definition })
                  ),
              }
            ),
        })
      );

/** Each saved audience the condition evaluates, once, in order. */
const savedAudiencesIn = (condition: AudienceFilterOf<EvaluatedLeaf>) => [
  ...new Map(
    audienceLeavesOf(condition).flatMap((leaf) =>
      leaf._tag === "SavedAudienceMembership"
        ? [
            [
              leaf.definition.audienceId,
              {
                audienceId: leaf.definition.audienceId,
                filterHash: leaf.definition.filterHash,
              },
            ] as const,
          ]
        : []
    )
  ).values(),
];

/** "Not in" turns a decided membership around; unknown stays unknown. */
const membershipOutcome = (
  operator: InSavedAudience["operator"],
  membership: AudienceFilterOutcome
): AudienceFilterOutcome =>
  Match.value(operator).pipe(
    Match.when("in", () => membership),
    Match.when("notIn", () =>
      Match.value(membership).pipe(
        Match.when("match", (): AudienceFilterOutcome => "noMatch"),
        Match.when("noMatch", (): AudienceFilterOutcome => "match"),
        Match.when("unknown", (): AudienceFilterOutcome => "unknown"),
        Match.exhaustive
      )
    ),
    Match.exhaustive
  );
