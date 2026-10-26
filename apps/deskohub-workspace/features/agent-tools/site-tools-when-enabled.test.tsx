import { describe, expect, mock, test } from "bun:test";

const areSiteToolsEnabled = mock(() => Promise.resolve(false));

mock.module("./site-tools-feature-flag.server", () => ({
  areSiteToolsEnabled,
}));
mock.module("@/features/feature-flags/backend/global-release.server", () => ({
  loadGlobalRelease: () => Promise.resolve("undecided"),
}));

const { SiteToolsWhenEnabled } = await import("./site-tools-when-enabled");
const { GlobalReleaseGate } = await import(
  "@/features/feature-flags/components/global-release-gate"
);
const { SiteToolsRegistrar } = await import("./webmcp/site-tools-registrar");

describe("SiteToolsWhenEnabled", () => {
  test("gates the registrar for the page locale on the site tools flag", () => {
    expect(SiteToolsWhenEnabled({ locale: "cs-CZ" })).toMatchObject({
      type: GlobalReleaseGate,
      props: {
        flag: "webmcp_site_tools",
        isEnabled: areSiteToolsEnabled,
        children: { type: SiteToolsRegistrar, props: { locale: "cs-CZ" } },
      },
    });
  });
});
