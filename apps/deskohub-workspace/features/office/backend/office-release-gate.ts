import { Data, Effect } from "effect";
import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";
import type { ReleaseGateRunPolicy } from "@/features/feature-flags/backend/release-gate-run";

/** `office_page`: the office page and office reservations. */
export class OfficeReleaseGate extends ReleaseGate<OfficeReleaseGate>()(
  "@deskohub-workspace/office/OfficeReleaseGate",
  "office_page"
) {}

// A run that fails beyond the gate's own fail-closed policy, such as a
// runtime that cannot start, rejects, so office pages and reservations error
// rather than answering not found.
export const officeReleaseRunPolicy = {
  whenRunFails: "reject",
} as const satisfies ReleaseGateRunPolicy;

class OfficeReservationsDisabledError extends Data.TaggedError(
  "OfficeReservationsDisabledError"
)<{
  readonly message: string;
}> {}

export const ensureOfficeReservationsEnabled = Effect.gen(function* () {
  if (!(yield* OfficeReleaseGate.isOpen)) {
    return yield* new OfficeReservationsDisabledError({
      message: "Office reservations are disabled.",
    });
  }
});
