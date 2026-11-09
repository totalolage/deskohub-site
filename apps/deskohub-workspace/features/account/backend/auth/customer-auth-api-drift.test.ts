import { describe, expect, test } from "bun:test";
import { passkey } from "@better-auth/passkey";
import {
  CustomerAuthApi,
  type CustomerAuthEndpoints,
} from "@deskohub/workspace-customer-api";
import { getSession, signOut } from "better-auth/api";
import {
  HttpApi,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  disabledCustomerAgentClientPaths,
  makeCustomerAgentAuthorizationPlugins,
} from "./customer-agent-authorization-server";

/**
 * The customer API package describes the Better Auth endpoints its clients
 * call; Better Auth serves them. These checks read Better Auth's own
 * endpoint objects, built from the plugin factories the auth server uses,
 * so an upgrade that moves an endpoint fails here instead of in the app.
 */

/** Better Auth's default base path, served by `app/api/auth/[...all]`. */
const authBasePath = "/api/auth";

type AuthEndpoint = {
  readonly path: string;
  readonly options: { readonly method: string | ReadonlyArray<string> };
};

const [agentAuthorizationServer] = makeCustomerAgentAuthorizationPlugins({
  resource: "https://workspace.example/api/mcp",
});
const passkeyPlugin = passkey();

type CustomerAuthEndpointName = HttpApiEndpoint.Name<
  HttpApiGroup.Endpoints<typeof CustomerAuthEndpoints>
>;

/** Every contract endpoint and the Better Auth endpoint that serves it. */
const servingEndpoints = {
  getSession: getSession(),
  signOut,
  updatePasskey: passkeyPlugin.endpoints.updatePasskey,
  deletePasskey: passkeyPlugin.endpoints.deletePasskey,
  deleteConsent: agentAuthorizationServer.endpoints.deleteOAuthConsent,
} satisfies Record<CustomerAuthEndpointName, AuthEndpoint>;

const contractEndpoints = () => {
  const endpoints: Array<{
    readonly name: string;
    readonly method: string;
    readonly path: string;
  }> = [];
  HttpApi.reflect(CustomerAuthApi, {
    onGroup: () => {},
    onEndpoint: ({ endpoint }) => {
      endpoints.push({
        name: endpoint.name,
        method: endpoint.method,
        path: endpoint.path,
      });
    },
  });
  return endpoints;
};

const methodsOf = (endpoint: AuthEndpoint) => [endpoint.options.method].flat();

describe("CustomerAuthApi against Better Auth", () => {
  const endpoints = contractEndpoints();

  test("maps every contract endpoint to a Better Auth endpoint", () => {
    expect(endpoints.map(({ name }) => name).sort()).toEqual(
      Object.keys(servingEndpoints).sort()
    );
  });

  test.each(endpoints.map((endpoint) => [endpoint.name, endpoint] as const))(
    "%s uses Better Auth's path and method",
    (name, endpoint) => {
      const serving: AuthEndpoint =
        servingEndpoints[name as CustomerAuthEndpointName];

      expect(endpoint.path).toBe(`${authBasePath}${serving.path}`);
      expect(methodsOf(serving)).toContain(endpoint.method);
    }
  );

  test("calls no endpoint the auth server disables", () => {
    const disabled = new Set<string>(disabledCustomerAgentClientPaths);

    expect(
      Object.values(servingEndpoints).filter(({ path }) => disabled.has(path))
    ).toEqual([]);
  });
});
