import { afterAll, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import type { Root } from "react-dom/client";

/**
 * A React client root for one test file, so rendered components run their
 * effects. It registers a DOM before the file's tests and removes it after;
 * `render` renders inside `act`, so effects have run when it resolves.
 */
export const clientRoot = () => {
  let root: Root;
  beforeAll(async () => {
    GlobalRegistrator.register();
    // React reads the act environment flag only once a DOM exists.
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.createElement("div"));
  });
  afterAll(async () => {
    await act(async () => root.unmount());
    await GlobalRegistrator.unregister();
  });
  return {
    render: (element: Parameters<Root["render"]>[0]) =>
      act(async () => root.render(element)),
  };
};
