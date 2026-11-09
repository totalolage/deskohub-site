import type { HttpApiEndpoint } from "effect/unstable/httpapi";
import { HttpApi, type HttpApiGroup } from "effect/unstable/httpapi";
import { AdminCliAdministratorsApi } from "./administrators";
import {
  AdminCliAutomationsApi,
  AdminCliCampaignsApi,
} from "./campaign-operation-endpoints";
import {
  AdminCliAdministrationApi,
  AdminCliApi,
  type AdministrationDiscountMutation,
  type AdministrationReservationAccessMutation,
} from "./workspace-admin-api";

export const WorkspaceAdminApi = HttpApi.make("workspaceAdminApi")
  .add(AdminCliApi)
  .add(AdminCliAdministrationApi)
  .add(AdminCliCampaignsApi)
  .add(AdminCliAutomationsApi)
  .add(AdminCliAdministratorsApi);

type GroupOperationReference<Group> = Group extends HttpApiGroup.Any
  ? `${HttpApiGroup.Name<Group>}.${HttpApiEndpoint.Name<HttpApiGroup.Endpoints<Group>>}`
  : never;

type ApiGroups<Api> =
  Api extends HttpApi.HttpApi<string, infer Groups> ? Groups : never;

/**
 * Every operation `WorkspaceAdminApi` serves, as `administrationOperations`
 * names it: `<group>.<endpoint>`, with each generic mutation endpoint split
 * into `<group>.<endpoint>.<kind>`.
 */
export type WorkspaceAdminOperationReference =
  | Exclude<
      GroupOperationReference<ApiGroups<typeof WorkspaceAdminApi>>,
      | "administration.mutateDiscounts"
      | "administration.mutateReservationAccess"
    >
  | `administration.mutateDiscounts.${AdministrationDiscountMutation["kind"]}`
  | `administration.mutateReservationAccess.${AdministrationReservationAccessMutation["kind"]}`;
