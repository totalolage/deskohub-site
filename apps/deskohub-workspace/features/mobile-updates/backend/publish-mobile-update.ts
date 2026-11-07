import "server-only";

import { isMatchingSecret } from "@deskohub/secret-comparison";
import { Effect, Schema } from "effect";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { WorkspaceRouteFailure } from "@/shared/backend/workspace-route";
import { MobileUpdatePublication } from "../mobile-update-publication";
import { MobileUpdatePublications } from "./mobile-update-publications.service";

const rejected = (statusCode: number, publicMessage: string) =>
  new WorkspaceRouteFailure({ statusCode, publicMessage });

/**
 * The release pipeline's publish request: it must carry the deployment's
 * publish token as a bearer token, and its body is one
 * `MobileUpdatePublication`.
 */
const authorizePublisher = (request: Request) => {
  const token = env.MOBILE_UPDATES_PUBLISH_TOKEN;
  if (token === undefined) {
    return Effect.fail(
      new WorkspaceRouteFailure({
        statusCode: 503,
        publicMessage: "Publishing mobile updates is not configured",
        code: "mobile_updates_publishing_unconfigured",
      })
    );
  }

  const authorization = request.headers.get("authorization");
  return authorization !== null &&
    isMatchingSecret(authorization, `Bearer ${token}`)
    ? Effect.void
    : Effect.fail(rejected(401, "Unauthorized"));
};

const readPublication = (request: Request) =>
  Effect.tryPromise(() => request.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(MobileUpdatePublication)),
    Effect.mapError(
      (cause) =>
        new WorkspaceRouteFailure({
          statusCode: 400,
          publicMessage: "The body is not a mobile update publication",
          cause,
        })
    )
  );

/**
 * Records a publication for installed apps to receive: 201 when it is new,
 * 200 when the same publication was already recorded, 409 when its id holds
 * a different one.
 */
export const publishMobileUpdate = Effect.fn("publishMobileUpdate")(function* (
  request: Request
) {
  yield* authorizePublisher(request);
  const publication = yield* readPublication(request);
  yield* Effect.annotateLogsScoped({
    publicationId: publication.id,
    platform: publication.platform,
    runtimeVersion: publication.runtimeVersion,
    publicationType: publication.type,
  });

  const publications = yield* MobileUpdatePublications;
  const status = yield* publications.publish(publication).pipe(
    Effect.catchTag("MobileUpdatePublicationConflict", (conflict) =>
      Effect.fail(
        new WorkspaceRouteFailure({
          statusCode: 409,
          publicMessage: "Another publication already has this id",
          cause: conflict,
        })
      )
    ),
    Effect.mapError((failure) =>
      failure._tag === "WorkspaceRouteFailure"
        ? failure
        : WorkspaceRouteFailure.unavailable(
            "Mobile updates are unavailable",
            "mobile_updates_unavailable"
          )(failure)
    )
  );
  yield* Effect.logInfo("Mobile update publication recorded", { status });

  return NextResponse.json(
    { status },
    { status: status === "published" ? 201 : 200 }
  );
}, Effect.scoped);
