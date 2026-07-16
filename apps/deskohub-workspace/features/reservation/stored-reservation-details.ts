import { Match, Schema } from "effect";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import {
  coworkReservationKind,
  meetingRoomReservationKind,
} from "@/features/reservation/reservation-kind";
import { makeSchemaParser } from "@/shared/utils/schema-parser";

export const workspaceProductMonitorOptionSchema = Schema.Literals(
  workspaceProductMonitorOptions
);

export const storedBasicReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  tier: Schema.Literal("basic"),
  coffee: Schema.Boolean,
});
export const storedPlusReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  tier: Schema.Literal("plus"),
  coffee: Schema.Literal(true),
});
export const storedProfiReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  tier: Schema.Literal("profi"),
  coffee: Schema.Literal(true),
  monitorOption: workspaceProductMonitorOptionSchema,
});
export const storedCoworkReservationDetailsSchema = Schema.Union([
  storedBasicReservationDetailsSchema,
  storedPlusReservationDetailsSchema,
  storedProfiReservationDetailsSchema,
]);
export const storedMeetingRoomReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(meetingRoomReservationKind),
});
export const storedWorkspaceReservationDetailsSchema = Schema.Union([
  storedCoworkReservationDetailsSchema,
  storedMeetingRoomReservationDetailsSchema,
]);

export type StoredBasicReservationDetails =
  typeof storedBasicReservationDetailsSchema.Type;
export type StoredPlusReservationDetails =
  typeof storedPlusReservationDetailsSchema.Type;
export type StoredProfiReservationDetails =
  typeof storedProfiReservationDetailsSchema.Type;
export type StoredCoworkReservationDetails =
  typeof storedCoworkReservationDetailsSchema.Type;
export type StoredMeetingRoomReservationDetails =
  typeof storedMeetingRoomReservationDetailsSchema.Type;
export type StoredWorkspaceReservationDetails =
  typeof storedWorkspaceReservationDetailsSchema.Type;

export const storedWorkspaceReservationDetailsParser = makeSchemaParser(
  storedWorkspaceReservationDetailsSchema,
  { onExcessProperty: "error" }
);

export const getStoredWorkspaceReservationDetails = (
  input: StoredWorkspaceReservationDetails
): StoredWorkspaceReservationDetails =>
  Match.value(input).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (coworkInput) =>
        Match.value(coworkInput).pipe(
          Match.when({ tier: "basic" }, (basicInput) =>
            storedBasicReservationDetailsSchema.make({
              kind: coworkReservationKind,
              tier: "basic",
              coffee: basicInput.coffee,
            })
          ),
          Match.when({ tier: "plus" }, () =>
            storedPlusReservationDetailsSchema.make({
              kind: coworkReservationKind,
              tier: "plus",
              coffee: true,
            })
          ),
          Match.when({ tier: "profi" }, (profiInput) =>
            storedProfiReservationDetailsSchema.make({
              kind: coworkReservationKind,
              tier: "profi",
              coffee: true,
              monitorOption: profiInput.monitorOption,
            })
          ),
          Match.exhaustive
        ),
      "meeting-room": () =>
        storedMeetingRoomReservationDetailsSchema.make({
          kind: meetingRoomReservationKind,
        }),
    })
  );
