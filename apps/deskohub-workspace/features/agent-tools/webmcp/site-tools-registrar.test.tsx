import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { SiteToolsRegistrar } from "./site-tools-registrar";
import {
  agentToolEventStream,
  installFakeModelContext,
  mockAgentToolEndpoint,
  pendingBodyResponse,
  publishedAgentTools,
  recordUnhandledRejections,
} from "./webmcp.test-utils";

// The listing also has a signed-in tool and the booking view's tool, which
// the site never registers.
const toolNames = ["list_offerings", "check_availability", "get_quote"];

/** A `tools/list` answer the test releases when it chooses. */
const pendingToolsList = () => {
  const { promise, resolve } = Promise.withResolvers<Response>();
  return {
    list: () => promise,
    release: () =>
      resolve(agentToolEventStream({ tools: [...publishedAgentTools] })),
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SiteToolsRegistrar", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("without document.modelContext, loads and registers nothing and leaves the document alone", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const windowKeys = Object.keys(window);
    try {
      const view = render(<SiteToolsRegistrar locale="en-US" />);
      await settle();

      expect(fetchSpy).not.toHaveBeenCalled();
      expect("modelContext" in document).toBe(false);
      expect(Object.keys(window)).toEqual(windowKeys);
      expect(view.container.innerHTML).toBe("");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("ignores a modelContext without registerTool", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {},
    });
    try {
      render(<SiteToolsRegistrar locale="en-US" />);
      await settle();

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, "modelContext");
      fetchSpy.mockRestore();
    }
  });

  test("registers the listed tools for the page locale and aborts every registration on unmount", async () => {
    const modelContext = installFakeModelContext();
    const endpoint = mockAgentToolEndpoint();
    try {
      const view = render(<SiteToolsRegistrar locale="cs-CZ" />);
      await waitFor(() =>
        expect([...modelContext.registered.keys()].sort()).toEqual(
          [...toolNames].sort()
        )
      );
      expect(modelContext.getTool("list_offerings").title).toBe(
        m.siteToolListOfferingsTitle({}, { locale: "cs-CZ" })
      );

      view.unmount();

      expect(modelContext.registered.size).toBe(0);
      expect(
        modelContext.registerTool.mock.calls.every(
          ([, options]) => options?.signal?.aborted
        )
      ).toBe(true);
    } finally {
      endpoint.restore();
      modelContext.uninstall();
    }
  });

  test("a Strict Mode double mount leaves one live registration per tool and no rejection", async () => {
    const unhandled = recordUnhandledRejections();
    const modelContext = installFakeModelContext();
    const toolsList = pendingToolsList();
    const endpoint = mockAgentToolEndpoint(undefined, toolsList.list);
    try {
      const view = render(
        <StrictMode>
          <SiteToolsRegistrar locale="en-US" />
        </StrictMode>
      );
      await waitFor(() => expect(endpoint.requests).toHaveLength(2));
      toolsList.release();

      await waitFor(() =>
        expect(modelContext.registered.size).toBe(toolNames.length)
      );
      await settle();
      expect(endpoint.requests.map(({ signal }) => signal?.aborted)).toEqual([
        true,
        false,
      ]);
      for (const name of toolNames) {
        expect(
          modelContext.registerTool.mock.calls.filter(
            ([tool, options]) => tool.name === name && !options?.signal?.aborted
          )
        ).toHaveLength(1);
      }

      view.unmount();
      await settle();

      expect(modelContext.registered.size).toBe(0);
      expect(
        modelContext.registerTool.mock.calls.every(
          ([, options]) => options?.signal?.aborted
        )
      ).toBe(true);
      expect(unhandled.rejections).toEqual([]);
    } finally {
      unhandled.stop();
      endpoint.restore();
      modelContext.uninstall();
    }
  });

  test("an unmount while tools/list is pending aborts it, registers nothing, and leaves no rejection", async () => {
    const unhandled = recordUnhandledRejections();
    const modelContext = installFakeModelContext();
    const toolsList = pendingToolsList();
    const endpoint = mockAgentToolEndpoint(undefined, toolsList.list);
    try {
      const view = render(<SiteToolsRegistrar locale="en-US" />);
      await waitFor(() => expect(endpoint.requests).toHaveLength(1));

      view.unmount();
      toolsList.release();
      await settle();

      expect(endpoint.requests[0]?.signal?.aborted).toBe(true);
      expect(modelContext.registerTool).not.toHaveBeenCalled();
      expect(unhandled.rejections).toEqual([]);
    } finally {
      unhandled.stop();
      endpoint.restore();
      modelContext.uninstall();
    }
  });

  test("an unmount while the tools/list body is arriving aborts the request and leaves no rejection", async () => {
    const unhandled = recordUnhandledRejections();
    const modelContext = installFakeModelContext();
    const toolsList = pendingBodyResponse();
    const endpoint = mockAgentToolEndpoint(undefined, () => toolsList.response);
    try {
      const view = render(<SiteToolsRegistrar locale="en-US" />);
      await toolsList.reading;

      view.unmount();
      await settle();

      expect(endpoint.requests[0]?.signal?.aborted).toBe(true);
      expect(modelContext.registerTool).not.toHaveBeenCalled();
      expect(unhandled.rejections).toEqual([]);
    } finally {
      unhandled.stop();
      endpoint.restore();
      modelContext.uninstall();
    }
  });
});
