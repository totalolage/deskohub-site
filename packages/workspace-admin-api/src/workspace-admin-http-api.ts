import { HttpApi } from "effect/unstable/httpapi";
import { AdminCliAccountsApi } from "./accounts";
import { AdminCliAdministratorsApi } from "./administrators";
import { AdminCliAutomationsApi } from "./email-automations";
import { AdminCliCampaignsApi } from "./email-campaigns";
import { AdminCliAdministrationApi, AdminCliApi } from "./workspace-admin-api";

export const WorkspaceAdminApi = HttpApi.make("workspaceAdminApi")
  .add(AdminCliApi)
  .add(AdminCliAdministrationApi)
  .add(AdminCliCampaignsApi)
  .add(AdminCliAutomationsApi)
  .add(AdminCliAdministratorsApi)
  .add(AdminCliAccountsApi);
