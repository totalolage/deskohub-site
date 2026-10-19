import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Data, Option } from "effect";
import type {
  AudienceVisitSnapshotId,
  CampaignId,
} from "../campaign-identifiers";

/**
 * The event an automation evaluates a condition for: a schedule's fire or
 * the customer event that started the run. Trigger-relative periods count
 * from `at`.
 */
export type AudienceTrigger = {
  readonly at: Temporal.Instant;
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

/**
 * Where visit facts come from. `Live` queries Dotypos while resolving, as
 * one-off sends and previews do. `Snapshot` reads a completed visit load,
 * so an automation evaluates without calling Dotypos; reading one needs
 * `AudienceVisitSnapshots`.
 */
export type VisitSource = Data.TaggedEnum<{
  Live: Record<never, never>;
  Snapshot: { readonly id: AudienceVisitSnapshotId };
}>;

export const VisitSource = Data.taggedEnum<VisitSource>();

export type LiveVisits = Data.TaggedEnum.Value<VisitSource, "Live">;

/** The customers a scoped query is limited to; none for everyone. */
export const scopedCustomers = (
  scope: AudienceScope
): readonly DotyposCustomerId[] | undefined =>
  AudienceScope.$match(scope, {
    All: () => undefined,
    Customers: ({ ids }) => ids,
  });
