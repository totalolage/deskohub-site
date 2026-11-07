import {
  Array as Arr,
  Data,
  Effect,
  Option,
  Order,
  Result,
  Schema,
} from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  GitHubRelease,
  mobileReleaseVersion,
  mobileReleaseVersionOrder,
  selectLatestAndroidRelease,
} from "../android-release";

/** GitHub could not say which Android release is the latest. */
export class MobileReleaseLookupError extends Data.TaggedError(
  "MobileReleaseLookupError"
)<{
  readonly cause: unknown;
}> {
  static fromCause = (cause: unknown) =>
    new MobileReleaseLookupError({ cause });
}

const repositoryApiUrl =
  "https://api.github.com/repos/totalolage/deskohub-site";

/**
 * How many of the highest mobile tags are looked up before concluding none
 * has a usable release. A tag can lack one while its release is still a
 * draft or after its workflow failed; more than a few such tags in a row
 * means something to fix, not to search past.
 */
const candidateTagLimit = 3;

const requestTimeout = "5 seconds";

const TagRefs = Schema.Array(Schema.Struct({ ref: Schema.String }));

/**
 * The latest Android release, read from GitHub's public REST API without
 * credentials. Lists the `mobile-v` tags, then looks up the releases of the
 * highest few, newest first, until one is usable, so releases of other
 * series in the repository never push mobile releases out of view. A tag
 * without a published release is skipped; any request GitHub fails, times
 * out or answers unreadably fails the lookup.
 */
export const findLatestAndroidRelease = Effect.fn(
  "MobileReleases.findLatestAndroidRelease"
)(function* () {
  const github = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      HttpClientRequest.setHeaders({
        accept: "application/vnd.github+json",
        "user-agent": "deskohub-workspace",
        "x-github-api-version": "2026-03-10",
      })
    ),
    HttpClient.transformResponse(Effect.timeout(requestTimeout))
  );

  const tagRefs = yield* github
    .get(`${repositoryApiUrl}/git/matching-refs/tags/mobile-v`)
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(TagRefs))
    );
  const candidateVersions = Arr.sort(
    tagRefs.flatMap(({ ref }) =>
      Option.toArray(mobileReleaseVersion(ref.replace(/^refs\/tags\//, "")))
    ),
    Order.flip(mobileReleaseVersionOrder)
  ).slice(0, candidateTagLimit);

  return yield* Effect.findFirstFilter(candidateVersions, (version) =>
    github.get(`${repositoryApiUrl}/releases/tags/mobile-v${version}`).pipe(
      Effect.flatMap(readPublishedRelease),
      Effect.map((release) =>
        Result.fromOption(
          Option.flatMap(release, (found) =>
            selectLatestAndroidRelease([found])
          ),
          () => version
        )
      )
    )
  );
}, Effect.mapError(MobileReleaseLookupError.fromCause));

// GitHub answers 404 for a tag whose release is missing or still a draft.
const readPublishedRelease = (
  response: HttpClientResponse.HttpClientResponse
) =>
  response.status === 404
    ? Effect.succeedNone
    : HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubRelease)),
        Effect.map(Option.some)
      );
