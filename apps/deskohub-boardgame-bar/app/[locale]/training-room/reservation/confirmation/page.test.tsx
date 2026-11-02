import { afterEach, describe, expect, test } from "bun:test";
import { ReservationConfirmation } from "@/features/reservation/components/reservation-confirmation";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { siteConstants } from "@/shared/utils/constants";
import TrainingRoomConfirmationPage from "./page";

const initialBoardroomReservations =
  siteConstants.featureFlags.boardroomReservations;

afterEach(() => {
  siteConstants.featureFlags.boardroomReservations =
    initialBoardroomReservations;
});

const renderPage = (searchParams: Record<string, string>) =>
  TrainingRoomConfirmationPage({
    params: Promise.resolve({ locale: "cs-CZ" }),
    searchParams: Promise.resolve(searchParams),
  });

describe("TrainingRoomConfirmationPage", () => {
  test("is not found while training-room reservations are disabled", async () => {
    siteConstants.featureFlags.boardroomReservations = false;

    await expect(renderPage({})).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  test("confirms the submitted training-room request", async () => {
    siteConstants.featureFlags.boardroomReservations = true;

    const [confirmation] = findElementsOfType(
      await renderPage({
        firstName: "Jana",
        lastName: "Nováková",
        date: "2026-11-20",
        time: "09:00",
      }),
      ReservationConfirmation
    );

    expect(confirmation?.props).toMatchObject({
      status: "submitted",
      type: "training-room",
      details: {
        name: "Jana Nováková",
        date: new Date("2026-11-20"),
        time: "09:00",
      },
    });
  });
});
