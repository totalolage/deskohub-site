import { expect, test } from "bun:test";
import { workspaceUpdateUrls } from "./workspace-update-urls";

test("builds the release lookup and the download page on the API origin", () => {
  expect(workspaceUpdateUrls("https://workspace.test")).toEqual({
    latestReleaseUrl: "https://workspace.test/api/mobile/releases/latest",
    androidDownloadUrl: "https://workspace.test/android",
  });
});
