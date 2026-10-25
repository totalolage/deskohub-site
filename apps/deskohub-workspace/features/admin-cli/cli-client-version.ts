import {
  CliClientCompatibility,
  CliInputInvalid,
  CliServiceUnavailable,
  DhwVersion,
  dhwVersionHeader,
  MinimumDhwVersion,
  OutdatedDhwRefusal,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Match, Option, Schema } from "effect";
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

/** The calling `dhw` binary's version, for a handler that shapes its response. */
export const currentCliClientVersion = Effect.map(
  HttpServerRequest.HttpServerRequest,
  (request) => readCliClientVersion(request.headers)
);

/**
 * Whether the calling binary is `since` or later, by the same comparison as
 * the minimum check. A client that didn't say which version it is isn't.
 */
export const cliClientIsAtLeast = (
  clientVersion: CliClientVersion,
  since: DhwVersion
): boolean => Option.exists(clientVersion, (version) => gte(version, since));

/** An endpoint's annotations over its group's. */
const endpointAnnotations = (
  group: HttpApiGroup.AnyWithProps,
  endpoint: HttpApiEndpoint.AnyWithProps
) => Context.merge(group.annotations, endpoint.annotations);

/** An endpoint's minimum, falling back to its group's. */
const endpointMinimumDhwVersion = (
  group: HttpApiGroup.AnyWithProps,
  endpoint: HttpApiEndpoint.AnyWithProps
) => Context.get(endpointAnnotations(group, endpoint), MinimumDhwVersion);

/** The error the endpoint refuses an outdated `dhw` with. */
const outdatedDhwRefusal = (refusal: (typeof OutdatedDhwRefusal)["Service"]) =>
  Match.value(refusal).pipe(
    Match.when(
      "CliInputInvalid",
      () =>
        new CliInputInvalid({
          message:
            "This dhw version is too old for email campaigns. Run `dhw update`.",
        })
    ),
    Match.when(
      "CliServiceUnavailable",
      () =>
        new CliServiceUnavailable({
          message:
            "This dhw version is too old for this operation. Run `dhw update`.",
        })
    ),
    Match.exhaustive
  );

/**
 * Fails when the operation has a minimum and the client is older, or didn't
 * say which version it is.
 */
const ensureDhwVersionSupported = (
  clientVersion: CliClientVersion,
  annotations: Context.Context<never>
) =>
  Option.match(Context.get(annotations, MinimumDhwVersion), {
    onNone: () => Effect.void,
    onSome: (required) =>
      cliClientIsAtLeast(clientVersion, required)
        ? Effect.void
        : Effect.fail(
            outdatedDhwRefusal(Context.get(annotations, OutdatedDhwRefusal))
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
          endpointAnnotations(group, endpoint)
        )
      ),
      Effect.andThen(httpEffect)
    )
);
