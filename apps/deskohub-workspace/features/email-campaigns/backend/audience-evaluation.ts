import type { DotyposCustomer } from "@deskohub/dotypos";
import { Match, Option } from "effect";
import {
  type AudienceCandidate,
  type AudienceCondition,
  type AudienceFacts,
  type AudienceFilter,
  type AudienceFilterOutcome,
  audienceFactKey,
  compareCount,
  countFactRequest,
  dateFactRequest,
  evaluateAudienceTree,
  matchesSet,
  viewAudienceCondition,
} from "../audience-filter";
import {
  type AudienceValueResolver,
  audienceAttributeResolvers,
} from "./audience-attribute-resolvers";
import type { AudienceEvaluationContext } from "./audience-evaluation-context";

const outcomeOf = (value: boolean): AudienceFilterOutcome =>
  value ? "match" : "noMatch";

/**
 * Fact keys by context and condition. A bulk evaluation shares one context
 * object across every candidate, so each condition's request is built once
 * rather than once per candidate.
 */
const factKeys = new WeakMap<
  AudienceEvaluationContext,
  WeakMap<AudienceCondition, string>
>();

const factKeyOf = (
  condition: AudienceCondition,
  context: AudienceEvaluationContext,
  request: () => Parameters<typeof audienceFactKey>[0]
): string => {
  let keys = factKeys.get(context);
  if (!keys) {
    keys = new WeakMap();
    factKeys.set(context, keys);
  }
  const known = keys.get(condition);
  if (known !== undefined) return known;
  const key = audienceFactKey(request());
  keys.set(condition, key);
  return key;
};

/**
 * Evaluates the filter for one candidate in its own context, which fixes the
 * periods and campaign sources its facts were resolved for. Pass
 * `Option.none()` as the profile before Dotypos hydration; conditions read
 * from the profile are then `unknown`.
 */
export const evaluateAudienceFilter = ({
  filter,
  candidate,
  context,
  facts,
  profile,
}: {
  readonly filter: AudienceFilter;
  readonly candidate: AudienceCandidate;
  readonly context: AudienceEvaluationContext;
  readonly facts: AudienceFacts;
  readonly profile: Option.Option<DotyposCustomer>;
}): AudienceFilterOutcome => {
  const id = candidate.dotyposCustomerId;
  const readValue = <Value>(
    resolver: AudienceValueResolver<Value>
  ): Option.Option<Value> =>
    Match.value(resolver).pipe(
      Match.discriminatorsExhaustive("from")({
        candidate: ({ read }) => Option.some(read(candidate)),
        profile: ({ read }) => Option.map(profile, read),
      })
    );
  const outcomeFrom = <Value>(
    value: Option.Option<Value>,
    predicate: (value: Value) => boolean
  ): AudienceFilterOutcome =>
    Option.match(value, {
      onNone: () => "unknown",
      onSome: (actual) => outcomeOf(predicate(actual)),
    });

  return evaluateAudienceTree(filter, (condition) =>
    Match.value(viewAudienceCondition(condition)).pipe(
      Match.discriminatorsExhaustive("kind")({
        // A candidate without records has no entry, so it counts zero.
        count: ({ entry, condition: count }) =>
          outcomeOf(
            compareCount(
              count.operator,
              facts.counts
                .get(
                  factKeyOf(condition, context, () =>
                    countFactRequest(entry, count, context)
                  )
                )
                ?.get(id) ?? 0,
              count.value
            )
          ),
        date: ({ condition: date }) => {
          const dates = facts.dates.get(
            factKeyOf(condition, context, () => dateFactRequest(date, context))
          );
          const hasValue = dates?.withValue.has(id) ?? false;
          const inPeriod = dates?.inPeriod.has(id) ?? false;
          return outcomeOf(
            Match.value(date.operator).pipe(
              Match.when("in", () => inPeriod),
              Match.when("notIn", () => hasValue && !inPeriod),
              Match.when("none", () => !hasValue),
              Match.exhaustive
            )
          );
        },
        set: ({ condition: set }) =>
          outcomeFrom(
            readValue<readonly string[]>(
              audienceAttributeResolvers[set.attribute]
            ),
            (values) => matchesSet(set.operator, values, set.value)
          ),
        boolean: ({ condition: boolean }) =>
          outcomeFrom(
            readValue(audienceAttributeResolvers[boolean.attribute]),
            (value) => value === boolean.value
          ),
      })
    )
  );
};
