import "@/shared/polyfills/temporal";

import { expect, type Page, type Request, test } from "@playwright/test";
import { m } from "@/features/i18n";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { enablePreviewAccess } from "../preview-access";
import { workspaceE2ETimeouts } from "../timeouts";

declare global {
  interface Window {
    /** The fake site tools the init script installs; absent otherwise. */
    readonly __fakeSiteTools?: FakeSiteTools;
  }
}

// Exactly the public read tools: `/api/mcp` also lists the signed-in tools
// and the booking view's tool, which a page can't use.
const siteToolNames = [
  "list_offerings",
  "check_availability",
  "get_quote",
  "prepare_reservation",
].sort();

type FakeSiteTools = {
  readonly names: () => string[];
  readonly titles: () => Record<string, string | undefined>;
  readonly execute: (name: string, input: object) => Promise<unknown>;
};

/**
 * Runs before the page's scripts: a `document.modelContext` that keeps the
 * registered tools, the way a WebMCP browser exposes them to its agent.
 * Aborting a registration's signal unregisters the tool, as in the draft.
 */
function installFakeModelContext() {
  type Tool = {
    readonly name: string;
    readonly title?: string;
    readonly execute: (input: object, options: object) => Promise<unknown>;
  };
  const tools = new Map<string, Tool>();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool: async (
        tool: Tool,
        { signal }: { readonly signal?: AbortSignal } = {}
      ) => {
        if (signal?.aborted) return;
        if (tools.has(tool.name)) {
          throw new DOMException(tool.name, "InvalidStateError");
        }
        tools.set(tool.name, tool);
        signal?.addEventListener("abort", () => tools.delete(tool.name));
      },
    },
  });
  Object.defineProperty(window, "__fakeSiteTools", {
    value: {
      names: () => [...tools.keys()],
      titles: () =>
        Object.fromEntries(
          [...tools].map(([name, tool]) => [name, tool.title])
        ),
      execute: (name: string, input: object) => {
        const tool = tools.get(name);
        if (!tool) throw new Error(`Site tool ${name} is not registered`);
        return tool.execute(input, {});
      },
    } satisfies FakeSiteTools,
  });
}

const fakeSiteTools = (page: Page) => ({
  titles: () => page.evaluate(() => window.__fakeSiteTools?.titles()),
  execute: (name: string, input: object) =>
    page.evaluate(
      ({ name, input }) => window.__fakeSiteTools?.execute(name, input),
      { name, input }
    ),
});

const recordAgentToolRequests = (page: Page) => {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/mcp") requests.push(request);
  });
  return requests;
};

// Reservation pages use the minimal header, so the form itself shows the page
// has loaded.
async function expectCoworkReservationForm(page: Page) {
  await expect(
    page.getByRole("list", { name: "Reservation steps" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Reservation date: choose from the calendar",
    })
  ).toBeVisible();
}

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test("registers the public agent tools as site tools and runs one through /api/mcp", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.WORKSPACE_E2E_BASE_URL === undefined,
    "The site tools case requires a protected preview"
  );
  testInfo.setTimeout(workspaceE2ETimeouts.customerMcpCase);
  await page.addInitScript(installFakeModelContext);
  const agentToolRequests = recordAgentToolRequests(page);

  await test.step(
    "opens the cowork reservation page",
    async () => {
      await page.goto("/en-US/reservation/cowork");
      await expectCoworkReservationForm(page);
    },
    { timeout: workspaceE2ETimeouts.browserNavigation }
  );

  const registered = await test.step(
    "waits for the site tools to register",
    () =>
      page
        .waitForFunction(
          (names) =>
            JSON.stringify(window.__fakeSiteTools?.names().sort()) ===
            JSON.stringify(names),
          siteToolNames,
          { timeout: workspaceE2ETimeouts.siteToolsRegistration }
        )
        .then(
          () => true,
          () => false
        ),
    { timeout: workspaceE2ETimeouts.siteToolsRegistration * 2 }
  );
  // Like the passkey account cases, the case needs its release gate on for
  // the preview; without it the page never asks `/api/mcp` for the tools.
  test.skip(
    !registered && agentToolRequests.length === 0,
    "webmcp_site_tools is off for this preview"
  );
  expect(registered).toBe(true);
  expect((await fakeSiteTools(page).titles())?.check_availability).toBe(
    m.siteToolCheckAvailabilityTitle({}, { locale: "en-US" })
  );

  await test.step(
    "runs check_availability through the real /api/mcp",
    async () => {
      const date = getCurrentWorkspaceDate().add({ days: 2 }).toString();
      const result = await fakeSiteTools(page).execute("check_availability", {
        family: "cowork",
        date,
        tier: "open-space",
      });

      expect(result).toMatchObject({ family: "cowork" });
      const call = agentToolRequests.find(
        (request) => request.postDataJSON()?.method === "tools/call"
      );
      expect(call?.postDataJSON()).toMatchObject({
        method: "tools/call",
        params: {
          name: "check_availability",
          arguments: { family: "cowork", date, locale: "en-US" },
        },
      });
    },
    { timeout: workspaceE2ETimeouts.customerMcpRequest }
  );
  // No other tool registered while the call ran.
  expect(
    Object.keys((await fakeSiteTools(page).titles()) ?? {}).sort()
  ).toEqual(siteToolNames);
});

test("makes no /api/mcp request in a browser without document.modelContext", async ({
  page,
}) => {
  const agentToolRequests = recordAgentToolRequests(page);

  await test.step(
    "opens the cowork reservation page and lets it settle",
    async () => {
      await page.goto("/en-US/reservation/cowork");
      await expectCoworkReservationForm(page);
      await page.waitForLoadState("load");
      await page.waitForTimeout(workspaceE2ETimeouts.siteToolsQuietPeriod);
    },
    {
      timeout:
        workspaceE2ETimeouts.browserNavigation +
        workspaceE2ETimeouts.siteToolsQuietPeriod,
    }
  );

  expect(await page.evaluate(() => "modelContext" in document)).toBe(false);
  expect(agentToolRequests).toEqual([]);
});
