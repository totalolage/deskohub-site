import { Match, Schema } from "effect";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

export const workspaceProductMonitorOptionEffectSchema = Schema.Literals(
  workspaceProductMonitorOptions
);

const makeWorkspaceReservationDetailsEffectSchemas = <
  CoworkFields extends Schema.Struct.Fields,
  MeetingRoomFields extends Schema.Struct.Fields,
>(fields: {
  readonly cowork: CoworkFields;
  readonly meetingRoom: MeetingRoomFields;
}) => {
  const basic = Schema.TaggedStruct("cowork", {
    ...fields.cowork,
    tier: Schema.Literal("basic"),
    coffee: Schema.Boolean,
  });
  const plus = Schema.TaggedStruct("cowork", {
    ...fields.cowork,
    tier: Schema.Literal("plus"),
    coffee: Schema.Literal(true),
  });
  const profi = Schema.TaggedStruct("cowork", {
    ...fields.cowork,
    tier: Schema.Literal("profi"),
    coffee: Schema.Literal(true),
    monitorOption: workspaceProductMonitorOptionEffectSchema,
  });
  const meetingRoom = Schema.TaggedStruct("meeting-room", fields.meetingRoom);
  const cowork = Schema.Union([basic, plus, profi]);

  return {
    basic,
    plus,
    profi,
    cowork,
    meetingRoom,
    workspace: Schema.Union([cowork, meetingRoom]),
  } as const;
};

const storedWorkspaceReservationDetailsEffectSchemas =
  makeWorkspaceReservationDetailsEffectSchemas({
    cowork: {},
    meetingRoom: {},
  });

export const storedBasicReservationDetailsEffectSchema =
  storedWorkspaceReservationDetailsEffectSchemas.basic;
export const storedPlusReservationDetailsEffectSchema =
  storedWorkspaceReservationDetailsEffectSchemas.plus;
export const storedProfiReservationDetailsEffectSchema =
  storedWorkspaceReservationDetailsEffectSchemas.profi;
export const storedCoworkReservationDetailsEffectSchema =
  storedWorkspaceReservationDetailsEffectSchemas.cowork;
export const storedMeetingRoomReservationDetailsEffectSchema =
  storedWorkspaceReservationDetailsEffectSchemas.meetingRoom;
export const storedWorkspaceReservationDetailsEffectSchema =
  storedWorkspaceReservationDetailsEffectSchemas.workspace;

export const makeWorkspaceReservationDetailsWithFieldsEffectSchema = <
  CoworkFields extends Schema.Struct.Fields,
  MeetingRoomFields extends Schema.Struct.Fields,
>(fields: {
  readonly cowork: CoworkFields;
  readonly meetingRoom: MeetingRoomFields;
}) => makeWorkspaceReservationDetailsEffectSchemas(fields).workspace;

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

export const storedWorkspaceReservationDetailsSchema = makeEffectSchemaParser(
  storedWorkspaceReservationDetailsEffectSchema,
  { onExcessProperty: "error" }
);

export const getStoredWorkspaceReservationDetails = (
  input: StoredWorkspaceReservationDetails
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
