import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { Context, type Effect } from "effect";
import type { AudienceVisitSnapshotId } from "../campaign-identifiers";
import type { CampaignRecipientResolutionError } from "../errors";

/** One Dotypos reservation, any status, as a visit load stored it. */
export type AudienceVisitSnapshotRow = {
  readonly dotyposReservationId: DotyposReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly cancelled: boolean;
};

export interface IAudienceVisitSnapshots {
  /**
   * The visits of a completed load: every reservation of its customers (or
   * of everyone) starting in its range. A load that doesn't exist or hasn't
   * completed fails, so an evaluation never reads a partial visit set.
   */
  readonly rows: (
    id: AudienceVisitSnapshotId
  ) => Effect.Effect<
    readonly AudienceVisitSnapshotRow[],
    CampaignRecipientResolutionError
  >;
}

/**
 * Reads stored visit loads for `VisitSource.Snapshot` evaluations. Only
 * evaluations that ask for a snapshot need it, so one-off sends and previews
 * resolve without it.
 */
export class AudienceVisitSnapshots extends Context.Service<
  AudienceVisitSnapshots,
  IAudienceVisitSnapshots
>()("@deskohub-workspace/email-campaigns/AudienceVisitSnapshots") {}
