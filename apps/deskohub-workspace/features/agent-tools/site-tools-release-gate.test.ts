import { expect, test } from "bun:test";
import { decideReleaseGateOnlyFor } from "@/features/feature-flags/backend/release-gate.test-utils";
import { SiteToolsReleaseGate } from "./site-tools-release-gate";

test("opens on the webmcp_site_tools flag", async () => {
  expect(
    await decideReleaseGateOnlyFor(SiteToolsReleaseGate, "webmcp_site_tools")
  ).toEqual({
    isOpen: true,
    release: "on",
    lookups: [
      ["isEnabled", "webmcp_site_tools"],
      ["constantValue", "webmcp_site_tools"],
    ],
  });
});
