import { afterEach, describe, expect, test } from "bun:test";
import { LocalizedLink } from "@/features/i18n";
import { Price } from "@/shared/components/price";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { siteConstants } from "@/shared/utils/constants";
import { TrainingPackages } from "./TrainingPackages";

const initialBoardroomReservations =
  siteConstants.featureFlags.boardroomReservations;

afterEach(() => {
  siteConstants.featureFlags.boardroomReservations =
    initialBoardroomReservations;
});

const classesOf = (className: string | undefined) =>
  className?.split(" ") ?? [];

const renderPackageCards = (boardroomReservations: boolean) => {
  siteConstants.featureFlags.boardroomReservations = boardroomReservations;
  return findElementsOfType(TrainingPackages(), Card);
};

describe("TrainingPackages", () => {
  test("prices the half-day and full-day packages and leaves the custom one unpriced", () => {
    expect(
      renderPackageCards(true).map((card) =>
        findElementsOfType(card, Price).map((price) => price.props.amount)
      )
    ).toEqual([
      [siteConstants.pricing.training.hourly],
      [siteConstants.pricing.training.daily],
      [],
    ]);
  });

  test("highlights only the full-day package", () => {
    const cards = renderPackageCards(true);

    expect(
      cards.map((card) => classesOf(card.props.className).includes("border-2"))
    ).toEqual([false, true, false]);
    expect(
      cards.map((card) =>
        classesOf(
          findElementsOfType(card, Button)[0]?.props.className
        ).includes("bg-green-500")
      )
    ).toEqual([false, true, false]);
    expect(
      cards.map((card) =>
        findElementsOfType(card, "span").some((span) =>
          classesOf(span.props.className).includes("rounded-full")
        )
      )
    ).toEqual([false, true, false]);
  });

  test("sends every package to the reservation while reservations are on, and to the contact page otherwise", () => {
    const linkTargets = (boardroomReservations: boolean) =>
      renderPackageCards(boardroomReservations).flatMap((card) =>
        findElementsOfType(card, LocalizedLink).map((link) => link.props.href)
      );

    expect(linkTargets(true)).toEqual(
      Array(3).fill("/training-room/reservation")
    );
    expect(linkTargets(false)).toEqual(Array(3).fill("/contact"));
  });
});
