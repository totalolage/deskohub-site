import { Effect, Layer } from "effect";
import type { AudienceVisitSnapshotId } from "../campaign-identifiers";
import { CampaignRecipientResolutionError } from "../errors";
import {
  type AudienceVisitSnapshotRow,
  AudienceVisitSnapshots,
} from "./audience-visit-snapshots";

/** Completed visit loads held in memory, by snapshot ID. */
export const audienceVisitSnapshotsLayer = (
  snapshots: ReadonlyMap<
    AudienceVisitSnapshotId,
    readonly AudienceVisitSnapshotRow[]
  >
) =>
  Layer.succeed(AudienceVisitSnapshots, {
    rows: (id) => {
      const rows = snapshots.get(id);
      return rows
        ? Effect.succeed(rows)
        : Effect.fail(
            CampaignRecipientResolutionError.database(
              new Error(`No completed visit snapshot ${id}.`)
            )
          );
    },
  });
