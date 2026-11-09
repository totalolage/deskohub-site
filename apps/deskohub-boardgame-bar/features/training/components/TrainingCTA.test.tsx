import { afterEach, describe, expect, test } from "bun:test";
import { LocalizedLink } from "@/features/i18n";
import { Card } from "@/shared/components/ui/card";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { siteConstants } from "@/shared/utils/constants";
import { getPhoneLink } from "@/shared/utils/phone-formatting";
import { TrainingCTA } from "./TrainingCTA";

const initialBoardroomReservations =
  siteConstants.featureFlags.boardroomReservations;

afterEach(() => {
  siteConstants.featureFlags.boardroomReservations =
    initialBoardroomReservations;
});

const renderCTA = async (boardroomReservations: boolean) => {
  siteConstants.featureFlags.boardroomReservations = boardroomReservations;
  return TrainingCTA();
};

const linkTargets = (tree: Awaited<ReturnType<typeof TrainingCTA>>) =>
  findElementsOfType(tree, LocalizedLink).map((link) => link.props.href);

describe("TrainingCTA", () => {
  test("links the call and write cards to the phone and email", async () => {
    const tree = await renderCTA(true);

    expect(findElementsOfType(tree, "a").map((a) => a.props.href)).toEqual([
      `tel:${getPhoneLink(siteConstants.contact.phone)}`,
      `mailto:${siteConstants.contact.infoEmail}`,
    ]);
  });

  test("links the online card and the main button to the training room reservation", async () => {
    const tree = await renderCTA(true);

    expect(linkTargets(tree)).toEqual([
      "/training-room/reservation",
      "/training-room/reservation",
    ]);
    expect(findElementsOfType(tree, Card)).toHaveLength(3);
  });

  test("dims the online card and sends the main button to the contact page while reservations are off", async () => {
    const tree = await renderCTA(false);

    expect(linkTargets(tree)).toEqual(["/contact"]);
    const onlineCard = findElementsOfType(tree, Card).at(-1);
    expect(onlineCard?.props.className?.split(" ")).toContain("opacity-75");
  });
});
