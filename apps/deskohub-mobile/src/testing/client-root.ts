import { afterAll, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import type { Root } from "react-dom/client";

/**
 * A React client root for one test file, so rendered components run their
 * effects. It registers a DOM before the file's tests and removes it after;
 * `render` renders inside `act`, so effects have run when it resolves.
 * `keepFetch` keeps Bun's fetch, its Request, Response and Headers, and its
 * abort signals in place of the DOM's, for components that talk to a fake
 * server: the DOM's drop forbidden headers such as Cookie.
 */
export const clientRoot = ({
  keepFetch = false,
}: {
  readonly keepFetch?: boolean;
} = {}) => {
  let root: Root;
  let container: HTMLElement;
  const fetchGlobals = {
    AbortController,
    AbortSignal,
    Headers,
    Request,
    Response,
    fetch,
  };
  beforeAll(async () => {
    GlobalRegistrator.register();
    if (keepFetch) Object.assign(globalThis, fetchGlobals);
    // React reads the act environment flag only once a DOM exists.
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const { createRoot } = await import("react-dom/client");
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterAll(async () => {
    await act(async () => root.unmount());
    await GlobalRegistrator.unregister();
  });
  return {
    render: (element: Parameters<Root["render"]>[0]) =>
      act(async () => root.render(element)),
    /** The element the root renders into. */
    container: () => container,
  };
};
