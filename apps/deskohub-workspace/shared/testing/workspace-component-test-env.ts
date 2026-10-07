import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { Temporal } from "@js-temporal/polyfill";
import { act } from "react";
import "@/shared/testing/workspace-test-env";

let registered = false;

export const registerWorkspaceComponentTestEnv = () => {
  if (registered) return;
  GlobalRegistrator.register();
  Object.defineProperty(globalThis, "Temporal", {
    configurable: true,
    writable: true,
    value: Temporal,
  });
  registered = true;
};

export const unregisterWorkspaceComponentTestEnv = () => {
  if (!registered) return;
  GlobalRegistrator.unregister();
  registered = false;
};

export const flushWorkspaceComponentWork = async () => {
  await act(async () => {});
};
