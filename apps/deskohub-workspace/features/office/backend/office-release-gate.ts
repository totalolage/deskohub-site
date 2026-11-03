import { Data, Effect } from "effect";
import { ReleaseGate } from "@/features/feature-flags/backend/release-gate";

/** `office_page`: the office page and office reservations. */
export class OfficeReleaseGate extends ReleaseGate<OfficeReleaseGate>()(
  "@deskohub-workspace/office/OfficeReleaseGate",
  "office_page"
) {}

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
