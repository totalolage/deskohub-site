import type {
  AudienceFilterOf,
  AutomationConditionLeaf,
  AutomationStepType as AutomationStep,
} from "@deskohub/workspace-admin-api";
import { Effect, Match, Option } from "effect";
import {
  type AudienceCondition,
  type AudienceFilterOutcome,
  audienceLeavesOf,
  mapAudienceLeaves,
  occurrenceBounds,
} from "../audience-filter";
import type { AudienceEvaluationContext } from "../backend/audience-evaluation-context";
import type { CampaignPurpose } from "../body/campaign-content";
import { isWithinDatePeriodBounds } from "../date-period";
import type { AutomationStepId } from "./automation-identifiers";
import type { AutomationPreviewOutcome } from "./automation-states";
import {
  evaluateStep,
  type StepState,
  type StepTransition,
} from "./automation-step-evaluation";
import { automationTickAtOrAfter } from "./automation-ticks";

type ConditionStep = Extract<AutomationStep, { readonly _tag: "Condition" }>;

/** Where one simulated run of a flow ends. */
export type SimulatedRunEnd = {
  /** `unavailable`: a Calendar wait with no start within the horizon. */
  readonly outcome: Extract<
    AutomationPreviewOutcome,
    "would-send" | "condition-failed" | "unavailable"
  >;
  readonly stepId: AutomationStepId;
  /** The engine tick of the send, or of the run's end. */
  readonly at: Temporal.Instant;
};

/**
 * Walks a flow's steps from `triggerAt` as live execution would, on the
 * engine's ticks and through the same `evaluateStep` the engine uses
 * (design §5.8, §8, D36). The run enters on the first tick at or after the
 * trigger; Condition steps and the send happen on the tick the run reaches
 * them, a Condition asking `evaluateCondition` for its outcome there. A wait
 * is checked on the tick it's entered, then on the first tick at or after
 * its due time, where `evaluateStep` completes it. There is no pause, so no
 * resume overshoot.
 */
export const simulateRun = <E, R>(input: {
  readonly steps: readonly AutomationStep[];
  readonly triggerAt: Temporal.Instant;
  readonly evaluateCondition: (
    step: ConditionStep,
    at: Temporal.Instant
  ) => Effect.Effect<AudienceFilterOutcome, E, R>;
}): Effect.Effect<SimulatedRunEnd, E, R> => {
  const enter = (
    steps: readonly AutomationStep[],
    at: Temporal.Instant
  ): Effect.Effect<SimulatedRunEnd, E, R> => {
    const [step, ...rest] = steps;
    // A decoded flow always ends with its send step.
    return step === undefined
      ? Effect.die(new Error("A flow ended without a send step"))
      : next(
          {
            step,
            phase: "ready",
            at,
            stepEnteredAt: at,
            dueAt: Option.none(),
            resumedAt: Option.none(),
            condition: Option.none(),
          },
          rest
        );
  };

  const next = (
    state: StepState,
    rest: readonly AutomationStep[]
  ): Effect.Effect<SimulatedRunEnd, E, R> =>
    Match.value<StepTransition>(evaluateStep(state)).pipe(
      Match.tagsExhaustive({
        EvaluateCondition: () =>
          state.step._tag === "Condition"
            ? input
                .evaluateCondition(state.step, state.at)
                .pipe(
                  Effect.flatMap((outcome) =>
                    next({ ...state, condition: Option.some(outcome) }, rest)
                  )
                )
            : Effect.die(new Error("Only a condition step evaluates one")),
        Advance: ({ at }) => enter(rest, at),
        Wait: ({ dueAt }) =>
          next(
            {
              ...state,
              phase: "waiting",
              at: automationTickAtOrAfter(dueAt),
              dueAt: Option.some(dueAt),
            },
            rest
          ),
        End: (end) =>
          Effect.succeed<SimulatedRunEnd>({
            outcome:
              end.outcome === "condition-failed"
                ? "condition-failed"
                : "unavailable",
            stepId: state.step.id,
            at: state.at,
          }),
        Send: () =>
          Effect.succeed<SimulatedRunEnd>({
            outcome: "would-send",
            stepId: state.step.id,
            at: state.at,
          }),
      })
    );

  return enter(input.steps, automationTickAtOrAfter(input.triggerAt));
};

/** What replaying one event did for its customer. */
export type ReplayedEvent =
  /** Superseded: Dotypos moved the visit later, so a later event stands for it. */
  | { readonly _tag: "Hidden" }
  /** The re-check or the pre-submit check withdrew it. */
  | {
      readonly _tag: "Withdrawn";
      readonly stepId: Option.Option<AutomationStepId>;
      /** When a run it started ended; none when it started no run. */
      readonly at: Option.Option<Temporal.Instant>;
    }
  | { readonly _tag: "NotInAudience" }
  | { readonly _tag: "Entered"; readonly end: SimulatedRunEnd };

/** A dry-run row before it is stored: a computed outcome only (D35). */
export type DryRunOutcome = {
  readonly triggerAt: Temporal.Instant;
  readonly outcome: AutomationPreviewOutcome;
  readonly stepId: AutomationStepId | null;
  readonly sendAt: Temporal.Instant | null;
  /** Evaluated past `now`, from facts as they are now. */
  readonly projected: boolean;
};

/**
 * How far a customer's replay reads reservation statuses approximately
 * (design §8.2). Events before the customer's latest undated status change
 * read them approximately; so does any event whose outcome depends on an
 * approximate one.
 */
export type ReplayApproximation = {
  /** The customer's latest undated status change; none when every read is exact. */
  readonly undatedChangeAt: Option.Option<Temporal.Instant>;
  /** The flow's entry audience or a condition counts this campaign's sends. */
  readonly countsSimulatedSends: boolean;
};

/**
 * Replays one customer's events in time order with per-customer overlays
 * only (design §8.2): an event during the customer's open simulated run is
 * `already-active` (D4), and each simulated send counts toward "this
 * campaign" from its send instant for the later events. `replay` decides
 * one event given the sends simulated before it.
 *
 * A row is approximate when the entry audience or a condition decided it
 * from statuses read before the undated change, or when an approximate row
 * could change it: an approximate row might really have entered, or not,
 * so it could hold off any event up to the latest its run can end, and
 * when the flow counts this campaign's sends, it might really have sent,
 * or not, before any later decided row.
 */
export const replayCustomerEvents = <Event, E, R>(input: {
  /** In `occurredAt` order. */
  readonly events: readonly Event[];
  readonly occurredAt: (event: Event) => Temporal.Instant;
  readonly now: Temporal.Instant;
  readonly steps: readonly AutomationStep[];
  readonly approximation: ReplayApproximation;
  readonly replay: (
    event: Event,
    simulatedSends: readonly Temporal.Instant[]
  ) => Effect.Effect<ReplayedEvent, E, R>;
}): Effect.Effect<readonly ReplayedRow<Event>[], E, R> => {
  const projected = (at: Temporal.Instant) =>
    Temporal.Instant.compare(at, input.now) > 0;
  const beforeUndatedChange = (triggerAt: Temporal.Instant) =>
    Option.exists(
      input.approximation.undatedChangeAt,
      (changedAt) => Temporal.Instant.compare(triggerAt, changedAt) < 0
    );

  const next = (
    events: readonly Event[],
    replayed: CustomerReplay<Event>
  ): Effect.Effect<readonly ReplayedRow<Event>[], E, R> => {
    const [event, ...rest] = events;
    if (event === undefined) return Effect.succeed(replayed.rows);
    const triggerAt = input.occurredAt(event);
    // The engine takes an event in before that tick's runs move, so a run
    // ending on the event's tick still holds it off.
    const intakeAt = automationTickAtOrAfter(triggerAt);
    const heldOffBy = (until: Option.Option<Temporal.Instant>) =>
      Option.exists(until, (at) => Temporal.Instant.compare(intakeAt, at) <= 0);
    const withRow = (decided: DecidedEvent) => {
      const approximate =
        heldOffBy(replayed.approximateUntil) ||
        (decided.evaluated &&
          (beforeUndatedChange(triggerAt) ||
            (input.approximation.countsSimulatedSends &&
              replayed.sendsApproximate)));
      const state: CustomerReplay<Event> = {
        ...replayed,
        ...decided.state,
        rows: [
          ...replayed.rows,
          {
            event,
            outcome: { triggerAt, ...decided.outcome },
            reservationStatusesApproximate: approximate,
          },
        ],
      };
      return { state, approximate };
    };
    // An approximate row could hold off events until its latest end.
    const widenApproximation = ({
      state,
      approximate,
    }: ReturnType<typeof withRow>) =>
      approximate
        ? latestRunEnd(input.steps, triggerAt).pipe(
            Effect.map(
              (latestEnd): CustomerReplay<Event> => ({
                ...state,
                approximateUntil: Option.some(
                  Option.match(state.approximateUntil, {
                    onNone: () => latestEnd,
                    onSome: (until) =>
                      Temporal.Instant.compare(until, latestEnd) > 0
                        ? until
                        : latestEnd,
                  })
                ),
                sendsApproximate: true,
              })
            )
          )
        : Effect.succeed(state);
    const decided: Effect.Effect<Option.Option<DecidedEvent>, E, R> = heldOffBy(
      replayed.openUntil
    )
      ? Effect.succeed(
          Option.some<DecidedEvent>({
            outcome: {
              outcome: "already-active",
              stepId: null,
              sendAt: null,
              projected: false,
            },
            evaluated: false,
            state: {},
          })
        )
      : input.replay(event, replayed.sends).pipe(
          Effect.map((outcome) =>
            Match.value(outcome).pipe(
              Match.tagsExhaustive({
                Hidden: () => Option.none<DecidedEvent>(),
                NotInAudience: () =>
                  Option.some<DecidedEvent>({
                    outcome: {
                      outcome: "not-in-audience",
                      stepId: null,
                      sendAt: null,
                      projected: false,
                    },
                    evaluated: true,
                    state: {},
                  }),
                Withdrawn: ({ stepId, at }) =>
                  Option.some<DecidedEvent>({
                    outcome: {
                      outcome: "withdrawn",
                      stepId: Option.getOrNull(stepId),
                      sendAt: null,
                      projected: Option.exists(at, projected),
                    },
                    // A run it started passed the entry audience first.
                    evaluated: Option.isSome(stepId),
                    state: {
                      openUntil: Option.orElse(at, () => replayed.openUntil),
                    },
                  }),
                Entered: ({ end }) =>
                  Option.some<DecidedEvent>({
                    outcome: {
                      outcome: end.outcome,
                      stepId: end.stepId,
                      sendAt: end.outcome === "would-send" ? end.at : null,
                      projected: projected(end.at),
                    },
                    evaluated: true,
                    state: {
                      sends:
                        end.outcome === "would-send"
                          ? [...replayed.sends, end.at]
                          : replayed.sends,
                      openUntil: Option.some(end.at),
                    },
                  }),
              })
            )
          )
        );
    return decided.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(replayed),
          onSome: (row) => widenApproximation(withRow(row)),
        })
      ),
      Effect.flatMap((state) => next(rest, state))
    );
  };

  return next(input.events, {
    rows: [],
    sends: [],
    openUntil: Option.none(),
    approximateUntil: Option.none(),
    sendsApproximate: false,
  });
};

/**
 * The latest tick a run from `triggerAt` can end on: one where every
 * condition matches. A flow is linear and a run reaches each step on the
 * same tick whatever came before, so a run that ends sooner, a condition
 * failing or a calendar never occurring, can only end earlier.
 */
const latestRunEnd = (
  steps: readonly AutomationStep[],
  triggerAt: Temporal.Instant
) =>
  simulateRun({
    steps,
    triggerAt,
    evaluateCondition: () => Effect.succeed<AudienceFilterOutcome>("match"),
  }).pipe(Effect.map(({ at }) => at));

/** One event's row before it joins the replay, with the state it leaves. */
type DecidedEvent = {
  readonly outcome: Omit<DryRunOutcome, "triggerAt">;
  /** The entry audience, and any conditions, decided it. */
  readonly evaluated: boolean;
  readonly state: Partial<Pick<CustomerReplay<unknown>, "sends" | "openUntil">>;
};

/** One replayed event with its computed outcome. */
export type ReplayedRow<Event> = {
  readonly event: Event;
  readonly outcome: DryRunOutcome;
  /** It read reservation statuses approximately, or depends on a row that did. */
  readonly reservationStatusesApproximate: boolean;
};

/** One customer's replay so far: rows, simulated sends and the open run. */
type CustomerReplay<Event> = {
  readonly rows: readonly ReplayedRow<Event>[];
  readonly sends: readonly Temporal.Instant[];
  /** The tick the customer's latest simulated run ends on (D4). */
  readonly openUntil: Option.Option<Temporal.Instant>;
  /**
   * The latest tick a run of an approximate row could end on. Until then,
   * an event might have been held off, or let in, otherwise.
   */
  readonly approximateUntil: Option.Option<Temporal.Instant>;
  /** An approximate row might have sent, or not, unlike its replay. */
  readonly sendsApproximate: boolean;
};

type CampaignEmailCount = Extract<
  AudienceCondition,
  { readonly attribute: "campaignEmailCount" }
>;

const isCampaignEmailCount = (
  leaf: AutomationConditionLeaf
): leaf is CampaignEmailCount =>
  leaf._tag === "Condition" && leaf.attribute === "campaignEmailCount";

/**
 * A filter as the replay evaluates it in its replayed `context` (design
 * §8.2), which counts only campaign emails dispatched by the evaluation
 * time. Each send simulated by then counts toward the conditions that would
 * count this campaign's email: shifting the compared value by the simulated
 * sends in the period gives the same outcome as adding them to the stored
 * count, for every count operator.
 */
export const replayedFilter = <Leaf extends AutomationConditionLeaf>(
  filter: AudienceFilterOf<Leaf>,
  input: {
    readonly context: AudienceEvaluationContext;
    readonly purpose: CampaignPurpose;
    readonly simulatedSends: readonly Temporal.Instant[];
  }
): AudienceFilterOf<Leaf> =>
  mapAudienceLeaves(filter, (leaf) =>
    isCampaignEmailCount(leaf) ? replayedEmailCount(leaf, input) : leaf
  );

const replayedEmailCount = <Condition extends CampaignEmailCount>(
  condition: Condition,
  input: {
    readonly context: AudienceEvaluationContext;
    readonly purpose: CampaignPurpose;
    readonly simulatedSends: readonly Temporal.Instant[];
  }
): Condition => {
  const bounds = occurrenceBounds(condition.params.period, input.context);
  const simulated = countsSimulatedSends(condition.params, input)
    ? input.simulatedSends.filter((at) => isWithinDatePeriodBounds(bounds, at))
        .length
    : 0;
  return { ...condition, value: condition.value - simulated };
};

/**
 * Whether a filter counts the evaluating campaign's emails, so the sends a
 * replay simulates shift it.
 */
export const countsSimulatedSendsIn = <Leaf extends AutomationConditionLeaf>(
  filter: AudienceFilterOf<Leaf>,
  input: {
    readonly context: AudienceEvaluationContext;
    readonly purpose: CampaignPurpose;
  }
) =>
  audienceLeavesOf(filter).some(
    (leaf) =>
      isCampaignEmailCount(leaf) && countsSimulatedSends(leaf.params, input)
  );

/**
 * Whether the condition counts the evaluating campaign's emails: any
 * campaign of its purpose, or this campaign itself. A simulated send is
 * the evaluating campaign's email.
 */
const countsSimulatedSends = (
  params: CampaignEmailCount["params"],
  {
    context,
    purpose,
  }: {
    readonly context: AudienceEvaluationContext;
    readonly purpose: CampaignPurpose;
  }
) =>
  params.campaign === undefined
    ? params.purpose === "any" || params.purpose === purpose
    : Match.value(params.campaign).pipe(
        Match.tagsExhaustive({
          This: () => true,
          Specific: ({ campaignId }) =>
            Option.contains(context.campaignId, campaignId),
        })
      );
