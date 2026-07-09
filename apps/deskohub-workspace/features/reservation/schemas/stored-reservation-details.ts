import { Match, Schema } from "effect";
import {
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
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

export type ReservationDetailsInput =
  | StoredWorkspaceReservationDetails
  | {
      readonly _tag: "cowork";
      readonly tier: "basic";
      readonly coffee: boolean;
    }
  | {
      readonly _tag: "cowork";
      readonly tier: "plus";
      readonly coffee: true;
    }
  | {
      readonly _tag: "cowork";
      readonly tier: "profi";
      readonly coffee: true;
      readonly monitorOption: WorkspaceProductMonitorOption;
    }
  | {
      readonly _tag: "meeting-room";
    };

export const storedWorkspaceReservationDetailsSchema = makeEffectSchemaParser(
  storedWorkspaceReservationDetailsEffectSchema,
  { onExcessProperty: "error" }
);

export const getStoredWorkspaceReservationDetails = (
  input: ReservationDetailsInput
): StoredWorkspaceReservationDetails =>
  Match.value(input).pipe(
    Match.when({ _tag: "cowork", tier: "basic" }, (basicInput) => ({
      _tag: "cowork" as const,
      tier: "basic" as const,
      coffee: basicInput.coffee,
    })),
    Match.when({ _tag: "cowork", tier: "plus" }, () => ({
      _tag: "cowork" as const,
      tier: "plus" as const,
      coffee: true as const,
    })),
    Match.when({ _tag: "cowork", tier: "profi" }, (profiInput) => ({
      _tag: "cowork" as const,
      tier: "profi" as const,
      coffee: true as const,
      monitorOption: profiInput.monitorOption,
    })),
    Match.when({ _tag: "meeting-room" }, () => ({
      _tag: "meeting-room" as const,
    })),
    Match.exhaustive
  );
