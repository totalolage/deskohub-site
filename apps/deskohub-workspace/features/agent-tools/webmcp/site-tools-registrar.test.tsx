import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { installFakeModelContext } from "./webmcp.test-utils";

type Registration = {
  readonly locale: string;
  readonly modelContext: unknown;
  readonly signal: AbortSignal;
};

const registerReadSiteTools = mock((_registration: Registration) =>
  Promise.resolve()
);

mock.module("./register-site-tools", () => ({ registerReadSiteTools }));

const { SiteToolsRegistrar } = await import("./site-tools-registrar");

describe("SiteToolsRegistrar", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    registerReadSiteTools.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("without document.modelContext, loads and registers nothing and leaves the document alone", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    const windowKeys = Object.keys(window);
    try {
      const view = render(<SiteToolsRegistrar locale="en-US" />);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(registerReadSiteTools).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect("modelContext" in document).toBe(false);
      expect(Object.keys(window)).toEqual(windowKeys);
      expect(view.container.innerHTML).toBe("");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("ignores a modelContext without registerTool", async () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {},
    });
    try {
      render(<SiteToolsRegistrar locale="en-US" />);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(registerReadSiteTools).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, "modelContext");
    }
  });

  test("registers the site tools for the page locale and aborts them on unmount", async () => {
    const modelContext = installFakeModelContext();
    try {
      const view = render(<SiteToolsRegistrar locale="cs-CZ" />);
      await waitFor(() =>
        expect(registerReadSiteTools).toHaveBeenCalledTimes(1)
      );
      const [registration] = registerReadSiteTools.mock.calls[0] ?? [];
      expect(registration?.locale).toBe("cs-CZ");
      expect(registration?.signal.aborted).toBe(false);

      view.unmount();

      expect(registration?.signal.aborted).toBe(true);
    } finally {
      modelContext.uninstall();
    }
  });

  test("a Strict Mode double mount leaves one live registration", async () => {
    const modelContext = installFakeModelContext();
    try {
      render(
        <StrictMode>
          <SiteToolsRegistrar locale="en-US" />
        </StrictMode>
      );
      await waitFor(() =>
        expect(registerReadSiteTools).toHaveBeenCalledTimes(2)
      );

      expect(
        registerReadSiteTools.mock.calls.map(([{ signal }]) => signal.aborted)
      ).toEqual([true, false]);
    } finally {
      modelContext.uninstall();
    }
  });
});
