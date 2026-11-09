import { describe, expect, test } from "bun:test";
import {
  workspaceCoworkHistoricalTiers,
  workspaceCoworkTiers,
  workspaceMeetingRoomCatalog,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { locales } from "@/features/i18n";
import { getMeetingRoomReservationDurationKey } from "./meeting-room-reservation-duration";
import { workspaceReservationKindSchema } from "./reservation-kind";
import {
  type ReservationProductProperty,
  reservationProductFamilies,
} from "./reservation-product-descriptor";

const enumProperty = (
  family: keyof typeof reservationProductFamilies,
  id: string
) => {
  const property: ReservationProductProperty | undefined =
    reservationProductFamilies[family].properties.find(
      (candidate) => candidate.id === id
    );
  if (property?.kind !== "enum") throw new Error(`${family}.${id} not enum`);
  return property;
};

describe("reservation product descriptor", () => {
  test("describes every reservation family under its own ID", () => {
    expect(Object.keys(reservationProductFamilies).sort()).toEqual(
      [...workspaceReservationKindSchema.literals].sort()
    );
    for (const [id, family] of Object.entries(reservationProductFamilies)) {
      expect(family.id).toBe(id as typeof family.id);
    }
  });

  test("gives each property of a family a unique ID", () => {
    for (const family of Object.values(reservationProductFamilies)) {
      const ids = family.properties.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("lists every cowork tier and marks only the historical ones retired", () => {
    const tier = enumProperty("cowork", "tier");

    expect(tier.values.map(({ id }) => id)).toEqual([...workspaceCoworkTiers]);
    expect(
      tier.values.filter(({ retired }) => retired).map(({ id }) => id)
    ).toEqual([...workspaceCoworkHistoricalTiers]);
  });

  test("lists every monitor option and meeting-room offer from the catalog", () => {
    expect(
      enumProperty("cowork", "monitor").values.map(({ id }) => id)
    ).toEqual([...workspaceProductMonitorOptions]);
    expect(
      enumProperty("meeting-room", "offer").values.map(({ id }) => id)
    ).toEqual(
      workspaceMeetingRoomCatalog.map(({ duration }) =>
        getMeetingRoomReservationDurationKey(duration)
      )
    );
  });

  test("names every enum value in every locale", () => {
    for (const family of Object.values(reservationProductFamilies)) {
      for (const property of family.properties) {
        if (property.kind !== "enum") continue;
        for (const value of property.values) {
          for (const locale of locales) {
            expect(value.name(locale).trim()).not.toBe("");
          }
        }
      }
    }
  });
});
