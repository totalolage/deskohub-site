import { Schema } from "effect";
import { workspaceCoworkCurrentTiers } from "@/features/checkout/product-catalog";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";

export const checkAvailabilityResultSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  available: Schema.Boolean.annotate({
    description:
      "Whether the whole selection looked free: every date for cowork (some requested offer on each) and office, the interval for the meeting room.",
  }),
  days: Schema.Array(
    Schema.Struct({
      date: Schema.String,
      available: Schema.Boolean,
      offers: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            tier: Schema.Literals(workspaceCoworkCurrentTiers),
            available: Schema.Boolean,
            workstation_required: Schema.Boolean,
          })
        )
      ),
    })
  ),
  meeting_room: Schema.optionalKey(
    Schema.Struct({
      duration: Schema.String,
      starts_at: Schema.String,
      ends_at: Schema.String,
    })
  ),
  office: Schema.optionalKey(
    Schema.Struct({
      seats: Schema.Int,
      max_seats: Schema.Int,
    })
  ),
  checked_at: Schema.String,
  note: Schema.String,
  reservation_url: Schema.String,
});

export type CheckAvailabilityResult = typeof checkAvailabilityResultSchema.Type;
