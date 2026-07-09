import { Match, Schema } from "effect";
import {
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

export const workspaceProductMonitorOptionEffectSchema = Schema.Literals(
  workspaceProductMonitorOptions
);

export const storedBasicReservationDetailsEffectSchema = Schema.Struct({
  _tag: Schema.Literal("cowork"),
  tier: Schema.Literal("basic"),
  coffee: Schema.Boolean,
});

export const storedPlusReservationDetailsEffectSchema = Schema.Struct({
  _tag: Schema.Literal("cowork"),
  tier: Schema.Literal("plus"),
  coffee: Schema.Literal(true),
});

export const storedProfiReservationDetailsEffectSchema = Schema.Struct({
  _tag: Schema.Literal("cowork"),
  tier: Schema.Literal("profi"),
  coffee: Schema.Literal(true),
  monitorOption: workspaceProductMonitorOptionEffectSchema,
});

export const storedCoworkReservationDetailsEffectSchema = Schema.Union([
  storedBasicReservationDetailsEffectSchema,
  storedPlusReservationDetailsEffectSchema,
  storedProfiReservationDetailsEffectSchema,
]);

export const storedMeetingRoomReservationDetailsEffectSchema = Schema.Struct({
  _tag: Schema.Literal("meeting-room"),
});

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

export type ReservationDetailsInput = {
  readonly entryTier: WorkspaceCoworkProductTier | "meeting-room";
  readonly coffee?: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export const storedWorkspaceReservationDetailsSchema = makeEffectSchemaParser(
  storedWorkspaceReservationDetailsEffectSchema,
  { onExcessProperty: "error" }
);

export const getStoredWorkspaceReservationDetails = (
  input: ReservationDetailsInput
): StoredWorkspaceReservationDetails =>
  Match.value(input).pipe(
    Match.when({ entryTier: "basic" }, (basicInput) => ({
      _tag: "cowork" as const,
      tier: "basic" as const,
      coffee: Boolean(basicInput.coffee),
    })),
    Match.when({ entryTier: "plus" }, () => ({
      _tag: "cowork" as const,
      tier: "plus" as const,
      coffee: true as const,
    })),
    Match.when({ entryTier: "profi" }, (profiInput) =>
      storedWorkspaceReservationDetailsSchema.parse({
        _tag: "cowork",
        tier: "profi",
        coffee: true,
        monitorOption: profiInput.monitorOption,
      })
    ),
    Match.when({ entryTier: "meeting-room" }, () => ({
      _tag: "meeting-room" as const,
    })),
    Match.exhaustive
  );
