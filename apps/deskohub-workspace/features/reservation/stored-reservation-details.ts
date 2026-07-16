import { Match, Schema } from "effect";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import { makeSchemaParser } from "@/shared/utils/schema-parser";

export const workspaceProductMonitorOptionSchema = Schema.Literals(
  workspaceProductMonitorOptions
);

export const storedBasicReservationDetailsSchema = Schema.TaggedStruct(
  "cowork",
  {
    tier: Schema.Literal("basic"),
    coffee: Schema.Boolean,
  }
);
export const storedPlusReservationDetailsSchema = Schema.TaggedStruct(
  "cowork",
  {
    tier: Schema.Literal("plus"),
    coffee: Schema.Literal(true),
  }
);
export const storedProfiReservationDetailsSchema = Schema.TaggedStruct(
  "cowork",
  {
    tier: Schema.Literal("profi"),
    coffee: Schema.Literal(true),
    monitorOption: workspaceProductMonitorOptionSchema,
  }
);
export const storedCoworkReservationDetailsSchema = Schema.Union([
  storedBasicReservationDetailsSchema,
  storedPlusReservationDetailsSchema,
  storedProfiReservationDetailsSchema,
]);
export const storedMeetingRoomReservationDetailsSchema = Schema.TaggedStruct(
  "meeting-room",
  {}
);
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
    Match.tag("cowork", (coworkInput) =>
      Match.value(coworkInput).pipe(
        Match.when({ tier: "basic" }, (basicInput) =>
          storedBasicReservationDetailsSchema.make({
            tier: "basic",
            coffee: basicInput.coffee,
          })
        ),
        Match.when({ tier: "plus" }, () =>
          storedPlusReservationDetailsSchema.make({
            tier: "plus",
            coffee: true,
          })
        ),
        Match.when({ tier: "profi" }, (profiInput) =>
          storedProfiReservationDetailsSchema.make({
            tier: "profi",
            coffee: true,
            monitorOption: profiInput.monitorOption,
          })
        ),
        Match.exhaustive
      )
    ),
    Match.tag("meeting-room", () =>
      storedMeetingRoomReservationDetailsSchema.make({})
    ),
    Match.exhaustive
  );
