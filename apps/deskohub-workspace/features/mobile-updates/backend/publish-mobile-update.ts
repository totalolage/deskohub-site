import "server-only";

import { isMatchingSecret } from "@deskohub/secret-comparison";
import { Effect, Option, Schema } from "effect";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { WorkspaceRouteFailure } from "@/shared/backend/workspace-route";
import { MobileUpdatePublication } from "../mobile-update-publication";
import { MobileUpdatePublications } from "./mobile-update-publications.service";

/**
 * The release pipeline's publish request must carry the deployment's publish
 * token as a bearer token. A deployment without one cannot publish (503).
 */
const authorizePublisher = (request: Request) =>
  Option.fromNullishOr(env.MOBILE_UPDATES_PUBLISH_TOKEN).pipe(
    Effect.fromOption,
    Effect.mapError(
      () =>
        new WorkspaceRouteFailure({
          statusCode: 503,
          publicMessage: "Publishing mobile updates is not configured",
          code: "mobile_updates_publishing_unconfigured",
        })
    ),
    Effect.filterOrFail(
      (token) =>
        isMatchingSecret(
          request.headers.get("authorization") ?? "",
          `Bearer ${token}`
        ),
      () =>
        new WorkspaceRouteFailure({
          statusCode: 401,
          publicMessage: "Unauthorized",
        })
    )
  );

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

const recordPublication = ({
  publication,
}: {
  readonly publication: MobileUpdatePublication;
}) =>
  Effect.flatMap(MobileUpdatePublications, (publications) =>
    publications.publish(publication)
  ).pipe(
    Effect.catchTags({
      MobileUpdatePublicationConflict: (conflict) =>
        Effect.fail(
          new WorkspaceRouteFailure({
            statusCode: 409,
            publicMessage: "Another publication already has this id",
            cause: conflict,
          })
        ),
      MobileUpdatePublicationsUnavailable: (failure) =>
        Effect.fail(
          WorkspaceRouteFailure.unavailable(
            "Mobile updates are unavailable",
            "mobile_updates_unavailable"
          )(failure)
        ),
    })
  );

/**
 * Records a publication for installed apps to receive: 201 when it is new,
 * 200 when the same publication was already recorded, 409 when its id holds
 * a different one.
 */
export const publishMobileUpdate = (request: Request) =>
  Effect.Do.pipe(
    Effect.tap(() => authorizePublisher(request)),
    Effect.bind("publication", () => readPublication(request)),
    Effect.tap(({ publication }) =>
      Effect.annotateLogsScoped({
        publicationId: publication.id,
        platform: publication.platform,
        runtimeVersion: publication.runtimeVersion,
        publicationType: publication.type,
      })
    ),
    Effect.bind("status", recordPublication),
    Effect.tap(({ status }) =>
      Effect.logInfo("Mobile update publication recorded", { status })
    ),
    Effect.map(({ status }) =>
      NextResponse.json(
        { status },
        { status: status === "published" ? 201 : 200 }
      )
    ),
    Effect.scoped,
    Effect.withSpan("publishMobileUpdate")
  );
