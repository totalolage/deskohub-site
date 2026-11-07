import "server-only";

import { Effect, Match, Option, Schema } from "effect";
import { serializeDictionary } from "structured-headers";
import { WorkspaceRouteFailure } from "@/shared/backend/workspace-route";
import { preferredMediaType } from "@/shared/utils/media-type-negotiation";
import { encodeMultipartMixed } from "@/shared/utils/multipart-mixed";
import { MobileUpdatePlatform } from "../mobile-update-publication";
import { signManifestBody } from "./manifest-signing";
import {
  MobileUpdatePublications,
  type PublishedMobileUpdate,
} from "./mobile-update-publications.service";

/** What an installed app states about itself when it checks for an update. */
interface ManifestRequest {
  readonly platform: MobileUpdatePlatform;
  readonly runtimeVersion: string;
  readonly currentUpdateId: string | null;
  readonly embeddedUpdateId: string | null;
  readonly expectsSignature: boolean;
}

/** The single part an update check answers with, besides its extensions. */
interface ManifestReply {
  readonly part: "manifest" | "directive";
  readonly body: object;
}

const rejected = (statusCode: 400 | 406, publicMessage: string) =>
  new WorkspaceRouteFailure({ statusCode, publicMessage });

const decodePlatform = Schema.decodeUnknownEffect(MobileUpdatePlatform);

/**
 * Only protocol 1 multipart responses carry directives, so a client that
 * speaks another protocol version or refuses multipart gets 406.
 */
const requireProtocolOne = (headers: Headers) =>
  Effect.succeed(headers).pipe(
    Effect.filterOrFail(
      (requestHeaders) => requestHeaders.get("expo-protocol-version") === "1",
      () => rejected(406, "Only Expo Updates protocol 1 is supported")
    ),
    Effect.filterOrFail(
      (requestHeaders) =>
        preferredMediaType(requestHeaders, ["multipart/mixed"]) !== undefined,
      () => rejected(406, "Update responses are multipart/mixed only")
    )
  );

/**
 * Reads an Expo Updates protocol 1 request. The protocol lets the platform
 * and runtime version also arrive as query parameters.
 */
const readManifestRequest = (request: Request) =>
  Effect.Do.pipe(
    Effect.let("headers", () => request.headers),
    Effect.let("query", () => new URL(request.url).searchParams),
    Effect.tap(({ headers }) => requireProtocolOne(headers)),
    Effect.bind("platform", ({ headers, query }) =>
      decodePlatform(
        headers.get("expo-platform") ?? query.get("platform")
      ).pipe(
        Effect.mapError(() =>
          rejected(400, "The platform must be android or ios")
        )
      )
    ),
    Effect.bind("runtimeVersion", ({ headers, query }) =>
      Option.fromNullishOr(
        headers.get("expo-runtime-version") || query.get("runtime-version")
      ).pipe(
        Option.filter((runtimeVersion) => runtimeVersion.length > 0),
        Effect.fromOption,
        Effect.mapError(() => rejected(400, "The runtime version is missing"))
      )
    ),
    Effect.map(
      ({ headers, platform, runtimeVersion }): ManifestRequest => ({
        platform,
        runtimeVersion,
        currentUpdateId: headers.get("expo-current-update-id"),
        embeddedUpdateId: headers.get("expo-embedded-update-id"),
        expectsSignature: headers.has("expo-expect-signature"),
      })
    )
  );

const toProtocolTime = (instant: Temporal.Instant) =>
  instant.toString({ smallestUnit: "millisecond" });

const noUpdateAvailable: ManifestReply = {
  part: "directive",
  body: { type: "noUpdateAvailable" },
};

/**
 * What the app should do given one publication for its platform and runtime
 * version: run the update unless it already does, or return to its embedded
 * update unless it already runs it.
 */
const replyToPublication = (
  request: ManifestRequest,
  { publication, publishedAt }: PublishedMobileUpdate
): ManifestReply =>
  Match.value(publication).pipe(
    Match.discriminatorsExhaustive("type")({
      update: (update): ManifestReply =>
        request.currentUpdateId === update.id
          ? noUpdateAvailable
          : {
              part: "manifest",
              body: {
                id: update.id,
                createdAt: toProtocolTime(publishedAt),
                runtimeVersion: update.runtimeVersion,
                launchAsset: update.launchAsset,
                assets: update.assets,
                metadata: update.metadata,
                extra: update.extra,
              },
            },
      rollBackToEmbedded: (): ManifestReply =>
        request.currentUpdateId !== null &&
        request.currentUpdateId === request.embeddedUpdateId
          ? noUpdateAvailable
          : {
              part: "directive",
              body: {
                type: "rollBackToEmbedded",
                parameters: { commitTime: toProtocolTime(publishedAt) },
              },
            },
    })
  );

/**
 * The reply to an app given the newest publication for its platform and
 * runtime version; an app on a runtime version without publications keeps
 * what it runs.
 */
const replyTo = ({
  request,
  latest,
}: {
  readonly request: ManifestRequest;
  readonly latest: Option.Option<PublishedMobileUpdate>;
}) =>
  latest.pipe(
    Option.map((published) => replyToPublication(request, published)),
    Option.getOrElse(() => noUpdateAvailable)
  );

const formDataPart = (name: string, contentType: string) => ({
  "content-type": contentType,
  "content-disposition": `form-data; name="${name}"`,
});

/** The reply's part headers, with its signature when the app expects one. */
const partHeaders = ({
  request,
  reply,
  body,
}: {
  readonly request: ManifestRequest;
  readonly reply: ManifestReply;
  readonly body: string;
}) =>
  Effect.succeed(
    formDataPart(reply.part, "application/json; charset=utf-8")
  ).pipe(
    Effect.flatMap((headers) =>
      request.expectsSignature
        ? signManifestBody(body).pipe(
            Effect.map((signature) => ({
              ...headers,
              "expo-signature": signature,
            }))
          )
        : Effect.succeed(headers)
    )
  );

const manifestResponse = ({
  headers,
  body,
}: {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}) => {
  const multipart = encodeMultipartMixed([
    { headers, body },
    {
      headers: formDataPart("extensions", "application/json"),
      body: JSON.stringify({ assetRequestHeaders: {} }),
    },
  ]);

  return new Response(multipart.body, {
    headers: {
      "expo-protocol-version": "1",
      "expo-sfv-version": "0",
      "expo-manifest-filters": serializeDictionary({}),
      "expo-server-defined-headers": serializeDictionary({}),
      "cache-control": "private, max-age=0",
      "content-type": multipart.contentType,
    },
  });
};

/**
 * Answers an installed app's update check (Expo Updates protocol 1) with the
 * newest publication for its platform and runtime version, signed when the
 * app expects a signature.
 */
export const respondToManifestRequest = (request: Request) =>
  Effect.Do.pipe(
    Effect.bind("request", () => readManifestRequest(request)),
    Effect.tap(({ request: { platform, runtimeVersion } }) =>
      Effect.annotateLogsScoped({ platform, runtimeVersion })
    ),
    Effect.bind("latest", ({ request: { platform, runtimeVersion } }) =>
      Effect.flatMap(MobileUpdatePublications, (publications) =>
        publications.latest({ platform, runtimeVersion })
      )
    ),
    Effect.let("reply", replyTo),
    Effect.let("body", ({ reply }) => JSON.stringify(reply.body)),
    Effect.bind("headers", partHeaders),
    Effect.tap(({ reply }) =>
      Effect.logInfo("Mobile update check answered", { reply: reply.part })
    ),
    Effect.map(manifestResponse),
    Effect.scoped,
    Effect.catchTags({
      MobileUpdatePublicationsUnavailable: WorkspaceRouteFailure.unavailable(
        "Mobile updates are unavailable",
        "mobile_updates_unavailable"
      ),
      ManifestSigningUnavailable: WorkspaceRouteFailure.unavailable(
        "Mobile update signing is unavailable",
        "mobile_updates_signing_unavailable"
      ),
    }),
    Effect.withSpan("respondToManifestRequest")
  );
