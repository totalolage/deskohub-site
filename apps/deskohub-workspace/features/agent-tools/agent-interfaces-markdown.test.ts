import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { locales } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import { markdownLinkUrls } from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteOrigin } from "@/shared/utils/site-constants";
import {
  type AgentInterfaces,
  agentInterfacesMarkdown,
  agentInterfacesSubheadings,
  type DescribedAgentTool,
} from "./agent-interfaces-markdown";
import { publishedCustomerAgentTools } from "./customer-agent-tools";
import { prepareReservationToolName } from "./webmcp/prepare-reservation-site-tool-description";

const render = (interfaces: Partial<AgentInterfaces> = {}) =>
  serializeMarkdown(
    agentInterfacesMarkdown({
      tools: publishedCustomerAgentTools,
      siteToolsRelease: "on",
      ...interfaces,
    })
  );

/** The tool names listed under a subheading, in order. */
const listedTools = (markdown: string, subheading: string) => {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`### ${subheading}`);
  if (start === -1) return undefined;
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("#")
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .flatMap((line) => line.match(/^- `([^`]+)`/)?.slice(1) ?? []);
};

const namesWithAccess = (access: DescribedAgentTool["access"]) =>
  publishedCustomerAgentTools
    .filter((tool) => tool.access === access)
    .map(({ name }) => name);

// The route file Next serves a path from.
const routeFileExists = (pathname: string) =>
  existsSync(new URL(`../../app${pathname}/route.ts`, import.meta.url));

describe("agentInterfacesMarkdown", () => {
  test("lists every published tool under its access, from the definitions", () => {
    const markdown = render();

    expect(
      listedTools(markdown, agentInterfacesSubheadings.publicTools)
    ).toEqual(namesWithAccess("public"));
    expect(
      listedTools(markdown, agentInterfacesSubheadings.signedInTools)
    ).toEqual(namesWithAccess("signed-in"));
    expect(namesWithAccess("public").length).toBeGreaterThan(0);
    expect(namesWithAccess("signed-in").length).toBeGreaterThan(0);
  });

  test("names each signed-in tool's scope", () => {
    const markdown = render();

    for (const tool of publishedCustomerAgentTools) {
      if (tool.access !== "signed-in") continue;
      const item = markdown
        .split("\n")
        .find((line) => line.startsWith(`- \`${tool.name}\``));
      expect(item).toContain(`\`${tool.scope}\``);
    }
  });

  test("leaves out a section without tools", () => {
    const markdown = render({
      tools: publishedCustomerAgentTools.filter(
        (tool) => tool.access === "public"
      ),
    });

    expect(
      listedTools(markdown, agentInterfacesSubheadings.signedInTools)
    ).toBeUndefined();
  });

  test("links the MCP server and its OAuth discovery on the site origin", () => {
    const urls = markdownLinkUrls(render()).map((url) => new URL(url));

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.origin).toBe(workspaceSiteOrigin);
      expect(routeFileExists(url.pathname)).toBe(true);
      for (const locale of locales) {
        expect(url.pathname.split("/")).not.toContain(locale);
      }
    }
  });

  test("lists the public tools without a view and prepare_reservation as site tools", () => {
    const siteTools = publishedCustomerAgentTools
      .filter((tool) => tool.access === "public" && tool.view === undefined)
      .map(({ name }) => name);

    expect(siteTools.length).toBeGreaterThan(0);
    for (const siteToolsRelease of ["on", "undecided"] as const) {
      expect(
        listedTools(
          render({ siteToolsRelease }),
          agentInterfacesSubheadings.siteTools
        )
      ).toEqual([...siteTools, prepareReservationToolName]);
    }
  });

  test("describes the site tools only while they aren't off for every visitor", () => {
    expect(
      listedTools(
        render({ siteToolsRelease: "off" }),
        agentInterfacesSubheadings.siteTools
      )
    ).toBeUndefined();
    expect(render({ siteToolsRelease: "undecided" })).not.toBe(render());
  });
});
