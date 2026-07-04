import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import sharp from "sharp";

mock.module("server-only", () => ({}));

const {
  createReservationRows,
  workspaceTableMapFontFile,
  workspaceTableMapPngFontFamily,
} = await import("./workspace-reservation-email.service");

describe("workspace reservation email table map font", () => {
  test("renders with the configured native font instead of the fallback", async () => {
    expect(workspaceTableMapFontFile).toEndWith("Sculpin/regular.ttf");
    expect(existsSync(workspaceTableMapFontFile)).toBe(true);

    const renderText = async (input: {
      readonly font: string;
      readonly fontfile: string;
    }) =>
      sharp({
        text: {
          text: "Workspace 12",
          font: input.font,
          fontfile: input.fontfile,
          width: 400,
          align: "center",
          rgba: true,
        },
      })
        .png()
        .toBuffer({ resolveWithObject: true });

    const configured = await renderText({
      font: `${workspaceTableMapPngFontFamily} 48`,
      fontfile: workspaceTableMapFontFile,
    });
    const fallback = await renderText({
      font: "MissingWorkspaceFont 48",
      fontfile: "/tmp/missing-workspace-font.ttf",
    });

    expect(configured.data.equals(fallback.data)).toBe(false);
  });

  test("includes meeting room reservation time rows", () => {
    const rows = createReservationRows(
      {
        id: "meeting-room-order",
        dotyposCustomerId: "customer-id",
        dotyposReservationId: "dotypos-reservation-id",
        customerAccessCode: "test-code",
        productTier: "meeting-room",
        productCoffee: false,
        productMonitorOption: null,
        locale: "en-US",
        customer: { id: "customer-id" },
        reservedFrom: new Date("2026-06-20T07:00:00.000Z"),
        reservedUntil: new Date("2026-06-20T11:00:00.000Z"),
      },
      "en-US"
    );

    expect(rows).toContainEqual(["Reservation time", "9:00 AM - 1:00 PM"]);
  });
});
