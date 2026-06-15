import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "@/shared/testing/workspace-test-env";

let registered = false;

export const registerWorkspaceComponentTestEnv = () => {
  if (registered) return;
  GlobalRegistrator.register();
  registered = true;
};

export const unregisterWorkspaceComponentTestEnv = () => {
  if (!registered) return;
  GlobalRegistrator.unregister();
  registered = false;
};
