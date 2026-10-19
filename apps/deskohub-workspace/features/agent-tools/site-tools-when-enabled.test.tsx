import { beforeEach, describe, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const events: string[] = [];
const areSiteToolsEnabled = mock(() => Promise.resolve(false));
const connection = mock(() => Promise.resolve());

mock.module("next/server", () => ({ connection }));
mock.module("./site-tools-feature-flag.server", () => ({
  areSiteToolsEnabled,
}));

const { SiteToolsWhenEnabled } = await import("./site-tools-when-enabled");
const { SiteToolsRegistrar } = await import("./webmcp/site-tools-registrar");

const renderGated = async () => {
  const boundary = SiteToolsWhenEnabled({ locale: "cs-CZ" });
  const gate = boundary.props.children as ReactElement<{ locale: string }>;
  const render = gate.type as (props: { locale: string }) => Promise<ReactNode>;
  return render(gate.props);
};

describe("SiteToolsWhenEnabled", () => {
  beforeEach(() => {
    events.length = 0;
    connection.mockImplementation(async () => {
      events.push("connection");
    });
    areSiteToolsEnabled.mockImplementation(async () => {
      events.push("flag");
      return false;
    });
  });

  test("reads the release gate after the request-bound render starts", async () => {
    await renderGated();

    expect(events).toEqual(["connection", "flag"]);
  });

  test("renders nothing while the gate is off, omitted, or failed", async () => {
    // The gate resolves every non-true evaluation, errors included, to false.
    expect(await renderGated()).toBe(false);
  });

  test("renders the registrar for the page locale when the gate is on", async () => {
    areSiteToolsEnabled.mockImplementation(async () => true);

    const rendered = await renderGated();

    expect(isValidElement(rendered)).toBe(true);
    expect(rendered).toMatchObject({
      type: SiteToolsRegistrar,
      props: { locale: "cs-CZ" },
    });
  });
});
