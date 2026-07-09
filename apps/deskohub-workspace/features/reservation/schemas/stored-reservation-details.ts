import { Match, Schema } from "effect";
import {
  type WorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

export const workspaceProductMonitorOptionEffectSchema = Schema.Literals(
  workspaceProductMonitorOptions
);

const storedBasicReservationDetailsEffectFields = {
  tier: Schema.Literal("basic"),
  coffee: Schema.Boolean,
};

export const storedBasicReservationDetailsEffectSchema = Schema.TaggedStruct(
  "cowork",
  storedBasicReservationDetailsEffectFields
);

const storedPlusReservationDetailsEffectFields = {
  tier: Schema.Literal("plus"),
  coffee: Schema.Literal(true),
};

export const storedPlusReservationDetailsEffectSchema = Schema.TaggedStruct(
  "cowork",
  storedPlusReservationDetailsEffectFields
);

const storedProfiReservationDetailsEffectFields = {
  tier: Schema.Literal("profi"),
  coffee: Schema.Literal(true),
  monitorOption: workspaceProductMonitorOptionEffectSchema,
};

export const storedProfiReservationDetailsEffectSchema = Schema.TaggedStruct(
  "cowork",
  storedProfiReservationDetailsEffectFields
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

export const makeWorkspaceReservationDetailsWithFieldsEffectSchema = <
  CoworkFields extends Schema.Struct.Fields,
  MeetingRoomFields extends Schema.Struct.Fields,
>(fields: {
  readonly cowork: CoworkFields;
  readonly meetingRoom: MeetingRoomFields;
}) =>
  Schema.Union([
    Schema.TaggedStruct("cowork", {
      ...fields.cowork,
      ...storedBasicReservationDetailsEffectFields,
    }),
    Schema.TaggedStruct("cowork", {
      ...fields.cowork,
      ...storedPlusReservationDetailsEffectFields,
    }),
    Schema.TaggedStruct("cowork", {
      ...fields.cowork,
      ...storedProfiReservationDetailsEffectFields,
    }),
    Schema.TaggedStruct("meeting-room", fields.meetingRoom),
  ]);

export const makeWorkspaceReservationDetailsEffectSchema = <
  Fields extends Schema.Struct.Fields,
>(
  fields: Fields
) =>
  makeWorkspaceReservationDetailsWithFieldsEffectSchema({
    cowork: fields,
    meetingRoom: fields,
  });

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

export type WorkspaceReservationDetailsEntryTierInput<
  Details extends
    StoredWorkspaceReservationDetails = StoredWorkspaceReservationDetails,
> = Details extends {
  readonly _tag: "cowork";
  readonly tier: unknown;
}
  ? Omit<Details, "_tag" | "tier"> & {
      readonly entryTier: Details["tier"];
    }
  : Details extends { readonly _tag: "meeting-room" }
    ? Omit<Details, "_tag"> & {
        readonly entryTier: Details["_tag"];
        readonly coffee?: never;
        readonly monitorOption?: never;
      }
    : never;

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
