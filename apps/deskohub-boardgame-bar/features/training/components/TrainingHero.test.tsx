import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { LocalizedLink } from "@/features/i18n";
import { Price } from "@/shared/components/price";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { siteConstants } from "@/shared/utils/constants";

setBoardgameTestEnv();
mock.module("server-only", () => ({}));

let TrainingHero: typeof import("./TrainingHero").TrainingHero;

beforeAll(async () => {
  ({ TrainingHero } = await import("./TrainingHero"));
});

const initialFlags = { ...siteConstants.featureFlags };

afterEach(() => {
  Object.assign(siteConstants.featureFlags, initialFlags);
});

const heroLinkTargets = (flags: {
  boardroomReservations: boolean;
  gallery: boolean;
}) => {
  Object.assign(siteConstants.featureFlags, flags);
  return findElementsOfType(TrainingHero(), LocalizedLink).map(
    (link) => link.props.href
  );
};

describe("TrainingHero", () => {
  test("shows the hourly and daily training room prices", () => {
    expect(
      findElementsOfType(TrainingHero(), Price).map(
        (price) => price.props.amount
      )
    ).toEqual([
      siteConstants.pricing.training.hourly,
      siteConstants.pricing.training.daily,
    ]);
  });

  test("links to the reservation and the gallery while both are on", () => {
    expect(
      heroLinkTargets({ boardroomReservations: true, gallery: true })
    ).toEqual(["/training-room/reservation", "/training-room/gallery"]);
  });

  test("links only to the contact page while reservations and the gallery are off", () => {
    expect(
      heroLinkTargets({ boardroomReservations: false, gallery: false })
    ).toEqual(["/contact"]);
  });
});
