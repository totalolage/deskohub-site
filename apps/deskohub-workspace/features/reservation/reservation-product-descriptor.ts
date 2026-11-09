import { Match, Schema } from "effect";
import {
  workspaceCoworkHistoricalTiers,
  workspaceCoworkTiers,
  workspaceMeetingRoomCatalog,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { Locale } from "@/features/i18n";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import {
  coworkReservationKind,
  meetingRoomReservationKind,
  officeReservationKind,
  type WorkspaceReservationKind,
} from "@/features/reservation/reservation-kind";

/** One value of an enum property: its stable ID and catalog name. */
type ReservationProductEnumValue = {
  readonly id: string;
  /** The catalog's name for it, in the given locale. */
  readonly name: (locale: Locale) => string;
  /** No longer sold, but stored reservations still carry it. */
  readonly retired: boolean;
};

/**
 * A reservation property an audience can filter on. `id` is stable: stored
 * audience filters name it. Labels are Admin copy, so they're English.
 */
export type ReservationProductProperty =
  | {
      readonly kind: "enum";
      readonly id: string;
      readonly label: string;
      readonly values: readonly ReservationProductEnumValue[];
    }
  | { readonly kind: "boolean"; readonly id: string; readonly label: string }
  | {
      readonly kind: "number";
      readonly id: string;
      readonly label: string;
      readonly unit: { readonly one: string; readonly other: string };
    };

export type ReservationProductFamily = {
  readonly id: WorkspaceReservationKind;
  readonly label: string;
  readonly properties: readonly ReservationProductProperty[];
};

const enumValues = <const Value extends string>(
  values: readonly Value[],
  name: (value: Value, locale: Locale) => string,
  retired: readonly Value[] = []
): readonly ReservationProductEnumValue[] =>
  values.map((value) => ({
    id: value,
    name: (locale) => name(value, locale),
    retired: retired.includes(value),
  }));

const meetingRoomOffers = workspaceMeetingRoomCatalog.map(({ duration }) => ({
  id: getMeetingRoomReservationDurationKey(duration),
  name: (locale: Locale) =>
    getWorkspaceMeetingRoomDurationLabel(duration, locale),
  retired: false,
}));

/**
 * The reservation product catalog as audiences see it: each family and the
 * properties its reservation snapshot records. Values come from the checkout
 * catalog constants and names from its i18n catalog, so a new tier, monitor
 * option, or meeting-room offer appears here without audience changes.
 */
export const reservationProductFamilies = {
  [coworkReservationKind]: {
    id: coworkReservationKind,
    label: "Cowork",
    properties: [
      {
        kind: "enum",
        id: "tier",
        label: "Tier",
        values: enumValues(
          workspaceCoworkTiers,
          getWorkspaceProductTierTitle,
          workspaceCoworkHistoricalTiers
        ),
      },
      { kind: "boolean", id: "coffee", label: "Coffee" },
      {
        kind: "enum",
        id: "monitor",
        label: "Monitor setup",
        values: enumValues(
          workspaceProductMonitorOptions,
          getWorkspaceProductMonitorTitle
        ),
      },
    ],
  },
  [meetingRoomReservationKind]: {
    id: meetingRoomReservationKind,
    label: "Meeting room",
    properties: [
      {
        kind: "enum",
        id: "offer",
        label: "Duration",
        values: meetingRoomOffers,
      },
    ],
  },
  [officeReservationKind]: {
    id: officeReservationKind,
    label: "Office",
    properties: [
      {
        kind: "number",
        id: "seats",
        label: "Seats",
        unit: { one: "seat", other: "seats" },
      },
      {
        kind: "number",
        id: "days",
        label: "Days",
        unit: { one: "day", other: "days" },
      },
    ],
  },
} as const satisfies {
  readonly [Family in WorkspaceReservationKind]: ReservationProductFamily & {
    readonly id: Family;
  };
};

/** Every property ID of each family, for exhaustive per-property mappings. */
export type ReservationProductPropertyIds = {
  readonly [Family in WorkspaceReservationKind]: (typeof reservationProductFamilies)[Family]["properties"][number]["id"];
};

export const reservationProductProperty = (
  family: WorkspaceReservationKind,
  property: string
): ReservationProductProperty | undefined =>
  reservationProductFamilies[family].properties.find(
    ({ id }) => id === property
  );

/** Whether the family's catalog has a property with this stored ID. */
export const isReservationProductPropertyId = <
  Family extends WorkspaceReservationKind,
>(
  family: Family,
  property: string
): property is ReservationProductPropertyIds[Family] =>
  reservationProductProperty(family, property) !== undefined;

/** A property condition's value schema, by the property's kind. */
const propertyConditionSchema = (
  property: ReservationProductProperty
): Schema.Top =>
  Match.value(property).pipe(
    Match.discriminatorsExhaustive("kind")({
      enum: ({ id, values }) =>
        Schema.Struct({
          property: Schema.Literal(id),
          operator: Schema.Literals(["anyOf", "noneOf"]),
          value: Schema.Array(
            Schema.Literals(values.map((value) => value.id))
          ).check(Schema.isMinLength(1)),
        }),
      boolean: ({ id }) =>
        Schema.Struct({
          property: Schema.Literal(id),
          operator: Schema.Literal("is"),
          value: Schema.Boolean,
        }),
      number: ({ id }) =>
        Schema.Struct({
          property: Schema.Literal(id),
          operator: Schema.Literals(["eq", "ne", "lt", "lte", "gt", "gte"]),
          value: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        }),
    })
  );

/**
 * Validates a product filter's property conditions against its family's
 * catalog properties: a known property, the operator of its kind, and known
 * enum values (retired ones included).
 */
export const reservationProductFilterSchema = Schema.Union(
  Object.values(reservationProductFamilies).map((family) =>
    Schema.Struct({
      family: Schema.Literal(family.id),
      properties: Schema.Array(
        Schema.Union(family.properties.map(propertyConditionSchema))
      ),
    })
  )
);
