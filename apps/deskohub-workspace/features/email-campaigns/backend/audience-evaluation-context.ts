import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import { Data, Option } from "effect";
import type { ReservationVisit } from "@/features/reservation/backend/reservation-visits.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { AutomationTriggerKind } from "../automation/automation-states";
import type { CampaignId } from "../campaign-identifiers";

/**
 * The event an automation evaluates a condition for: a schedule's fire or
 * the customer event that started the run. Trigger-relative periods count
 * from `at`.
 */
type AudienceTrigger = {
  readonly kind: AutomationTriggerKind;
  readonly at: Temporal.Instant;
  /** The triggering reservation of a reservation event. */
  readonly reservationId: Option.Option<WorkspaceReservationId>;
};

/**
 * What an audience is evaluated against. One-off sends and previews use the
 * evaluation time only; an automation adds its own campaign, which `This`
 * campaign sources name, and its trigger.
 */
export type AudienceEvaluationContext = {
  readonly now: Temporal.Instant;
  readonly campaignId: Option.Option<CampaignId>;
  readonly trigger: Option.Option<AudienceTrigger>;
  /**
   * `now` is a past moment a dry run replays, so Workspace has since
   * recorded what came after it. Live evaluations run at the present and
   * leave it unset.
   */
  readonly replayed?: boolean;
};

/** The context of a one-off evaluation at `now`: no campaign, no trigger. */
export const audienceEvaluationAt = (
  now: Temporal.Instant
): AudienceEvaluationContext => ({
  now,
  campaignId: Option.none(),
  trigger: Option.none(),
});

/**
 * Which customers an evaluation resolves facts for: everyone Workspace
 * knows, or only these customers (an automation's entry gate or run
 * condition). Facts of a scoped customer are the same either way.
 */
export type AudienceScope = Data.TaggedEnum<{
  All: Record<never, never>;
  Customers: { readonly ids: readonly DotyposCustomerId[] };
}>;

export const AudienceScope = Data.taggedEnum<AudienceScope>();

/** The customers a scoped query is limited to; none for everyone. */
export const scopedCustomers = (
  scope: AudienceScope
): readonly DotyposCustomerId[] | undefined =>
  AudienceScope.$match(scope, {
    All: () => undefined,
    Customers: ({ ids }) => ids,
  });

/**
 * Where an evaluation reads Dotypos facts. `Live` reads them as one-off sends
 * and their previews always have. `Fetched` holds what one automation unit
 * fetched for its customers: their Workspace-booked visits and their
 * profiles, each `None` when the unit's filters didn't need it. It lives in
 * memory for one invocation and is never written. A customer missing from
 * `profiles` is one Dotypos didn't return.
 */
export type AudienceFactSource = Data.TaggedEnum<{
  Live: Record<never, never>;
  Fetched: {
    readonly visits: Option.Option<
      ReadonlyMap<DotyposCustomerId, readonly ReservationVisit[]>
    >;
    readonly profiles: Option.Option<
      ReadonlyMap<DotyposCustomerId, DotyposCustomer>
    >;
  };
}>;

export const AudienceFactSource = Data.taggedEnum<AudienceFactSource>();
