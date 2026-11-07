import "server-only";

import { Effect, Option, Schema } from "effect";
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
type ManifestReply =
  | { readonly part: "manifest"; readonly body: object }
  | { readonly part: "directive"; readonly body: object };

const badRequest = (publicMessage: string) =>
  new WorkspaceRouteFailure({ statusCode: 400, publicMessage });

const decodePlatform = Schema.decodeUnknownOption(MobileUpdatePlatform);

/**
 * Reads an Expo Updates protocol 1 request. The protocol lets the platform
 * and runtime version also arrive as query parameters.
 */
const readManifestRequest = (
  request: Request
): Effect.Effect<ManifestRequest, WorkspaceRouteFailure> => {
  const { headers } = request;
  const query = new URL(request.url).searchParams;

  if (headers.get("expo-protocol-version") !== "1") {
    return Effect.fail(badRequest("Only Expo Updates protocol 1 is supported"));
  }
  if (preferredMediaType(headers, ["multipart/mixed"]) === undefined) {
    return Effect.fail(
      new WorkspaceRouteFailure({
        statusCode: 406,
        publicMessage: "Update responses are multipart/mixed only",
      })
    );
  }

  const platform = decodePlatform(
    headers.get("expo-platform") ?? query.get("platform")
  );
  if (Option.isNone(platform)) {
    return Effect.fail(badRequest("The platform must be android or ios"));
  }

  const runtimeVersion =
    headers.get("expo-runtime-version") || query.get("runtime-version");
  if (!runtimeVersion) {
    return Effect.fail(badRequest("The runtime version is missing"));
  }

  return Effect.succeed({
    platform: platform.value,
    runtimeVersion,
    currentUpdateId: headers.get("expo-current-update-id"),
    embeddedUpdateId: headers.get("expo-embedded-update-id"),
    expectsSignature: headers.has("expo-expect-signature"),
  });
};

const toProtocolTime = (instant: Temporal.Instant) =>
  instant.toString({ smallestUnit: "millisecond" });

const noUpdateAvailable: ManifestReply = {
  part: "directive",
  body: { type: "noUpdateAvailable" },
};

/**
 * What the app should do given the newest publication for its platform and
 * runtime version: an app on another runtime version finds none and keeps
 * what it runs.
 */
const replyTo = (
  request: ManifestRequest,
  latest: Option.Option<PublishedMobileUpdate>
): ManifestReply => {
  if (Option.isNone(latest)) return noUpdateAvailable;
  const { publication, publishedAt } = latest.value;

  if (publication.type === "rollBackToEmbedded") {
    const runsEmbeddedUpdate =
      request.currentUpdateId !== null &&
      request.currentUpdateId === request.embeddedUpdateId;
    return runsEmbeddedUpdate
      ? noUpdateAvailable
      : {
          part: "directive",
          body: {
            type: "rollBackToEmbedded",
            parameters: { commitTime: toProtocolTime(publishedAt) },
          },
        };
  }

  if (request.currentUpdateId === publication.id) return noUpdateAvailable;

  return {
    part: "manifest",
    body: {
      id: publication.id,
      createdAt: toProtocolTime(publishedAt),
      runtimeVersion: publication.runtimeVersion,
      launchAsset: publication.launchAsset,
      assets: publication.assets,
      metadata: publication.metadata,
      extra: publication.extra,
    },
  };
};

const formDataPart = (name: string, contentType: string) => ({
  "content-type": contentType,
  "content-disposition": `form-data; name="${name}"`,
});

const encodeReply = Effect.fn("encodeManifestReply")(function* (
  request: ManifestRequest,
  reply: ManifestReply
) {
  const body = JSON.stringify(reply.body);
  const signature = request.expectsSignature
    ? { "expo-signature": yield* signManifestBody(body) }
    : {};

  return encodeMultipartMixed([
    {
      headers: {
        ...formDataPart(reply.part, "application/json; charset=utf-8"),
        ...signature,
      },
      body,
    },
    {
      headers: formDataPart("extensions", "application/json"),
      body: JSON.stringify({ assetRequestHeaders: {} }),
    },
  ]);
});

/**
 * Answers an installed app's update check (Expo Updates protocol 1) with the
 * newest publication for its platform and runtime version, signed when the
 * app expects a signature.
 */
export const respondToManifestRequest = Effect.fn("respondToManifestRequest")(
  function* (request: Request) {
    const manifestRequest = yield* readManifestRequest(request);
    yield* Effect.annotateLogsScoped({
      platform: manifestRequest.platform,
      runtimeVersion: manifestRequest.runtimeVersion,
    });

    const publications = yield* MobileUpdatePublications;
    const latest = yield* publications.latest(manifestRequest);
    const reply = replyTo(manifestRequest, latest);
    const { contentType, body } = yield* encodeReply(manifestRequest, reply);
    yield* Effect.logInfo("Mobile update check answered", {
      reply: reply.part,
    });

    return new Response(body, {
      headers: {
        "expo-protocol-version": "1",
        "expo-sfv-version": "0",
        "expo-manifest-filters": serializeDictionary({}),
        "expo-server-defined-headers": serializeDictionary({}),
        "cache-control": "private, max-age=0",
        "content-type": contentType,
      },
    });
  },
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
  })
);
