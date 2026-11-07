import {
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Redacted,
  Schedule,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import type {
  MobileUpdatePlatform,
  MobileUpdatePublication,
} from "../mobile-update-publication";
import type { ManifestReply } from "./manifest-verification";
import { MobileUpdatePublishConfig } from "./mobile-update-publish-config";

type MobileUpdatePublishOutcome = "published" | "already-published";

/** The deployment couldn't be reached or answered with a server failure. */
class MobileUpdatesDeploymentUnavailable extends Data.TaggedError(
  "MobileUpdatesDeploymentUnavailable"
)<{ readonly message: string }> {}

/** The deployment refused the publication; publishing it again won't help. */
class MobileUpdatePublicationRefused extends Data.TaggedError(
  "MobileUpdatePublicationRefused"
)<{ readonly message: string; readonly status: number }> {}

interface IMobileUpdatesDeployment {
  /** Records a publication on the deployment for installed apps to get. */
  readonly publish: (
    publication: MobileUpdatePublication
  ) => Effect.Effect<
    MobileUpdatePublishOutcome,
    MobileUpdatesDeploymentUnavailable | MobileUpdatePublicationRefused
  >;
  /** Checks for an update as an installed app that expects a signature. */
  readonly checkForUpdate: (target: {
    readonly platform: MobileUpdatePlatform;
    readonly runtimeVersion: string;
  }) => Effect.Effect<ManifestReply, MobileUpdatesDeploymentUnavailable>;
}

/** Bounds each attempt, so a hung attempt is retried like a failed one. */
const attemptTimeout = "15 seconds";
/** Bounds a request with all its attempts and backoff. */
const requestDeadline = "90 seconds";

/**
 * Retries transport failures, timeouts, and the transient HTTP statuses 408,
 * 429, 500, 502, 503 and 504; other statuses would answer the same again. A
 * publication's id makes publishing it again a no-op, so retries are safe.
 */
const transientRetry = {
  times: 3,
  schedule: Schedule.exponential("1 second"),
} as const;

const publishOutcomes: ReadonlyMap<number, MobileUpdatePublishOutcome> =
  new Map([
    [201, "published"],
    [200, "already-published"],
  ]);

/** The deployment whose mobile-updates routes a publish run talks to. */
export class MobileUpdatesDeployment extends Context.Service<
  MobileUpdatesDeployment,
  IMobileUpdatesDeployment
>()("MobileUpdatesDeployment") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { target, publishToken, protectionBypass } =
        yield* MobileUpdatePublishConfig;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest((request) =>
          Option.match(protectionBypass, {
            onNone: () => request,
            onSome: (secret) =>
              HttpClientRequest.setHeader(
                request,
                "x-vercel-protection-bypass",
                Redacted.value(secret)
              ),
          })
        ),
        // Each attempt reads the whole body, which the response then keeps,
        // so a body that stalls times out and is retried like a hung request.
        HttpClient.transform((response) =>
          response.pipe(
            Effect.tap((attempt) => attempt.text),
            Effect.timeout(attemptTimeout)
          )
        ),
        HttpClient.retryTransient(transientRetry)
      );
      const routeUrl = (path: string) => new URL(path, target).toString();

      return {
        publish: (publication) =>
          client
            .execute(
              HttpClientRequest.post(routeUrl("/api/mobile/updates")).pipe(
                HttpClientRequest.bearerToken(publishToken),
                HttpClientRequest.bodyJsonUnsafe(publication)
              )
            )
            .pipe(
              Effect.timeout(requestDeadline),
              // The request carries the publish token; keep only the message.
              Effect.mapError(
                ({ message }) =>
                  new MobileUpdatesDeploymentUnavailable({
                    message: `The publish request failed, so the deployment may or may not have recorded ${publication.platform} publication ${publication.id}: ${message}`,
                  })
              ),
              Effect.flatMap(({ status }) =>
                publishOutcome(publication, status)
              )
            ),
        checkForUpdate: ({ platform, runtimeVersion }) =>
          client
            .pipe(HttpClient.filterStatusOk)
            .execute(
              HttpClientRequest.get(
                routeUrl("/api/mobile/updates/manifest")
              ).pipe(
                HttpClientRequest.setHeaders({
                  accept: "multipart/mixed",
                  "expo-protocol-version": "1",
                  "expo-platform": platform,
                  "expo-runtime-version": runtimeVersion,
                  "expo-expect-signature": "sig, keyid, alg",
                })
              )
            )
            .pipe(
              Effect.flatMap((response) =>
                response.text.pipe(
                  Effect.map(
                    (body): ManifestReply => ({
                      contentType: response.headers["content-type"] ?? "",
                      body,
                    })
                  )
                )
              ),
              Effect.timeout(requestDeadline),
              Effect.mapError(
                ({ message }) =>
                  new MobileUpdatesDeploymentUnavailable({
                    message: `The ${platform} update check failed: ${message}`,
                  })
              )
            ),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(FetchHttpClient.layer));
}

/** 201 records a new publication and 200 one the deployment already had. */
const publishOutcome = (
  { platform, id }: MobileUpdatePublication,
  status: number
): Effect.Effect<
  MobileUpdatePublishOutcome,
  MobileUpdatesDeploymentUnavailable | MobileUpdatePublicationRefused
> => {
  const outcome = publishOutcomes.get(status);
  if (outcome !== undefined) return Effect.succeed(outcome);
  return status >= 500
    ? Effect.fail(
        new MobileUpdatesDeploymentUnavailable({
          message: `The deployment answered the publish request with HTTP ${status}, so it may or may not have recorded ${platform} publication ${id}`,
        })
      )
    : Effect.fail(
        new MobileUpdatePublicationRefused({
          message: `The deployment refused the publication with HTTP ${status}`,
          status,
        })
      );
};
