import {
  AdminCliCampaignsApi,
  operationGroupHandlers,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { cliCampaignOperationInvoker } from "./cli-campaign-operations.server";

/**
 * Every campaign endpoint is the port's operation of the same name: the
 * session's administrator, the session's mutation ledger, and the input the
 * request carries.
 */
export const AdminCliCampaignsApiHandlers = operationGroupHandlers(
  WorkspaceAdminApi,
  AdminCliCampaignsApi,
  cliCampaignOperationInvoker
);
