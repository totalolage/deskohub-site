import {
  CliClientCompatibility,
  CliInputInvalid,
  DhwVersion,
  dhwVersionHeader,
  MinimumDhwVersion,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import {
  HttpApi,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from "effect/unstable/httpapi";
import { gte } from "semver";

/**
 * The calling `dhw` binary's version from `x-dhw-version`. Binaries that
 * predate the header, and a malformed value, give `None`.
 */
type CliClientVersion = Option.Option<DhwVersion>;

const readCliClientVersion = (
  headers: HttpServerRequest.HttpServerRequest["headers"]
): CliClientVersion =>
  Option.fromNullishOr(headers[dhwVersionHeader]).pipe(
    Option.flatMap(Schema.decodeUnknownOption(DhwVersion))
  );

/** An endpoint's minimum, falling back to its group's. */
const endpointMinimumDhwVersion = (
  group: HttpApiGroup.AnyWithProps,
  endpoint: HttpApiEndpoint.AnyWithProps
) =>
  Context.get(
    Context.merge(group.annotations, endpoint.annotations),
    MinimumDhwVersion
  );

/**
 * Fails when the operation has a minimum and the client is older, or didn't
 * say which version it is.
 */
const ensureDhwVersionSupported = (
  clientVersion: CliClientVersion,
  minimum: Option.Option<DhwVersion>
) =>
  Option.match(minimum, {
    onNone: () => Effect.void,
    onSome: (required) =>
      Option.exists(clientVersion, (version) => gte(version, required))
        ? Effect.void
        : Effect.fail(
            new CliInputInvalid({
              message:
                "This dhw version is too old for email campaigns. Run `dhw update`.",
            })
          ),
  });

/** Each restricted operation's minimum, keyed by `<group>.<endpoint>`. */
export const collectMinimumDhwVersions = <
  Id extends string,
  Groups extends HttpApiGroup.Any,
>(
  api: HttpApi.HttpApi<Id, Groups>
) => {
  const minimums: Record<string, DhwVersion> = {};
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint }) => {
      const minimum = endpointMinimumDhwVersion(group, endpoint);
      if (Option.isSome(minimum)) {
        minimums[`${group.identifier}.${endpoint.name}`] = minimum.value;
      }
    },
  });
  return minimums;
};

/** Every operation's minimum, which `getInfo` reports for diagnostics. */
export const minimumDhwVersions = collectMinimumDhwVersions(WorkspaceAdminApi);

/** Checks the operation's minimum against the request's header. */
export const CliClientCompatibilityLive = Layer.succeed(
  CliClientCompatibility,
  (httpEffect, { group, endpoint }) =>
    HttpServerRequest.HttpServerRequest.pipe(
      Effect.flatMap((request) =>
        ensureDhwVersionSupported(
          readCliClientVersion(request.headers),
          endpointMinimumDhwVersion(group, endpoint)
        )
      ),
      Effect.andThen(httpEffect)
    )
);
