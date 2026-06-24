import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import sharp from "sharp";
import {
  workspaceTableMapFontFile,
  workspaceTableMapPngFontFamily,
} from "./workspace-reservation-email.service";

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
});
