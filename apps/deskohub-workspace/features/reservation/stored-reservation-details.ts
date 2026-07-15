import { Match, Schema } from "effect";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

export const workspaceProductMonitorOptionEffectSchema = Schema.Literals(
  workspaceProductMonitorOptions
);

export const storedBasicReservationDetailsEffectSchema = Schema.TaggedStruct(
  "cowork",
  {
    tier: Schema.Literal("basic"),
    coffee: Schema.Boolean,
  }
);
export const storedPlusReservationDetailsEffectSchema = Schema.TaggedStruct(
  "cowork",
  {
    tier: Schema.Literal("plus"),
    coffee: Schema.Literal(true),
  }
);
export const storedProfiReservationDetailsEffectSchema = Schema.TaggedStruct(
  "cowork",
  {
    tier: Schema.Literal("profi"),
    coffee: Schema.Literal(true),
    monitorOption: workspaceProductMonitorOptionEffectSchema,
  }
);
export const storedCoworkReservationDetailsEffectSchema = Schema.Union([
  storedBasicReservationDetailsEffectSchema,
  storedPlusReservationDetailsEffectSchema,
  storedProfiReservationDetailsEffectSchema,
]);
export const storedMeetingRoomReservationDetailsEffectSchema =
  Schema.TaggedStruct("meeting-room", {});
export const storedWorkspaceReservationDetailsEffectSchema = Schema.Union([
  storedCoworkReservationDetailsEffectSchema,
  storedMeetingRoomReservationDetailsEffectSchema,
]);

export type StoredBasicReservationDetails =
  typeof storedBasicReservationDetailsEffectSchema.Type;
export type StoredPlusReservationDetails =
  typeof storedPlusReservationDetailsEffectSchema.Type;
export type StoredProfiReservationDetails =
  typeof storedProfiReservationDetailsEffectSchema.Type;
export type StoredCoworkReservationDetails =
  typeof storedCoworkReservationDetailsEffectSchema.Type;
export type StoredMeetingRoomReservationDetails =
  typeof storedMeetingRoomReservationDetailsEffectSchema.Type;
export type StoredWorkspaceReservationDetails =
  typeof storedWorkspaceReservationDetailsEffectSchema.Type;

export const storedWorkspaceReservationDetailsSchema = makeEffectSchemaParser(
  storedWorkspaceReservationDetailsEffectSchema,
  { onExcessProperty: "error" }
);

export const getStoredWorkspaceReservationDetails = (
  input: StoredWorkspaceReservationDetails
): StoredWorkspaceReservationDetails =>
  Match.value(input).pipe(
    Match.tag("cowork", (coworkInput) =>
      Match.value(coworkInput).pipe(
        Match.when({ tier: "basic" }, (basicInput) =>
          storedBasicReservationDetailsEffectSchema.make({
            tier: "basic",
            coffee: basicInput.coffee,
          })
        ),
        Match.when({ tier: "plus" }, () =>
          storedPlusReservationDetailsEffectSchema.make({
            tier: "plus",
            coffee: true,
          })
        ),
        Match.when({ tier: "profi" }, (profiInput) =>
          storedProfiReservationDetailsEffectSchema.make({
            tier: "profi",
            coffee: true,
            monitorOption: profiInput.monitorOption,
          })
        ),
        Match.exhaustive
      )
    ),
    Match.tag("meeting-room", () =>
      storedMeetingRoomReservationDetailsEffectSchema.make({})
    ),
    Match.exhaustive
  );
