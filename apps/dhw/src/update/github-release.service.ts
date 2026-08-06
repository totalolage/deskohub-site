import { Context, Data, Effect, Layer, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

const githubReleasesUrl = new URL(
  "https://api.github.com/repos/totalolage/deskohub-site/releases?per_page=100"
);

const GithubReleaseAsset = Schema.Struct({
  name: Schema.String,
  browser_download_url: Schema.URL,
  size: Schema.Number,
  digest: Schema.NullOr(Schema.String),
});

const GithubRelease = Schema.Struct({
  tag_name: Schema.String,
  html_url: Schema.URL,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  immutable: Schema.Boolean,
  assets: Schema.Array(GithubReleaseAsset),
});

const GithubReleases = Schema.Array(GithubRelease);

export type GithubRelease = typeof GithubRelease.Type;

export type GithubReleaseResult = Data.TaggedEnum<{
  NotModified: {
    readonly etag: string | undefined;
  };
  Modified: {
    readonly etag: string | undefined;
    readonly releases: ReadonlyArray<GithubRelease>;
  };
}>;

export const GithubReleaseResult = Data.taggedEnum<GithubReleaseResult>();

interface IGithubReleaseService {
  readonly list: (
    etag: string | undefined
  ) => Effect.Effect<GithubReleaseResult, GithubReleaseError>;
}

export class GithubReleaseService extends Context.Service<
  GithubReleaseService,
  IGithubReleaseService
>()("GithubReleaseService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;

      return {
        list: Effect.fn("GithubReleaseService.list")((etag) =>
          loadGithubReleases(httpClient, etag).pipe(
            Effect.mapError(GithubReleaseError.fromCause)
          )
        ),
      };
    })
  );
}

export class GithubReleaseError extends Data.TaggedError("GithubReleaseError")<{
  readonly message: string;
  readonly cause: unknown;
}> {
  static fromCause = (cause: unknown) =>
    new GithubReleaseError({
      message: "GitHub release information could not be loaded.",
      cause,
    });
}

const loadGithubReleases = (
  httpClient: HttpClient.HttpClient,
  etag: string | undefined
) => {
  const request = HttpClientRequest.get(githubReleasesUrl).pipe(
    HttpClientRequest.setHeaders({
      accept: "application/vnd.github+json",
      "user-agent": "dhw",
      "x-github-api-version": "2026-03-10",
      ...(etag === undefined ? {} : { "if-none-match": etag }),
    })
  );

  return httpClient.execute(request).pipe(
    Effect.flatMap((response) => {
      const responseEtag = response.headers.etag;

      if (response.status === 304) {
        return Effect.succeed<GithubReleaseResult>(
          GithubReleaseResult.NotModified({
            etag: responseEtag,
          })
        );
      }

      return HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GithubReleases)),
        Effect.map(
          (releases): GithubReleaseResult =>
            GithubReleaseResult.Modified({
              etag: responseEtag,
              releases,
            })
        )
      );
    })
  );
};
