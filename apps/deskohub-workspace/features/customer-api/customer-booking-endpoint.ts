import type { WorkspaceCustomerApi } from "@deskohub/workspace-customer-api";
import type {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";

type CustomerApiGroups =
  typeof WorkspaceCustomerApi extends HttpApi.HttpApi<string, infer Groups>
    ? Groups
    : never;

/**
 * The booking group's endpoints named `Name`, as the composed API serves
 * them. Each booking handlers module attaches its own endpoints' handlers to
 * a `Handlers` value over these.
 */
export type CustomerBookingEndpoint<Name extends string = string> =
  HttpApiEndpoint.WithName<
    HttpApiGroup.EndpointsWithName<CustomerApiGroups, "booking">,
    Name
  >;
